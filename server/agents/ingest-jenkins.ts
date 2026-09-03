/**
 * ingest-jenkins -- Node.js agent
 *
 * Polls Jenkins REST API for recent CAPA CI builds and upserts into the builds table.
 * Ported from supabase/functions/ingest-jenkins/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { Agent, fetch as undiciFetch } from 'undici';
import { db } from '../db/connection.js';
import { afterBuildInsert } from '../triggers.js';
import { classifyFailure } from './classify-failure.js';
import { INGEST_FLOOR_MS, INGEST_FLOOR_LABEL, isBeforeFloor } from './ingest-floor.js';

const AGENT_NAME = 'ingest-jenkins';

export interface AgentResult {
  success: boolean;
  message: string;
  total_ingested?: number;
  results?: Record<string, { ingested: number; skipped: number; errors: string[] }>;
}

// Jenkins job names to poll.
//
// Only `capi_tests` is a real job today; the other historical names 404. The
// list is env-overridable via JENKINS_JOBS (comma-separated), mirroring the
// env-driven config pattern used in ingest-prow.ts (PROW_API_URL). Empty/blank
// entries are trimmed and dropped; an empty/unset env var falls back to the
// default of a single job.
const DEFAULT_JENKINS_JOBS = ['capi_tests'];

const JENKINS_JOBS = (() => {
  const raw = process.env.JENKINS_JOBS;
  if (!raw) return DEFAULT_JENKINS_JOBS;
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_JENKINS_JOBS;
})();

// Per-job wall-clock guard. AbortSignal.timeout on individual requests does not
// reliably abort a stalled TLS read (see fetchJenkins note above), and a single
// job serially awaits up to ~20 test-report fetches (each up to 60s), so one
// wedged job could otherwise hang the whole run indefinitely. This bounds total
// time spent in any single ingestJob() call. Env-overridable via
// JENKINS_JOB_TIMEOUT_MS (default 90s).
const JOB_TIMEOUT_MS = (() => {
  const raw = process.env.JENKINS_JOB_TIMEOUT_MS;
  if (!raw) return 90_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
})();

interface JenkinsBuild {
  number: number;
  result: string | null;
  timestamp: number;
  duration: number;
  url: string;
  actions: Array<{
    _class?: string;
    parameters?: Array<{ name: string; value: string }>;
  }>;
}

interface JenkinsTestCase {
  name: string;
  className: string;
  status: string;
  errorDetails: string | null;
  errorStackTrace: string | null;
}

interface JenkinsTestReport {
  passCount: number;
  failCount: number;
  skipCount: number;
  suites: Array<{
    cases: JenkinsTestCase[];
  }>;
}

function mapJenkinsResult(result: string | null): string {
  if (!result) return 'running';
  switch (result.toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'failure';
    case 'ABORTED':
      return 'aborted';
    case 'UNSTABLE':
      return 'unstable';
    default:
      return 'pending';
  }
}

function extractParameters(
  actions: JenkinsBuild['actions'],
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const action of actions) {
    if (action.parameters) {
      for (const p of action.parameters) {
        params[p.name] = p.value;
      }
    }
  }
  return params;
}

function extractOcpVersion(params: Record<string, string>): string | null {
  for (const key of [
    'OCP_VERSION',
    'OPENSHIFT_VERSION',
    'ocp_version',
    'VERSION',
  ]) {
    if (params[key]) return params[key];
  }
  return null;
}

/**
 * Fetch wrapper that disables TLS verification for Jenkins
 * self-signed certs using a scoped undici Agent -- no global env mutation.
 */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

async function fetchJenkins(url: string, options: RequestInit = {}): Promise<Response> {
  if (process.env.JENKINS_SKIP_TLS === 'true') {
    // Use undici's own fetch to avoid Node 24 built-in undici version mismatch
    return undiciFetch(url, { ...options, dispatcher: insecureAgent } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }
  return fetch(url, options);
}

async function fetchJenkinsApi(baseUrl: string, path: string, user: string, token: string, timeoutMs = 30_000): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const credentials = Buffer.from(`${user}:${token}`).toString('base64');

  const response = await fetchJenkins(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Jenkins API error: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

async function fetchTestReport(
  baseUrl: string,
  jobName: string,
  buildNumber: number,
  user: string,
  token: string,
): Promise<JenkinsTestReport | null> {
  try {
    const report = (await fetchJenkinsApi(
      baseUrl,
      `/job/CI-Jobs/job/${jobName}/${buildNumber}/testReport/api/json`,
      user,
      token,
      60_000,  // 60s timeout for potentially large test reports
    )) as JenkinsTestReport;
    return report;
  } catch {
    // Test report may not exist for all builds (e.g., aborted builds)
    return null;
  }
}

function extractTestFailures(
  report: JenkinsTestReport | null,
): Array<{
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}> {
  if (!report) return [];
  const failures: Array<{
    name: string;
    className: string;
    errorMessage: string;
    errorStackTrace: string;
  }> = [];

  for (const suite of report.suites || []) {
    for (const testCase of suite.cases || []) {
      if (testCase.status === 'FAILED' || testCase.status === 'REGRESSION') {
        failures.push({
          name: testCase.name,
          className: testCase.className,
          errorMessage: testCase.errorDetails || '',
          errorStackTrace: testCase.errorStackTrace || '',
        });
      }
    }
  }

  return failures;
}

// Prepared statements for upsert and activity check/insert
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
    -- Jenkins classification is deterministic from the build's own test report,
    -- which is fetched on every pass. The freshly-computed value is therefore
    -- always authoritative -- take it unconditionally. (An upgrade-only rule
    -- here would permanently freeze any misclassification, since a bad infra
    -- label could never be corrected on re-ingest. See self-heal note below.)
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
  VALUES (?, 'build_completed', ?, ?, ?, 'ingest-jenkins', ?, ?)
`);

const getBuildIdStmt = db.prepare(`
  SELECT id, failure_class, failure_reason, is_infra FROM builds WHERE source = 'jenkins' AND external_id = ? AND job_name = ?
`);

async function ingestJob(
  jobName: string,
  baseUrl: string,
  user: string,
  token: string,
): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const result = { ingested: 0, skipped: 0, errors: [] as string[] };

  // Fetch recent builds from Jenkins (last 20)
  let builds: JenkinsBuild[];
  try {
    const data = (await fetchJenkinsApi(
      baseUrl,
      `/job/CI-Jobs/job/${jobName}/api/json?tree=builds[number,result,timestamp,duration,url,actions[parameters[name,value]]]{0,20}`,
      user,
      token,
    )) as { builds: JenkinsBuild[] };
    builds = data.builds || [];
  } catch (err) {
    result.errors.push(`Failed to fetch builds for ${jobName}: ${(err as Error).message}`);
    return result;
  }

  let flooredCount = 0;

  for (const build of builds) {
    try {
      // Ingest floor: skip builds that started strictly before the floor date.
      // Jenkins `timestamp` is epoch-ms (UTC), compared directly.
      if (isBeforeFloor(build.timestamp, INGEST_FLOOR_MS)) {
        flooredCount++;
        result.skipped++;
        continue;
      }

      const parameters = extractParameters(build.actions || []);
      const ocpVersion = extractOcpVersion(parameters);
      const status = mapJenkinsResult(build.result);

      // Fetch test report for completed builds
      let testReport: JenkinsTestReport | null = null;
      if (build.result) {
        testReport = await fetchTestReport(baseUrl, jobName, build.number, user, token);
      }

      const testFailures = extractTestFailures(testReport);
      const failCount = testReport?.failCount ?? 0;

      // For Jenkins, testsPassed = all test runs found but none failed,
      // while the overall build is still "failure" (post-test infra step failed).
      const passCount = testReport?.passCount ?? 0;
      const testsPassed: boolean | null =
        testReport != null ? failCount === 0 && passCount > 0 : null;

      const startedAt = new Date(build.timestamp).toISOString();
      const finishedAt = build.result
        ? new Date(build.timestamp + build.duration).toISOString()
        : null;

      const now = new Date().toISOString();
      const buildId = uuidv4();

      // Check if this build already exists (to avoid unnecessary triage re-invocations)
      const existingBuild = getBuildIdStmt.get(String(build.number), jobName) as
        | { id: string; failure_class: string | null; failure_reason: string | null; is_infra: number }
        | undefined;
      const isNew = !existingBuild;

      // Success builds get null classification, not 'unknown'.
      //
      // SELF-HEAL: for failure/aborted/unstable builds we re-run the classifier
      // and let the fresh value win (see the upsert above, which takes
      // excluded.* unconditionally). Jenkins classification is deterministic
      // from the test report, so a fresh classification is authoritative and a
      // bad label (e.g. an infra class from an older classifier) corrects itself
      // on the next ingest instead of requiring a manual backfill.
      //
      // GUARD: the classifier is only trustworthy when the test report was
      // actually fetched this pass. fetchTestReport() swallows all errors and
      // returns null on a transient failure (timeout / 5xx / flake), which would
      // make failCount collapse to 0 and misclassify a real product failure as
      // 'unknown'. When the report is unavailable AND we already have a stored
      // classification, preserve the stored value rather than overwrite it with
      // a value derived from no data. (For a brand-new build with no report we
      // still classify — 'unknown' is the honest answer there.)
      let classification: { failure_class: string | null; failure_reason: string | null; is_infra: 0 | 1 };

      if (status !== 'failure' && status !== 'aborted' && status !== 'unstable') {
        classification = { failure_class: null, failure_reason: null, is_infra: 0 };
      } else if (testReport == null && existingBuild != null && existingBuild.failure_class != null) {
        // No fresh data this pass — keep what we already know.
        classification = {
          failure_class: existingBuild.failure_class,
          failure_reason: existingBuild.failure_reason,
          is_infra: (existingBuild.is_infra ? 1 : 0),
        };
      } else {
        const firstFailureReason =
          testFailures.length > 0
            ? testFailures[0].errorMessage || testFailures[0].name
            : undefined;

        classification = classifyFailure({
          status,
          jobName,
          reason: firstFailureReason,
          testsPassed,
          failCount,
        });
      }

      // Upsert the build
      upsertBuildStmt.run(
        buildId,
        'jenkins',
        String(build.number),
        jobName,
        build.url,
        status,
        passCount,
        failCount,
        testReport?.skipCount ?? 0,
        passCount + failCount + (testReport?.skipCount ?? 0),
        build.duration || null,
        startedAt,
        finishedAt,
        ocpVersion,
        JSON.stringify(parameters),
        JSON.stringify(testFailures),
        JSON.stringify(build),
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
          source: 'jenkins',
          job_name: jobName,
          status,
        });
      }

      // Insert build_completed activity for finished builds (only if not already logged)
      if (build.result) {
        const countRow = checkActivityStmt.get(actualBuildId) as { cnt: number };
        if (countRow.cnt === 0) {
          insertActivityStmt.run(
            uuidv4(),
            `Build #${build.number} ${status}`,
            `Jenkins job ${jobName} build #${build.number} completed with status: ${status}. ${testReport?.failCount ?? 0} test failures.`,
            actualBuildId,
            JSON.stringify({
              source: 'jenkins',
              job_name: jobName,
              build_number: build.number,
              pass_count: testReport?.passCount ?? 0,
              fail_count: testReport?.failCount ?? 0,
            }),
            now,
          );
        }
      }

      result.ingested++;
    } catch (err) {
      result.errors.push(
        `Error processing build #${build.number}: ${(err as Error).message}`,
      );
    }
  }

  if (flooredCount > 0) {
    console.log(
      `[ingest-jenkins] ${jobName}: skipped ${flooredCount} build(s) before ingest floor ${INGEST_FLOOR_LABEL}`,
    );
  }

  return result;
}

export async function run(): Promise<AgentResult> {
  const JENKINS_BASE_URL = process.env.JENKINS_BASE_URL;
  const JENKINS_USER = process.env.JENKINS_USER;
  const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;

  if (!JENKINS_BASE_URL || !JENKINS_USER || !JENKINS_API_TOKEN) {
    console.warn('[ingest-jenkins] Missing JENKINS_BASE_URL, JENKINS_USER, or JENKINS_API_TOKEN -- skipping');
    return { success: false, message: 'Missing Jenkins configuration environment variables' };
  }

  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'cron', ?, 0, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ jobs: JENKINS_JOBS }), startedAt);

  try {
    let overallSuccess = true;
    const allResults: Record<string, { ingested: number; skipped: number; errors: string[] }> = {};

    for (const jobName of JENKINS_JOBS) {
      // Wall-clock guard around each job. A wedged job rejects the race after
      // JOB_TIMEOUT_MS; the catch below records it, flips overallSuccess, and
      // the loop continues to the next job (same path as any ingestJob error).
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          ingestJob(jobName, JENKINS_BASE_URL, JENKINS_USER, JENKINS_API_TOKEN),
          new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error(`job ${jobName} timed out after ${JOB_TIMEOUT_MS}ms`)),
              JOB_TIMEOUT_MS,
            );
          }),
        ]);
        allResults[jobName] = result;
        if (result.errors.length > 0) {
          overallSuccess = false;
        }
      } catch (err) {
        // Timeout (or an unexpected throw from ingestJob) — record and move on.
        allResults[jobName] = {
          ingested: 0,
          skipped: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        };
        overallSuccess = false;
      } finally {
        // Clear the timer on the winning branch so no dangling handle keeps the
        // event loop (and process) alive after the job completes.
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }

    const totalIngested = Object.values(allResults).reduce((sum, r) => sum + r.ingested, 0);
    const totalErrors = Object.values(allResults).reduce((sum, r) => sum + r.errors.length, 0);

    const message = `Ingested ${totalIngested} builds${totalErrors > 0 ? `, ${totalErrors} error(s)` : ''}`;

    db.prepare(`
      UPDATE agent_runs SET success = ?, output_payload = ?, duration_ms = ?,
        error_message = ? WHERE id = ?
    `).run(
      overallSuccess ? 1 : 0,
      JSON.stringify(allResults),
      Date.now() - startTime,
      overallSuccess ? null : `${totalErrors} error(s) across jobs`,
      runId,
    );

    return { success: overallSuccess, message, total_ingested: totalIngested, results: allResults };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE agent_runs SET success = 0, error_message = ?, duration_ms = ? WHERE id = ?
    `).run(message, Date.now() - startTime, runId);
    return { success: false, message };
  }
}
