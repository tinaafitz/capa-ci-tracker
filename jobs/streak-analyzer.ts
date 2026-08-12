// streak-analyzer.ts -- CronJob script for multi-day failure analysis.
// Runs every 15 minutes on OpenShift (offset 7min from ingest).
//
// Phase 1: Detect and update failure streaks by walking build timelines
// Phase 2: Fetch GCS build logs for Prow failures (--skip-logs to disable)
// Phase 3: Correlate upstream commits from watched repos via GitHub API
// Phase 4: Detect signature-cleared events for partial fix verification
//
// Usage:
//   node --import tsx jobs/streak-analyzer.ts
//   node --import tsx jobs/streak-analyzer.ts --skip-logs

import { pool, query, log, recordAgentRun } from './db.js';

// ============================================================
// Environment
// ============================================================

const GITHUB_TOKEN = process.env.GITHUB_PAT ?? '';
const DEFAULT_WATCHED_REPOS = 'stolostron/rosa-hcp-e2e-test,stolostron/cluster-api-installer';
const WATCHED_REPOS = (process.env.WATCHED_REPOS ?? DEFAULT_WATCHED_REPOS)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const SKIP_LOGS = process.argv.includes('--skip-logs');
const MAX_LOG_FETCHES_PER_RUN = 10;
const GCS_BASE_URL = 'https://storage.googleapis.com/test-platform-results/logs';
const MAX_LOG_SIZE = 100 * 1024; // 100KB
const MAX_ERROR_EXTRACT_SIZE = 10 * 1024; // 10KB

// ============================================================
// Types
// ============================================================

interface Build {
  id: string;
  source: string;
  external_id: string;
  job_name: string;
  job_url: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  test_failures: TestFailure[] | null;
  log_fetched: boolean;
}

interface TestFailure {
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}

interface StreakPhase {
  phase_number: number;
  error_signature: string | null;
  first_build_id: string;
  last_build_id: string;
  first_seen: string;
  last_seen: string;
  build_count: number;
  ticket_id: string | null;
  fix_pr_url: string | null;
  fix_verified: boolean;
  summary: string | null;
}

interface StreakBuildEntry {
  build_id: string;
  position: number;
  error_signature: string | null;
  phase_number: number;
}

interface DetectedStreak {
  job_name: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  builds: StreakBuildEntry[];
  phases: StreakPhase[];
}

interface ErrorLine {
  line_number: number;
  content: string;
  task_name: string | null;
  severity: 'fatal' | 'error' | 'info';
}

interface UpstreamCommit {
  sha: string;
  message: string;
  author: string;
  url: string;
  date: string;
}

interface RepoCommits {
  repo: string;
  commits: UpstreamCommit[];
  compare_url: string | null;
}

// ============================================================
// Phase 1: Streak Detection
// ============================================================

async function detectStreaks(): Promise<{ created: number; updated: number; closed: number; errors: string[] }> {
  const result = { created: 0, updated: 0, closed: 0, errors: [] as string[] };

  // Get distinct job names from recent builds (last 30 days, prow and jenkins)
  const jobsRes = await query(
    `SELECT DISTINCT job_name, source
     FROM builds
     WHERE started_at > now() - INTERVAL '30 days'
     ORDER BY job_name`,
  );

  log('INFO', 'streak-analyzer', `Phase 1: Processing ${jobsRes.rows.length} distinct jobs`);

  for (const { job_name, source } of jobsRes.rows) {
    try {
      await processJobStreaks(job_name, source, result);
    } catch (err) {
      result.errors.push(`Job ${job_name}: ${(err as Error).message}`);
      log('ERROR', 'streak-analyzer', `Error processing job ${job_name}: ${(err as Error).message}`);
    }
  }

  return result;
}

async function processJobStreaks(
  jobName: string,
  source: string,
  result: { created: number; updated: number; closed: number; errors: string[] },
): Promise<void> {
  // Get last 30 days of builds for this job, ordered chronologically
  const buildsRes = await query(
    `SELECT
       b.id, b.source, b.external_id, b.job_name, b.job_url,
       b.status::text AS status, b.started_at, b.finished_at,
       b.test_failures, b.log_fetched
     FROM builds b
     WHERE b.job_name = $1
       AND b.source = $2
       AND b.started_at > now() - INTERVAL '30 days'
       AND b.status IN ('success', 'failure')
     ORDER BY b.started_at ASC`,
    [jobName, source],
  );

  const builds = buildsRes.rows as Build[];
  if (builds.length < 2) return; // Need at least 2 builds to form a streak

  // Batch-fetch all error signatures for this job's builds in one query
  // instead of querying per build (N+1 → 2 queries)
  const buildIds = builds.map(b => b.id);

  const sigRes = await query(
    `SELECT st.build_id, st.error_signature
     FROM support_tickets st
     WHERE st.build_id = ANY($1)`,
    [buildIds],
  );
  const sigByBuild = new Map<string, string>();
  for (const row of sigRes.rows) {
    sigByBuild.set(row.build_id, row.error_signature);
  }

  // Also batch-fetch dedup-linked error signatures from activities
  const dedupRes = await query(
    `SELECT a.build_id, a.metadata->>'error_signature' AS error_signature
     FROM activities a
     WHERE a.build_id = ANY($1)
       AND a.activity_type = 'build_completed'
       AND a.metadata->>'dedup' = 'true'`,
    [buildIds],
  );
  for (const row of dedupRes.rows) {
    // Only set if not already found via support_tickets
    if (!sigByBuild.has(row.build_id) && row.error_signature) {
      sigByBuild.set(row.build_id, row.error_signature);
    }
  }

  // Walk the timeline, detecting consecutive failure runs
  const detectedStreaks: DetectedStreak[] = [];
  let currentStreak: DetectedStreak | null = null;
  let lastGreenBuildTime: string | null = null;

  for (const build of builds) {
    if (build.status === 'success') {
      // End any active streak
      if (currentStreak && currentStreak.builds.length >= 2) {
        currentStreak.ended_at = build.started_at;
        detectedStreaks.push(currentStreak);
      }
      currentStreak = null;
      lastGreenBuildTime = build.started_at;
    } else if (build.status === 'failure') {
      // Look up the error_signature from pre-fetched maps (O(1))
      const errorSignature: string | null = sigByBuild.get(build.id) ?? null;

      if (!currentStreak) {
        // Start a new streak
        currentStreak = {
          job_name: jobName,
          source,
          started_at: build.started_at,
          ended_at: null,
          builds: [],
          phases: [{
            phase_number: 1,
            error_signature: errorSignature,
            first_build_id: build.id,
            last_build_id: build.id,
            first_seen: build.started_at,
            last_seen: build.started_at,
            build_count: 1,
            ticket_id: null,
            fix_pr_url: null,
            fix_verified: false,
            summary: null,
          }],
        };
      } else {
        // Continue or phase-transition the streak
        const currentPhase = currentStreak.phases[currentStreak.phases.length - 1];

        if (errorSignature && errorSignature !== currentPhase.error_signature) {
          // Phase transition: new error signature
          currentStreak.phases.push({
            phase_number: currentPhase.phase_number + 1,
            error_signature: errorSignature,
            first_build_id: build.id,
            last_build_id: build.id,
            first_seen: build.started_at,
            last_seen: build.started_at,
            build_count: 1,
            ticket_id: null,
            fix_pr_url: null,
            fix_verified: false,
            summary: null,
          });
        } else {
          // Same phase, extend it
          currentPhase.last_build_id = build.id;
          currentPhase.last_seen = build.started_at;
          currentPhase.build_count++;
        }
      }

      const phaseNumber = currentStreak.phases[currentStreak.phases.length - 1].phase_number;
      currentStreak.builds.push({
        build_id: build.id,
        position: currentStreak.builds.length + 1,
        error_signature: errorSignature,
        phase_number: phaseNumber,
      });
    }
  }

  // Don't forget the last streak if it's still active (no trailing success)
  if (currentStreak && currentStreak.builds.length >= 2) {
    detectedStreaks.push(currentStreak);
  }

  // Persist detected streaks
  for (const streak of detectedStreaks) {
    try {
      await persistStreak(streak, lastGreenBuildTime, result);
    } catch (err) {
      result.errors.push(`Streak for ${jobName} at ${streak.started_at}: ${(err as Error).message}`);
    }
  }
}

async function persistStreak(
  streak: DetectedStreak,
  _lastGreenBuildTime: string | null,
  result: { created: number; updated: number; closed: number },
): Promise<void> {
  // Enrich phases with ticket_id and fix_pr_url from support_tickets
  for (const phase of streak.phases) {
    if (phase.error_signature) {
      const ticketRes = await query(
        `SELECT id, fix_pr_url FROM support_tickets
         WHERE error_signature = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [phase.error_signature],
      );
      if (ticketRes.rows.length > 0) {
        phase.ticket_id = ticketRes.rows[0].id;
        phase.fix_pr_url = ticketRes.rows[0].fix_pr_url;
      }
    }
  }

  const status = streak.ended_at ? 'resolved' : 'active';

  // Upsert the streak -- match on (job_name, source, started_at)
  const upsertRes = await query(
    `INSERT INTO failure_streaks (
       job_name, source, started_at, ended_at, streak_length,
       phase_count, status, phases
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, job_name, started_at) DO UPDATE SET
       ended_at = EXCLUDED.ended_at,
       streak_length = EXCLUDED.streak_length,
       phase_count = EXCLUDED.phase_count,
       status = CASE
         WHEN failure_streaks.status = 'resolved' THEN failure_streaks.status
         ELSE EXCLUDED.status
       END,
       phases = EXCLUDED.phases
     RETURNING id, (xmax = 0) AS is_insert`,
    [
      streak.job_name,
      streak.source,
      streak.started_at,
      streak.ended_at,
      streak.builds.length,
      streak.phases.length,
      status,
      JSON.stringify(streak.phases),
    ],
  );

  if (upsertRes.rows.length === 0) return;

  const streakId = upsertRes.rows[0].id;
  const isInsert = upsertRes.rows[0].is_insert;

  // Link tickets to this streak
  for (const phase of streak.phases) {
    if (phase.ticket_id) {
      await query(
        `UPDATE support_tickets SET streak_id = $1 WHERE id = $2 AND (streak_id IS NULL OR streak_id = $1)`,
        [streakId, phase.ticket_id],
      );
    }
  }

  // Upsert streak_builds join rows
  for (const entry of streak.builds) {
    await query(
      `INSERT INTO streak_builds (streak_id, build_id, position, error_signature, phase_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (streak_id, build_id) DO UPDATE SET
         position = EXCLUDED.position,
         error_signature = EXCLUDED.error_signature,
         phase_number = EXCLUDED.phase_number`,
      [streakId, entry.build_id, entry.position, entry.error_signature, entry.phase_number],
    );
  }

  if (isInsert) {
    result.created++;

    // Log streak_detected activity
    await query(
      `INSERT INTO activities (activity_type, title, description, actor, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'streak_detected',
        `Failure streak detected: ${streak.job_name} (${streak.builds.length} builds)`,
        `${streak.job_name} has failed ${streak.builds.length} consecutive builds starting ${streak.started_at}. ${streak.phases.length} distinct error phase(s) detected.`,
        'streak-analyzer',
        JSON.stringify({
          streak_id: streakId,
          job_name: streak.job_name,
          streak_length: streak.builds.length,
          phase_count: streak.phases.length,
        }),
      ],
    );
  } else {
    result.updated++;
  }

  // If ended, log streak_resolved
  if (streak.ended_at && isInsert) {
    result.closed++;
  }
}

// ============================================================
// Phase 2: GCS Log Fetching
// ============================================================

async function fetchGCSLogs(): Promise<{ fetched: number; errors: string[] }> {
  const result = { fetched: 0, errors: [] as string[] };

  if (SKIP_LOGS) {
    log('INFO', 'streak-analyzer', 'Phase 2: Skipped (--skip-logs)');
    return result;
  }

  // Find unfetched failed Prow builds
  const buildsRes = await query(
    `SELECT id, external_id, job_name, started_at, test_failures
     FROM builds
     WHERE source = 'prow'
       AND status = 'failure'
       AND log_fetched = false
     ORDER BY started_at DESC
     LIMIT $1`,
    [MAX_LOG_FETCHES_PER_RUN],
  );

  log('INFO', 'streak-analyzer', `Phase 2: Found ${buildsRes.rows.length} unfetched Prow build logs`);

  for (const build of buildsRes.rows) {
    try {
      await fetchAndStoreBuildLog(build, result);
    } catch (err) {
      result.errors.push(`Build ${build.id}: ${(err as Error).message}`);
      log('ERROR', 'streak-analyzer', `GCS fetch error for build ${build.id}: ${(err as Error).message}`);

      // Mark as fetched to avoid retrying forever (even on failure)
      await query(`UPDATE builds SET log_fetched = true WHERE id = $1`, [build.id]);
    }
  }

  return result;
}

async function fetchAndStoreBuildLog(
  build: { id: string; external_id: string; job_name: string; started_at: string; test_failures: TestFailure[] | null },
  result: { fetched: number; errors: string[] },
): Promise<void> {
  const logUrl = `${GCS_BASE_URL}/${build.job_name}/${build.external_id}/build-log.txt`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(logUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Mark as fetched even on 404 -- log is gone, don't retry
    await query(`UPDATE builds SET log_fetched = true WHERE id = $1`, [build.id]);

    if (response.status === 404) {
      log('WARN', 'streak-analyzer', `GCS log not found (404) for build ${build.external_id}`);
      return;
    }
    throw new Error(`GCS HTTP ${response.status} for ${logUrl}`);
  }

  let logText = await response.text();
  const originalSize = logText.length;

  // If log > 100KB, keep only the last 100KB (errors are at the end)
  if (logText.length > MAX_LOG_SIZE) {
    logText = logText.slice(-MAX_LOG_SIZE);
  }

  // Extract error lines and error_extract
  const { errorLines, errorExtract } = extractErrors(logText);

  // Insert into build_logs
  await query(
    `INSERT INTO build_logs (build_id, log_url, log_text, log_size_bytes, error_extract, error_lines, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (build_id) DO UPDATE SET
       log_text = EXCLUDED.log_text,
       log_size_bytes = EXCLUDED.log_size_bytes,
       error_extract = EXCLUDED.error_extract,
       error_lines = EXCLUDED.error_lines,
       fetched_at = EXCLUDED.fetched_at`,
    [
      build.id,
      logUrl,
      logText,
      originalSize,
      errorExtract.slice(0, MAX_ERROR_EXTRACT_SIZE),
      JSON.stringify(errorLines),
    ],
  );

  // Mark build as log_fetched
  await query(`UPDATE builds SET log_fetched = true WHERE id = $1`, [build.id]);

  result.fetched++;
  log('INFO', 'streak-analyzer', `Fetched log for build ${build.external_id} (${originalSize} bytes, ${errorLines.length} error lines)`);
}

function extractErrors(logText: string): { errorLines: ErrorLine[]; errorExtract: string } {
  const lines = logText.split('\n');
  const errorLines: ErrorLine[] = [];
  const extractSegments: string[] = [];
  let lastTaskName: string | null = null;

  // Pattern matchers
  const fatalPattern = /fatal:/i;
  const failedPattern = /FAILED!/;
  const playRecapPattern = /PLAY RECAP/;
  const errorFromServerPattern = /Error from server/i;
  const httpErrorPattern = /\b(403|not authorized|not found|timed out)\b/i;
  const monitorPattern = /\[(Monitor|Diagnostic|Remediation)\]/;
  const taskPattern = /^TASK \[(.+)\]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Track current task name for context
    const taskMatch = line.match(taskPattern);
    if (taskMatch) {
      lastTaskName = taskMatch[1];
    }

    // fatal: lines + next 10 lines of context
    if (fatalPattern.test(line)) {
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'fatal' });
      const contextEnd = Math.min(i + 11, lines.length);
      const contextLines = lines.slice(i, contextEnd).join('\n');
      extractSegments.push(`--- fatal (line ${lineNumber}) ---\n${contextLines}`);
      for (let j = i + 1; j < contextEnd; j++) {
        errorLines.push({ line_number: j + 1, content: lines[j], task_name: lastTaskName, severity: 'fatal' });
      }
      continue;
    }

    // FAILED! with surrounding context (5 before, 10 after)
    if (failedPattern.test(line)) {
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'error' });
      const contextStart = Math.max(0, i - 5);
      const contextEnd = Math.min(i + 11, lines.length);
      const contextLines = lines.slice(contextStart, contextEnd).join('\n');
      extractSegments.push(`--- FAILED! (line ${lineNumber}) ---\n${contextLines}`);
      continue;
    }

    // PLAY RECAP sections
    if (playRecapPattern.test(line)) {
      const contextEnd = Math.min(i + 20, lines.length);
      const recapLines: string[] = [];
      for (let j = i; j < contextEnd; j++) {
        recapLines.push(lines[j]);
        if (j > i && lines[j].trim() === '') break; // blank line ends RECAP
      }
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'info' });
      extractSegments.push(`--- PLAY RECAP (line ${lineNumber}) ---\n${recapLines.join('\n')}`);
      continue;
    }

    // Error from server
    if (errorFromServerPattern.test(line)) {
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'error' });
      const contextEnd = Math.min(i + 6, lines.length);
      extractSegments.push(`--- Error from server (line ${lineNumber}) ---\n${lines.slice(i, contextEnd).join('\n')}`);
      continue;
    }

    // HTTP errors and common failure indicators
    if (httpErrorPattern.test(line) && !fatalPattern.test(line) && !failedPattern.test(line)) {
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'error' });
      continue;
    }

    // Monitor/Diagnostic/Remediation lines from AI Agent
    if (monitorPattern.test(line)) {
      errorLines.push({ line_number: lineNumber, content: line, task_name: lastTaskName, severity: 'info' });
      continue;
    }
  }

  // Build the error_extract from collected segments
  const errorExtract = extractSegments.join('\n\n');

  return { errorLines, errorExtract };
}

// ============================================================
// Phase 3: Upstream Commit Correlation
// ============================================================

async function correlateUpstreamCommits(): Promise<{ correlated: number; errors: string[] }> {
  const result = { correlated: 0, errors: [] as string[] };

  if (!GITHUB_TOKEN) {
    log('WARN', 'streak-analyzer', 'Phase 3: Skipped (GITHUB_PAT not set)');
    return result;
  }

  if (WATCHED_REPOS.length === 0) {
    log('INFO', 'streak-analyzer', 'Phase 3: No watched repos configured');
    return result;
  }

  // Find active streaks that haven't had upstream commits fetched yet
  // or haven't been analyzed in the last 6 hours
  const streakRes = await query(
    `SELECT id, job_name, source, started_at, ended_at, upstream_commits, analyzed_at
     FROM failure_streaks
     WHERE status = 'active'
       AND (upstream_commits IS NULL
            OR upstream_commits = '[]'::jsonb
            OR analyzed_at IS NULL
            OR analyzed_at < now() - INTERVAL '6 hours')`,
  );

  log('INFO', 'streak-analyzer', `Phase 3: Found ${streakRes.rows.length} streaks to check for upstream commits`);

  for (const streak of streakRes.rows) {
    try {
      await fetchUpstreamCommits(streak, result);
    } catch (err) {
      result.errors.push(`Streak ${streak.id}: ${(err as Error).message}`);
      log('ERROR', 'streak-analyzer', `Upstream commit fetch error for streak ${streak.id}: ${(err as Error).message}`);
    }
  }

  return result;
}

async function fetchUpstreamCommits(
  streak: { id: string; job_name: string; source: string; started_at: string; ended_at: string | null },
  result: { correlated: number; errors: string[] },
): Promise<void> {
  // Find the last passing build before the streak started
  const greenRes = await query(
    `SELECT finished_at FROM builds
     WHERE job_name = $1 AND source = $2 AND status = 'success'
       AND started_at < $3
     ORDER BY started_at DESC
     LIMIT 1`,
    [streak.job_name, streak.source, streak.started_at],
  );

  // Use the green build's finished_at or fall back to 7 days before streak start
  const since = greenRes.rows[0]?.finished_at
    ?? new Date(new Date(streak.started_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const until = streak.started_at;

  const allRepoCommits: RepoCommits[] = [];

  for (const repoPath of WATCHED_REPOS) {
    const [owner, repo] = repoPath.split('/');
    if (!owner || !repo) {
      result.errors.push(`Invalid repo path: ${repoPath}`);
      continue;
    }

    try {
      const commits = await fetchGitHubCommits(owner, repo, since, until);

      let compareUrl: string | null = null;
      if (commits.length >= 2) {
        compareUrl = `https://github.com/${owner}/${repo}/compare/${commits[commits.length - 1].sha.slice(0, 7)}...${commits[0].sha.slice(0, 7)}`;
      }

      allRepoCommits.push({
        repo: repoPath,
        commits,
        compare_url: compareUrl,
      });
    } catch (err) {
      result.errors.push(`GitHub API for ${repoPath}: ${(err as Error).message}`);
    }
  }

  // Store upstream commits on the streak
  await query(
    `UPDATE failure_streaks
     SET upstream_commits = $2, analyzed_at = now()
     WHERE id = $1`,
    [streak.id, JSON.stringify(allRepoCommits)],
  );

  result.correlated++;
  const totalCommits = allRepoCommits.reduce((sum, r) => sum + r.commits.length, 0);
  log('INFO', 'streak-analyzer', `Correlated ${totalCommits} upstream commits for streak ${streak.id}`);
}

async function fetchGitHubCommits(
  owner: string,
  repo: string,
  since: string,
  until: string,
): Promise<UpstreamCommit[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=30`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      log('WARN', 'streak-analyzer', `GitHub repo not found: ${owner}/${repo}`);
      return [];
    }
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
    html_url: string;
  }>;

  return data.map(c => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0], // first line only
    author: c.commit.author.name,
    url: c.html_url,
    date: c.commit.author.date,
  }));
}

// ============================================================
// Phase 4: Signature-Cleared Detection
// ============================================================

async function detectSignatureCleared(): Promise<{ cleared: number; errors: string[] }> {
  const result = { cleared: 0, errors: [] as string[] };

  // Find tickets that might have their error signature cleared
  const ticketRes = await query(
    `SELECT
       t.id, t.ticket_number, t.error_signature, t.build_id,
       t.pr_merged_at, t.created_at, t.streak_id,
       b.job_name, b.source, b.started_at AS build_started_at
     FROM support_tickets t
     JOIN builds b ON t.build_id = b.id
     WHERE t.status::text IN ('fix_in_progress', 'resolved')
       AND t.error_signature IS NOT NULL
       AND t.signature_cleared_in_build_id IS NULL`,
  );

  log('INFO', 'streak-analyzer', `Phase 4: Found ${ticketRes.rows.length} tickets to check for signature clearance`);

  for (const ticket of ticketRes.rows) {
    try {
      await checkSignatureCleared(ticket, result);
    } catch (err) {
      result.errors.push(`Ticket #${ticket.ticket_number}: ${(err as Error).message}`);
      log('ERROR', 'streak-analyzer', `Signature-cleared check error for ticket #${ticket.ticket_number}: ${(err as Error).message}`);
    }
  }

  return result;
}

async function checkSignatureCleared(
  ticket: {
    id: string;
    ticket_number: number;
    error_signature: string;
    build_id: string;
    pr_merged_at: string | null;
    created_at: string;
    streak_id: string | null;
    job_name: string;
    source: string;
    build_started_at: string;
  },
  result: { cleared: number; errors: string[] },
): Promise<void> {
  // Check builds after the PR merge (or after ticket creation if no PR merged yet)
  const checkAfter = ticket.pr_merged_at ?? ticket.created_at;

  // Find builds for the same job that ran after the reference time
  const buildsRes = await query(
    `SELECT b.id, b.status::text AS status, b.started_at, b.test_failures
     FROM builds b
     WHERE b.job_name = $1
       AND b.source = $2
       AND b.started_at > $3
     ORDER BY b.started_at ASC
     LIMIT 20`,
    [ticket.job_name, ticket.source, checkAfter],
  );

  if (buildsRes.rows.length === 0) return;

  // Check each build to see if the error_signature is absent
  for (const build of buildsRes.rows) {
    // Check if this build has the same error_signature in any linked ticket
    const sigRes = await query(
      `SELECT error_signature FROM support_tickets
       WHERE build_id = $1 AND error_signature = $2
       LIMIT 1`,
      [build.id, ticket.error_signature],
    );

    // Also check dedup-linked activities
    const dedupRes = await query(
      `SELECT 1 FROM activities
       WHERE build_id = $1
         AND metadata->>'error_signature' = $2
       LIMIT 1`,
      [build.id, ticket.error_signature],
    );

    const signaturePresent = sigRes.rows.length > 0 || dedupRes.rows.length > 0;

    if (!signaturePresent) {
      // Signature is cleared in this build
      await query(
        `UPDATE support_tickets
         SET signature_cleared_in_build_id = $2
         WHERE id = $1`,
        [ticket.id, build.id],
      );

      // Log signature_cleared activity
      await query(
        `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'signature_cleared',
          `Error signature cleared for ticket #${ticket.ticket_number}`,
          `The error signature "${ticket.error_signature}" was not reproduced in build ${build.id} (${build.status}). The specific failure tracked by this ticket appears to be fixed, even though the build may have failed for other reasons.`,
          ticket.id,
          build.id,
          'streak-analyzer',
          JSON.stringify({
            error_signature: ticket.error_signature,
            clearing_build_status: build.status,
            clearing_build_started_at: build.started_at,
          }),
        ],
      );

      // If the ticket is in a streak, update the phase's fix_verified flag
      if (ticket.streak_id) {
        await updateStreakPhaseVerification(ticket.streak_id, ticket.error_signature);
      }

      result.cleared++;
      log('INFO', 'streak-analyzer', `Signature cleared for ticket #${ticket.ticket_number} in build ${build.id} (${build.status})`);
      break; // Only need the first build where signature is absent
    }
  }
}

async function updateStreakPhaseVerification(streakId: string, errorSignature: string): Promise<void> {
  const streakRes = await query(
    `SELECT phases FROM failure_streaks WHERE id = $1`,
    [streakId],
  );

  if (streakRes.rows.length === 0) return;

  const phases = streakRes.rows[0].phases as StreakPhase[];
  let updated = false;

  for (const phase of phases) {
    if (phase.error_signature === errorSignature && !phase.fix_verified) {
      phase.fix_verified = true;
      updated = true;
    }
  }

  if (updated) {
    // Check if all phases are now verified
    const allVerified = phases.every(p => p.fix_verified);
    const someVerified = phases.some(p => p.fix_verified);
    const newStatus = allVerified ? 'resolved' : someVerified ? 'partial_fix' : 'active';

    await query(
      `UPDATE failure_streaks SET phases = $2, status = $3 WHERE id = $1`,
      [streakId, JSON.stringify(phases), newStatus],
    );

    if (allVerified) {
      await query(
        `INSERT INTO activities (activity_type, title, description, actor, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'streak_resolved',
          `Failure streak fully resolved`,
          `All ${phases.length} phase(s) in the streak have been verified as fixed.`,
          'streak-analyzer',
          JSON.stringify({ streak_id: streakId, phase_count: phases.length }),
        ],
      );
    }
  }
}

// ============================================================
// Main Entry Point
// ============================================================

async function main() {
  const startTime = Date.now();
  log('INFO', 'streak-analyzer', 'Starting streak analyzer', { skipLogs: SKIP_LOGS });

  const errors: string[] = [];

  try {
    // Phase 1: Detect streaks
    const phase1 = await detectStreaks();
    errors.push(...phase1.errors);
    log('INFO', 'streak-analyzer', `Phase 1 complete: ${phase1.created} created, ${phase1.updated} updated, ${phase1.closed} closed`);

    // Phase 2: Fetch GCS logs
    const phase2 = await fetchGCSLogs();
    errors.push(...phase2.errors);
    log('INFO', 'streak-analyzer', `Phase 2 complete: ${phase2.fetched} logs fetched`);

    // Phase 3: Upstream commit correlation
    const phase3 = await correlateUpstreamCommits();
    errors.push(...phase3.errors);
    log('INFO', 'streak-analyzer', `Phase 3 complete: ${phase3.correlated} streaks correlated`);

    // Phase 4: Signature-cleared detection
    const phase4 = await detectSignatureCleared();
    errors.push(...phase4.errors);
    log('INFO', 'streak-analyzer', `Phase 4 complete: ${phase4.cleared} signatures cleared`);

    const success = errors.length === 0;

    await recordAgentRun({
      agentName: 'streak-analyzer',
      trigger: 'cron',
      inputPayload: {
        skip_logs: SKIP_LOGS,
        watched_repos: WATCHED_REPOS,
      },
      outputPayload: {
        phase1_streaks_created: phase1.created,
        phase1_streaks_updated: phase1.updated,
        phase1_streaks_closed: phase1.closed,
        phase2_logs_fetched: phase2.fetched,
        phase3_streaks_correlated: phase3.correlated,
        phase4_signatures_cleared: phase4.cleared,
        errors,
      },
      success,
      errorMessage: success ? null : `${errors.length} error(s) during streak analysis`,
      durationMs: Date.now() - startTime,
    });

    log('INFO', 'streak-analyzer', `Job finished in ${Date.now() - startTime}ms`, {
      phase1_created: phase1.created,
      phase1_updated: phase1.updated,
      phase2_fetched: phase2.fetched,
      phase3_correlated: phase3.correlated,
      phase4_cleared: phase4.cleared,
      totalErrors: errors.length,
    });

    await pool.end();
    process.exit(success ? 0 : 1);
  } catch (err) {
    const errorMessage = (err as Error).message;
    log('ERROR', 'streak-analyzer', `Fatal error: ${errorMessage}`);

    await recordAgentRun({
      agentName: 'streak-analyzer',
      trigger: 'cron',
      inputPayload: { skip_logs: SKIP_LOGS },
      outputPayload: null,
      success: false,
      errorMessage,
      durationMs: Date.now() - startTime,
    });

    await pool.end();
    process.exit(1);
  }
}

main();
