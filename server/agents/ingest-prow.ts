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

// Prepared statements
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
  VALUES (?, 'build_completed', ?, ?, ?, 'ingest-prow', ?, ?)
`);

const getBuildIdStmt = db.prepare(`
  SELECT id FROM builds WHERE source = 'prow' AND external_id = ? AND job_name = ?
`);

export async function run(): Promise<AgentResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'cron', ?, 1, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ api_url: PROW_API_URL }), startedAt);

  try {
    // Fetch ProwJobs from the public API
    const response = await fetch(PROW_API_URL, {
      headers: { Accept: 'application/json' },
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

    for (const prowJob of relevantJobs) {
      try {
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

        const now = new Date().toISOString();
        const buildId = uuidv4();

        // Upsert the build
        upsertBuildStmt.run(
          buildId,
          'prow',
          externalId,
          jobName,
          prowJob.status.url || null,
          status,
          status === 'success' ? 1 : 0,
          status === 'failure' ? 1 : 0,
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
          now,
          now,
        );

        // Resolve actual build id
        const actualRow = getBuildIdStmt.get(externalId, jobName) as { id: string } | undefined;
        const actualBuildId = actualRow?.id ?? buildId;

        // Fire afterBuildInsert trigger
        afterBuildInsert({
          id: actualBuildId,
          source: 'prow',
          job_name: jobName,
          status,
        });

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
