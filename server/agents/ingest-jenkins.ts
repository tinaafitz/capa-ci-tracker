/**
 * ingest-jenkins -- Node.js agent
 *
 * Polls Jenkins REST API for recent CAPA CI builds and upserts into the builds table.
 * Ported from supabase/functions/ingest-jenkins/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { afterBuildInsert } from '../triggers.js';

const AGENT_NAME = 'ingest-jenkins';

export interface AgentResult {
  success: boolean;
  message: string;
  total_ingested?: number;
  results?: Record<string, { ingested: number; skipped: number; errors: string[] }>;
}

// Jenkins job names to poll
const JENKINS_JOBS = [
  'capi_tests',
  'capi_nightly',
  'rosa_hcp_e2e',
  'capa_e2e_nightly',
  'capa_upgrade_tests',
];

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
 * Fetch wrapper that temporarily disables TLS verification for Jenkins
 * self-signed certs, scoped to the individual request only.
 */
async function fetchJenkins(url: string, options: RequestInit = {}): Promise<Response> {
  if (process.env.JENKINS_SKIP_TLS === 'true') {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      return await fetch(url, options);
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      }
    }
  }
  return fetch(url, options);
}

async function fetchJenkinsApi(baseUrl: string, path: string, user: string, token: string): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const credentials = Buffer.from(`${user}:${token}`).toString('base64');

  const response = await fetchJenkins(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Jenkins API error: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

async function fetchTestReport(
  baseUrl: string,
  buildNumber: number,
  user: string,
  token: string,
): Promise<JenkinsTestReport | null> {
  try {
    const report = (await fetchJenkinsApi(
      baseUrl,
      `/${buildNumber}/testReport/api/json`,
      user,
      token,
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
    raw_payload, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source, external_id, job_name) DO UPDATE SET
    status=excluded.status, pass_count=excluded.pass_count,
    fail_count=excluded.fail_count, skip_count=excluded.skip_count,
    total_count=excluded.total_count, duration_ms=excluded.duration_ms,
    finished_at=excluded.finished_at, ocp_version=excluded.ocp_version,
    test_failures=excluded.test_failures, raw_payload=excluded.raw_payload,
    updated_at=excluded.updated_at
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
  SELECT id FROM builds WHERE source = 'jenkins' AND external_id = ? AND job_name = ?
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
      `/api/json?tree=builds[number,result,timestamp,duration,url,actions[parameters[name,value]]]{0,20}`,
      user,
      token,
    )) as { builds: JenkinsBuild[] };
    builds = data.builds || [];
  } catch (err) {
    result.errors.push(`Failed to fetch builds for ${jobName}: ${(err as Error).message}`);
    return result;
  }

  for (const build of builds) {
    try {
      const parameters = extractParameters(build.actions || []);
      const ocpVersion = extractOcpVersion(parameters);
      const status = mapJenkinsResult(build.result);

      // Fetch test report for completed builds
      let testReport: JenkinsTestReport | null = null;
      if (build.result) {
        testReport = await fetchTestReport(baseUrl, build.number, user, token);
      }

      const testFailures = extractTestFailures(testReport);

      const startedAt = new Date(build.timestamp).toISOString();
      const finishedAt = build.result
        ? new Date(build.timestamp + build.duration).toISOString()
        : null;

      const now = new Date().toISOString();
      const buildId = uuidv4();

      // Upsert the build
      upsertBuildStmt.run(
        buildId,
        'jenkins',
        String(build.number),
        jobName,
        build.url,
        status,
        testReport?.passCount ?? 0,
        testReport?.failCount ?? 0,
        testReport?.skipCount ?? 0,
        (testReport?.passCount ?? 0) + (testReport?.failCount ?? 0) + (testReport?.skipCount ?? 0),
        build.duration || null,
        startedAt,
        finishedAt,
        ocpVersion,
        JSON.stringify(parameters),
        JSON.stringify(testFailures),
        JSON.stringify(build),
        now,
        now,
      );

      // Resolve actual build id (may differ if ON CONFLICT matched existing row)
      const actualRow = getBuildIdStmt.get(String(build.number), jobName) as { id: string } | undefined;
      const actualBuildId = actualRow?.id ?? buildId;

      // Fire afterBuildInsert trigger
      afterBuildInsert({
        id: actualBuildId,
        source: 'jenkins',
        job_name: jobName,
        status,
      });

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
    VALUES (?, ?, 'cron', ?, 1, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ jobs: JENKINS_JOBS }), startedAt);

  try {
    let overallSuccess = true;
    const allResults: Record<string, { ingested: number; skipped: number; errors: string[] }> = {};

    for (const jobName of JENKINS_JOBS) {
      const result = await ingestJob(jobName, JENKINS_BASE_URL, JENKINS_USER, JENKINS_API_TOKEN);
      allResults[jobName] = result;
      if (result.errors.length > 0) {
        overallSuccess = false;
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
