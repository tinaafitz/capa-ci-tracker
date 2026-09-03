/**
 * ingest-prow -- Node.js agent
 *
 * Polls Prow prowjobs.js endpoint for recent CAPA/ROSA periodic jobs
 * and upserts into the builds table.
 * Ported from supabase/functions/ingest-prow/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { afterBuildInsert } from '../triggers.js';
import { classifyFailure } from './classify-failure.js';
import { INGEST_FLOOR_MS, INGEST_FLOOR_LABEL, isBeforeFloor } from './ingest-floor.js';

const AGENT_NAME = 'ingest-prow';

export interface AgentResult {
  success: boolean;
  message: string;
  ingested?: number;
  skipped?: number;
  errors?: string[];
}

// Prow API endpoint (public, no auth required)
const PROW_API_URL =
  process.env.PROW_API_URL ??
  'https://prow.ci.openshift.org/prowjobs.js?type=periodic&job=*capa-e2e*';

// Only match CAPA e2e jobs
const PROW_JOB_PATTERNS = [
  /periodic-ci-openshift-online-rosa-e2e-main_capa-e2e/,
];

// Blast-radius cap on GCS artifact enrichment per ingest run.
//
// Each enriched build issues up to 3 serial GCS fetches (finished.json,
// prowjob.json, build-log.txt). In steady state only a handful of builds need
// enrichment per run, but a fresh/empty DB or a large backlog could otherwise
// fan out hundreds of serial fetches in a single pass. This caps how many
// builds get enriched per run; the rest fall back to feed-quality
// classification (via the don't-downgrade upsert, so nothing is clobbered) and
// get enriched on a subsequent run. Override with MAX_GCS_ENRICH_PER_RUN.
const MAX_GCS_ENRICH_PER_RUN = (() => {
  const raw = process.env.MAX_GCS_ENRICH_PER_RUN;
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
})();

interface ProwJob {
  spec: {
    job: string;
    type: string;
    cluster?: string;
    refs?: {
      org: string;
      repo: string;
      base_ref: string;
    };
    extra_refs?: Array<{
      org: string;
      repo: string;
      base_ref: string;
    }>;
    decoration_config?: Record<string, unknown>;
  };
  status: {
    state: string;
    startTime?: string;
    completionTime?: string;
    url?: string;
    build_id?: string;
    description?: string;
  };
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

function mapProwState(state: string): string {
  switch (state.toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
    case 'error':
      return 'failure';
    case 'pending':
    case 'triggered':
      return 'pending';
    case 'aborted':
      return 'aborted';
    default:
      return 'pending';
  }
}

function isRelevantJob(jobName: string): boolean {
  return PROW_JOB_PATTERNS.some((pattern) => pattern.test(jobName));
}

function extractOcpVersionFromJobName(jobName: string): string | null {
  const match = jobName.match(/release-(\d+\.\d+)/);
  if (match) return match[1];

  const nightlyMatch = jobName.match(
    /(\d+\.\d+(?:\.\d+)?(?:-nightly)?)/,
  );
  if (nightlyMatch) return nightlyMatch[1];

  return null;
}

function computeDurationMs(
  startTime?: string,
  completionTime?: string,
): number | null {
  if (!startTime || !completionTime) return null;
  const start = new Date(startTime).getTime();
  const end = new Date(completionTime).getTime();
  const duration = end - start;
  return duration >= 0 ? duration : null;
}

function extractTestFailuresFromDescription(
  description?: string,
): Array<{
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}> {
  if (!description) return [];

  return [
    {
      name: 'prow-job-result',
      className: 'ProwJobExecution',
      errorMessage: description,
      errorStackTrace: '',
    },
  ];
}

// ============================================================
// GCS artifact helpers
// ============================================================

/**
 * Derive the GCS artifact base URL from a Prow job URL.
 *
 * Prow view URL pattern:
 *   https://prow.ci.openshift.org/view/gs/test-platform-results/logs/<job>/<build>/
 * GCS base pattern:
 *   https://storage.googleapis.com/test-platform-results/logs/<job>/<build>/
 *
 * Falls back to constructing from jobName + externalId when the URL
 * doesn't match the expected pattern.
 */
export function deriveGcsBase(
  jobUrl: string | null | undefined,
  jobName: string,
  externalId: string,
): string | null {
  const BUCKET = 'https://storage.googleapis.com/test-platform-results/logs';

  if (jobUrl) {
    // Try the canonical Prow view URL pattern
    const match = jobUrl.match(
      /\/view\/gs\/test-platform-results\/logs\/([^/]+)\/([^/]+)\/?$/,
    );
    if (match) {
      return `${BUCKET}/${match[1]}/${match[2]}`;
    }

    // Some URLs encode the GCS path directly
    const gcsMatch = jobUrl.match(
      /test-platform-results\/logs\/([^/]+)\/([^/]+)\/?/,
    );
    if (gcsMatch) {
      return `${BUCKET}/${gcsMatch[1]}/${gcsMatch[2]}`;
    }
  }

  // Construct from job name + external_id
  if (jobName && externalId) {
    return `${BUCKET}/${encodeURIComponent(jobName)}/${encodeURIComponent(externalId)}`;
  }

  return null;
}

/**
 * Extract a human-readable failure reason from a Prow build-log.txt.
 *
 * Priority order (first non-empty match wins):
 *   1. `Reporting job state 'failed' with reason '<REASON>'`
 *   2. `* could not run steps: <REASON>`
 *   3. `step <step-name> failed: <REASON>` (first occurrence)
 *
 * Returns null when no pattern matches.
 */
export function extractReasonFromBuildLog(log: string): string | null {
  if (!log) return null;

  // 1. Reporting job state reason (most specific)
  const reportingMatch = log.match(
    /Reporting job state\s+'(?:failed|failure)'\s+with reason\s+'([^']+)'/i,
  );
  if (reportingMatch?.[1]) return reportingMatch[1].trim();

  // 2. "could not run steps" error line
  const stepsMatch = log.match(/\*\s*could not run steps:\s*(.+)/i);
  if (stepsMatch?.[1]) return stepsMatch[1].trim();

  // 3. "step <X> failed: <reason>" — captures the whole message incl. 401 text
  const stepFailedMatch = log.match(/step\s+\S+\s+failed:\s*(.+)/i);
  if (stepFailedMatch?.[1]) return stepFailedMatch[1].trim();

  return null;
}

interface GcsArtifacts {
  testsPassed: boolean | null;
  description: string | null;
  reason: string | null;
}

/**
 * Fetch GCS artifacts for a failed Prow build and return enriched
 * classification inputs. All errors are swallowed — returns nulls on
 * any fetch or parse failure so ingestion is never blocked.
 */
export async function fetchProwArtifacts(
  jobUrl: string | null | undefined,
  jobName: string,
  externalId: string,
): Promise<GcsArtifacts> {
  const result: GcsArtifacts = { testsPassed: null, description: null, reason: null };

  const gcsBase = deriveGcsBase(jobUrl, jobName, externalId);
  if (!gcsBase) return result;

  // --- finished.json ---
  try {
    const resp = await fetch(`${gcsBase}/finished.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { passed?: boolean; result?: string };
      if (typeof json.passed === 'boolean') {
        result.testsPassed = json.passed;
      }
    }
  } catch {
    // GCS unavailable or timeout — continue with nulls
  }

  // --- prowjob.json ---
  try {
    const resp = await fetch(`${gcsBase}/prowjob.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { status?: { description?: string } };
      const desc = json.status?.description;
      if (desc) result.description = desc;
    }
  } catch {
    // Continue
  }

  // --- build-log.txt (most useful for lease / 401 errors) ---
  try {
    const resp = await fetch(`${gcsBase}/build-log.txt`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      // Read at most 64 KB — the lease error lines appear near the end
      const text = await resp.text();
      const reason = extractReasonFromBuildLog(text);
      if (reason) result.reason = reason;
    }
  } catch {
    // Continue
  }

  return result;
}

// Prepared statements
const upsertBuildStmt = db.prepare(`
  INSERT INTO builds (id, source, external_id, job_name, job_url, status,
    pass_count, fail_count, skip_count, total_count, duration_ms,
    started_at, finished_at, ocp_version, parameters, test_failures,
    raw_payload, failure_class, failure_reason, is_infra, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source, external_id, job_name) DO UPDATE SET
    status=excluded.status, pass_count=excluded.pass_count,
    fail_count=excluded.fail_count, skip_count=excluded.skip_count,
    total_count=excluded.total_count, duration_ms=excluded.duration_ms,
    finished_at=excluded.finished_at, ocp_version=excluded.ocp_version,
    test_failures=excluded.test_failures, raw_payload=excluded.raw_payload,
    updated_at=excluded.updated_at,
    -- Never downgrade a confident infra classification to a weaker one.
    -- Only update when: incoming is infra (is_infra=1), OR stored is not yet
    -- infra (is_infra=0), OR stored class is null/unknown/product_test_failure.
    failure_class = CASE
      WHEN excluded.is_infra = 1 THEN excluded.failure_class
      WHEN builds.is_infra = 1   THEN builds.failure_class
      ELSE excluded.failure_class
    END,
    failure_reason = CASE
      WHEN excluded.is_infra = 1 THEN excluded.failure_reason
      WHEN builds.is_infra = 1   THEN builds.failure_reason
      ELSE excluded.failure_reason
    END,
    is_infra = CASE
      WHEN excluded.is_infra = 1 THEN 1
      WHEN builds.is_infra = 1   THEN 1
      ELSE excluded.is_infra
    END
`);

/**
 * AUTHORITATIVE upsert -- used when THIS pass classified from GCS artifacts
 * (build-log.txt etc.), which is the strongest signal we have. Its result wins
 * unconditionally, including downgrading a stored infra_* label. This is what
 * lets a bad infra classification self-heal: a later GCS-enriched pass can
 * correct it instead of the don't-downgrade guard freezing it forever.
 *
 * The plain upsertBuildStmt (don't-downgrade) is still used for bare-feed
 * re-ingests, where the incoming class was derived only from the "Job failed."
 * feed description and must not clobber a prior GCS-enriched infra label.
 */
const upsertBuildAuthoritativeStmt = db.prepare(`
  INSERT INTO builds (id, source, external_id, job_name, job_url, status,
    pass_count, fail_count, skip_count, total_count, duration_ms,
    started_at, finished_at, ocp_version, parameters, test_failures,
    raw_payload, failure_class, failure_reason, is_infra, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source, external_id, job_name) DO UPDATE SET
    status=excluded.status, pass_count=excluded.pass_count,
    fail_count=excluded.fail_count, skip_count=excluded.skip_count,
    total_count=excluded.total_count, duration_ms=excluded.duration_ms,
    finished_at=excluded.finished_at, ocp_version=excluded.ocp_version,
    test_failures=excluded.test_failures, raw_payload=excluded.raw_payload,
    updated_at=excluded.updated_at,
    failure_class = excluded.failure_class,
    failure_reason = excluded.failure_reason,
    is_infra = excluded.is_infra
`);

const checkActivityStmt = db.prepare(`
  SELECT count(*) AS cnt FROM activities
  WHERE build_id = ? AND activity_type = 'build_completed'
`);

const insertActivityStmt = db.prepare(`
  INSERT INTO activities (id, activity_type, title, description, build_id, actor, metadata, created_at)
  VALUES (?, 'build_completed', ?, ?, ?, 'ingest-prow', ?, ?)
`);

const getBuildIdStmt = db.prepare(`
  SELECT id, failure_class, failure_reason, is_infra FROM builds WHERE source = 'prow' AND external_id = ? AND job_name = ?
`);

export async function run(): Promise<AgentResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  let ingested = 0;
  let skipped = 0;
  let gcsEnrichCount = 0;
  let gcsCapNotified = false;
  const errors: string[] = [];

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'cron', ?, 0, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ api_url: PROW_API_URL }), startedAt);

  try {
    // Fetch ProwJobs from the public API
    const response = await fetch(PROW_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(
        `Prow API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { items?: ProwJob[] };
    const prowJobs = data.items || [];

    // Filter to only relevant CAPA/ROSA jobs
    const relevantJobs = prowJobs.filter((pj) =>
      isRelevantJob(pj.spec.job),
    );
    skipped += prowJobs.length - relevantJobs.length;

    let flooredCount = 0;

    for (const prowJob of relevantJobs) {
      try {
        // Ingest floor: skip builds that started strictly before the floor date.
        // Prow startTime is an ISO 8601 UTC string.
        if (isBeforeFloor(prowJob.status.startTime, INGEST_FLOOR_MS)) {
          flooredCount++;
          skipped++;
          continue;
        }

        const jobName = prowJob.spec.job;
        const externalId =
          prowJob.status.build_id ||
          prowJob.metadata?.name ||
          `${jobName}-${prowJob.status.startTime || 'unknown'}`;
        const status = mapProwState(prowJob.status.state);
        const ocpVersion = extractOcpVersionFromJobName(jobName);
        const durationMs = computeDurationMs(
          prowJob.status.startTime,
          prowJob.status.completionTime,
        );

        // Build test_failures from description when the job failed
        const testFailures =
          status === 'failure'
            ? extractTestFailuresFromDescription(prowJob.status.description)
            : [];

        const failCount = status === 'failure' ? 1 : 0;

        const now = new Date().toISOString();
        const buildId = uuidv4();

        // Check if this build already exists (to avoid unnecessary triage re-invocations)
        const existingBuild = getBuildIdStmt.get(externalId, jobName) as
          | { id: string; failure_class: string | null; failure_reason: string | null; is_infra: number }
          | undefined;
        const isNew = !existingBuild;

        // A build needs re-enrichment when the stored classification is not
        // trustworthy enough to leave alone:
        //   - null / 'unknown' / 'product_test_failure' with is_infra=0
        //     (the defaults when build-log.txt was unavailable), OR
        //   - an infra_* class WITHOUT a failure_reason -- a GCS-confirmed infra
        //     classification always records a non-null failure_reason (see
        //     infraResult()), so a null reason marks a label written by an
        //     older/buggier classifier that never saw GCS data. We re-fetch and
        //     let the authoritative result overwrite it (self-heal). A
        //     GCS-confirmed infra row (non-null reason) is left alone, so we
        //     don't re-fetch GCS for every legit infra build on every cycle.
        //
        // NOTE: 'aborted' is excluded -- classifyFailure() intentionally returns
        // failure_reason=null for aborted builds (there is no reason string), so
        // without this guard every aborted build would match staleInfra and
        // re-fetch GCS on every 5-minute cycle forever, for no benefit.
        const staleInfra =
          existingBuild != null &&
          existingBuild.is_infra === 1 &&
          existingBuild.failure_class !== 'aborted' &&
          (existingBuild.failure_reason == null || existingBuild.failure_reason === '');
        const needsGcsEnrich =
          existingBuild != null &&
          (existingBuild.failure_class == null ||
            existingBuild.failure_class === 'unknown' ||
            existingBuild.failure_class === 'product_test_failure' ||
            staleInfra);

        // Only classify non-passing builds. Success → all null/0.
        let classification: { failure_class: string | null; failure_reason: string | null; is_infra: 0 | 1 };
        // True only when THIS pass actually retrieved GCS artifacts → the
        // resulting classification is authoritative and may overwrite a stored
        // infra label. If the GCS fetch returned nothing (GCS down / all
        // timeouts) the classification is only feed-quality, so we must NOT let
        // it clobber a prior GCS-confirmed infra label -- we fall back to the
        // don't-downgrade upsert in that case.
        let gcsAuthoritative = false;

        if (status !== 'failure' && status !== 'aborted' && status !== 'unstable') {
          classification = { failure_class: null, failure_reason: null, is_infra: 0 };
        } else {
          // Fetch GCS when new OR when the stored classification is not
          // trustworthy (unconfident or a possibly-stale infra label).
          let gcsDescription = prowJob.status.description;
          let gcsReason: string | undefined = prowJob.status.description;
          let gcsTestsPassed: boolean | null = null;

          // Gate GCS enrichment on the per-run cap. When over the cap we skip
          // the fetch: the build keeps its feed-quality classification and the
          // don't-downgrade upsert (gcsAuthoritative stays false) protects any
          // prior GCS-confirmed label. It gets enriched on a later run.
          const wantGcs = isNew || needsGcsEnrich;
          if (wantGcs && gcsEnrichCount >= MAX_GCS_ENRICH_PER_RUN) {
            if (!gcsCapNotified) {
              console.warn(
                `[ingest-prow] GCS enrichment cap reached (${MAX_GCS_ENRICH_PER_RUN}); ` +
                  `remaining builds this run use feed-quality classification and ` +
                  `will be enriched on a subsequent run`,
              );
              gcsCapNotified = true;
            }
          } else if (wantGcs) {
            gcsEnrichCount += 1;
            const artifacts = await fetchProwArtifacts(
              prowJob.status.url,
              jobName,
              externalId,
            );
            if (artifacts.description) gcsDescription = artifacts.description;
            if (artifacts.reason)      gcsReason = artifacts.reason;
            gcsTestsPassed = artifacts.testsPassed;
            // Only treat this classification as authoritative if GCS actually
            // returned something. An all-null result means the fetch failed
            // (GCS unreachable / timeouts) and we learned nothing beyond the
            // feed -- in that case it must not overwrite a stored infra label.
            gcsAuthoritative =
              artifacts.reason != null ||
              artifacts.description != null ||
              artifacts.testsPassed != null;
          }

          classification = classifyFailure({
            status,
            jobName,
            description: gcsDescription,
            reason: gcsReason,
            testsPassed: gcsTestsPassed,
            failCount,
          });
        }

        // Upsert the build. When this pass classified from GCS artifacts the
        // result is authoritative (may overwrite a stale infra label); a
        // bare-feed re-ingest uses the don't-downgrade guard so it can't clobber
        // a prior GCS-enriched infra classification.
        const stmt = gcsAuthoritative ? upsertBuildAuthoritativeStmt : upsertBuildStmt;
        stmt.run(
          buildId,
          'prow',
          externalId,
          jobName,
          prowJob.status.url || null,
          status,
          status === 'success' ? 1 : 0,
          failCount,
          0,
          1,
          durationMs,
          prowJob.status.startTime || null,
          prowJob.status.completionTime || null,
          ocpVersion,
          JSON.stringify({
            prow_job_type: prowJob.spec.type,
            cluster: prowJob.spec.cluster || null,
            refs: prowJob.spec.refs || null,
          }),
          JSON.stringify(testFailures),
          JSON.stringify(prowJob),
          classification.failure_class,
          classification.failure_reason,
          classification.is_infra,
          now,
          now,
        );

        // Resolve actual build id
        const actualBuildId = existingBuild?.id ?? buildId;

        // Fire afterBuildInsert trigger only for genuinely new builds
        if (isNew) {
          afterBuildInsert({
            id: actualBuildId,
            source: 'prow',
            job_name: jobName,
            status,
          });
        }

        // Insert build_completed activity for finished builds (only if not already logged)
        if (prowJob.status.completionTime) {
          const countRow = checkActivityStmt.get(actualBuildId) as { cnt: number };
          if (countRow.cnt === 0) {
            insertActivityStmt.run(
              uuidv4(),
              `Prow job ${jobName} ${status}`,
              `Prow periodic job ${jobName} completed with status: ${status}.${prowJob.status.description ? ' ' + prowJob.status.description : ''}`,
              actualBuildId,
              JSON.stringify({
                source: 'prow',
                job_name: jobName,
                build_id: externalId,
                prow_state: prowJob.status.state,
              }),
              now,
            );
          }
        }

        ingested++;
      } catch (err) {
        errors.push(
          `Error processing Prow job ${prowJob.spec.job}: ${(err as Error).message}`,
        );
      }
    }

    if (flooredCount > 0) {
      console.log(
        `[ingest-prow] skipped ${flooredCount} build(s) before ingest floor ${INGEST_FLOOR_LABEL}`,
      );
    }

    const success = errors.length === 0;
    const message = `Ingested ${ingested} Prow builds${errors.length > 0 ? `, ${errors.length} error(s)` : ''}`;

    db.prepare(`
      UPDATE agent_runs SET success = ?, output_payload = ?, duration_ms = ?,
        error_message = ? WHERE id = ?
    `).run(
      success ? 1 : 0,
      JSON.stringify({ ingested, skipped, errors, total_jobs_fetched: prowJobs.length, relevant_jobs: relevantJobs.length }),
      Date.now() - startTime,
      success ? null : `${errors.length} error(s) during ingestion`,
      runId,
    );

    return { success, message, ingested, skipped, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE agent_runs SET success = 0, error_message = ?, duration_ms = ? WHERE id = ?
    `).run(message, Date.now() - startTime, runId);
    return { success: false, message };
  }
}
