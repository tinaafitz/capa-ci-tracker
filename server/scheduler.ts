/**
 * Cron scheduler — replaces pg_cron + pg_net scheduling.
 *
 * Registers 6 recurring jobs:
 *   1. ingest-jenkins     daily at 05:00 UTC (after CI jobs finish ~04:00 UTC)
 *   2. ingest-prow        daily at 05:02 UTC (after CI jobs finish ~04:00 UTC)
 *   3. resolution-tracker every 15 minutes
 *   4. retention cleanup  daily at 03:00 UTC (nullify raw_payload > 90 days)
 *   5. agent_runs cleanup daily at 03:30 UTC (delete > 180 days)
 *   6. build_logs cleanup daily at 03:15 UTC (nullify log_text > 30 days)
 *
 * Ingest cadence is env-overridable:
 *   INGEST_JENKINS_CRON — cron expression for ingest-jenkins (default: '0 5 * * *')
 *   INGEST_PROW_CRON    — cron expression for ingest-prow    (default: '2 5 * * *')
 * Invalid expressions fall back to the defaults with a console.warn.
 *
 * Set DISABLE_INGEST=true to prevent all ingest runs (cron and on-demand).
 */

import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db/connection.js';
import { run as ingestJenkins } from './agents/ingest-jenkins.js';
import { run as ingestProw } from './agents/ingest-prow.js';
import { run as resolutionTracker } from './agents/resolution-tracker.js';
import type { AgentResult } from './agents/ingest-jenkins.js';

// ---------------------------------------------------------------------------
// Retention helpers
// ---------------------------------------------------------------------------

/** Nullify raw_payload on builds older than 90 days. */
function retentionCleanup(): void {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    `UPDATE builds SET raw_payload = NULL WHERE started_at < ? AND raw_payload IS NOT NULL`
  ).run(cutoff);
  console.log(`[retention] nullified raw_payload on ${result.changes} builds`);
}

/** Delete agent_runs older than 180 days. */
function agentRunsCleanup(): void {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    `DELETE FROM agent_runs WHERE created_at < ?`
  ).run(cutoff);
  console.log(`[retention] deleted ${result.changes} old agent_runs`);
}

/** Nullify log_text on build_logs older than 30 days. */
function buildLogsCleanup(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    `UPDATE build_logs SET log_text = NULL WHERE fetched_at < ? AND log_text IS NOT NULL`
  ).run(cutoff);
  console.log(`[retention] nullified log_text on ${result.changes} build_logs`);
}

// ---------------------------------------------------------------------------
// Overlap guards — shared state so cron and on-demand calls share the same lock
// ---------------------------------------------------------------------------

let jenkinsRunning = false;
let prowRunning = false;

// ---------------------------------------------------------------------------
// On-demand ingest runner (shared by cron callbacks and the refresh endpoint)
// ---------------------------------------------------------------------------

export interface IngestResult {
  ok: boolean;
  /**
   * Machine-readable discriminator for the two non-failure "not-run" cases.
   * Absent when the agents actually ran (ok reflects their combined success).
   *   'disabled' — ingest is turned off via DISABLE_INGEST
   *   'running'  — a scheduled or manual run is already in progress
   */
  reason?: 'disabled' | 'running';
  message?: string;
  jenkins?: AgentResult;
  prow?: AgentResult;
  /** Which sources were actually run this call (echoes the request). */
  sources?: { jenkins: boolean; prow: boolean };
}

/** Which ingest sources to run. Both default to true (preserves old callers). */
export interface IngestSources {
  jenkins?: boolean;
  prow?: boolean;
}

// Overall per-source wall-clock guard. This is the outer safety net that bounds
// the whole HTTP request (the endpoint awaits runIngestOnce before responding).
// Even with the per-job guard in the Jenkins agent, this guarantees the request
// resolves and — critically — that the running guard is released via `finally`
// so a wedged run cannot permanently 409-lock future refreshes. Env-overridable
// via INGEST_RUN_TIMEOUT_MS (default 300s = 5min).
const INGEST_RUN_TIMEOUT_MS = (() => {
  const raw = process.env.INGEST_RUN_TIMEOUT_MS;
  if (!raw) return 300_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
})();

/**
 * Run an ingest agent under a wall-clock timeout, never throwing. On timeout,
 * resolves to a synthesized failed AgentResult (rather than rejecting) so the
 * caller's `finally` still runs and the endpoint returns a clean failure.
 * Clears the timer on the winning branch to avoid a dangling handle.
 */
async function runAgentWithTimeout(
  label: string,
  agent: () => Promise<AgentResult>,
): Promise<AgentResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      agent().catch(err => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      })),
      new Promise<AgentResult>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve({ success: false, message: `${label} ingest timed out` }),
          INGEST_RUN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * runIngestOnce — runs the requested ingest agent(s) sequentially with overlap
 * guards and per-source wall-clock timeouts.
 *
 * `sources` selects which agents to run (both default true, preserving the cron
 * and no-arg callers). Each requested source has its own running-guard: if the
 * requested source is already running, returns ok:false + reason 'running'; a
 * busy *other* source does NOT block the requested one.
 *
 * Returns immediately with ok:false + a typed reason if ingest is disabled
 * ('disabled') or the requested source(s) are already running ('running'). When
 * the agents actually run, `ok` is derived from their combined success (only the
 * sources that ran count) and no `reason` is set.
 */
export async function runIngestOnce(sources?: IngestSources): Promise<IngestResult> {
  const runJenkins = sources?.jenkins ?? true;
  const runProw = sources?.prow ?? true;
  const ranSources = { jenkins: runJenkins, prow: runProw };

  const disableIngest = process.env.DISABLE_INGEST === 'true';
  if (disableIngest) {
    return { ok: false, reason: 'disabled', message: 'ingest disabled', sources: ranSources };
  }

  // Only 409 if a REQUESTED source is already running. A busy source we're not
  // asked to run must not block the one we are.
  if ((runJenkins && jenkinsRunning) || (runProw && prowRunning)) {
    return { ok: false, reason: 'running', message: 'ingest already running', sources: ranSources };
  }

  let jenkinsResult: AgentResult | undefined;
  let prowResult: AgentResult | undefined;

  if (runJenkins) {
    jenkinsRunning = true;
    try {
      console.log('[ingest] ingest-jenkins starting');
      jenkinsResult = await runAgentWithTimeout('jenkins', ingestJenkins);
      console.log(`[ingest] ingest-jenkins done: ${jenkinsResult.success ? 'ok' : jenkinsResult.message}`);
    } finally {
      jenkinsRunning = false;
    }
  }

  if (runProw) {
    prowRunning = true;
    try {
      console.log('[ingest] ingest-prow starting');
      prowResult = await runAgentWithTimeout('prow', ingestProw);
      console.log(`[ingest] ingest-prow done: ${prowResult.success ? 'ok' : prowResult.message}`);
    } finally {
      prowRunning = false;
    }
  }

  // Derive top-level ok from the ACTUAL agent results — but only from sources
  // that actually ran. A source that wasn't requested doesn't drag ok to false.
  const ok =
    (!runJenkins || jenkinsResult!.success) &&
    (!runProw || prowResult!.success);

  const result: IngestResult = { ok, sources: ranSources };
  if (jenkinsResult) result.jenkins = jenkinsResult;
  if (prowResult) result.prow = prowResult;
  return result;
}

// ---------------------------------------------------------------------------
// Env-overridable cron expression helpers
// ---------------------------------------------------------------------------

const DEFAULT_JENKINS_CRON = '0 5 * * *';
const DEFAULT_PROW_CRON = '2 5 * * *';

function resolveExpr(envVar: string, defaultExpr: string): string {
  const val = process.env[envVar];
  if (!val) return defaultExpr;
  if (cron.validate(val)) return val;
  console.warn(
    `[scheduler] Invalid cron expression in ${envVar}="${val}"; falling back to default "${defaultExpr}"`
  );
  return defaultExpr;
}

// ---------------------------------------------------------------------------
// Scheduler entry point
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  if (config.nodeEnv === 'test') return;

  // Overlap guard for resolution-tracker (local to scheduler, not shared externally)
  let resolutionRunning = false;

  const jenkinsCron = resolveExpr('INGEST_JENKINS_CRON', DEFAULT_JENKINS_CRON);
  const prowCron = resolveExpr('INGEST_PROW_CRON', DEFAULT_PROW_CRON);

  // ingest-jenkins: daily at 05:00 UTC (env-overridable via INGEST_JENKINS_CRON).
  //
  // Delegates to runIngestOnce so the scheduled path gets the SAME overall-run
  // wall-clock timeout and guaranteed guard release as the manual
  // /api/refresh-ingest path. runIngestOnce owns the running guard and the
  // 'running'/'disabled' short-circuits, so we must NOT set jenkinsRunning here
  // (that would double-acquire and self-409).
  cron.schedule(jenkinsCron, async () => {
    console.log('[cron] ingest-jenkins starting');
    const result = await runIngestOnce({ jenkins: true, prow: false }).catch(err => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    if (result.ok) {
      console.log('[cron] ingest-jenkins done: ok');
    } else {
      const reason = 'reason' in result ? result.reason : undefined;
      const agentMsg = 'jenkins' in result ? result.jenkins?.message : undefined;
      const detail = reason ?? agentMsg ?? result.message ?? 'failed';
      console.log(`[cron] ingest-jenkins done: ${detail}`);
    }
  }, { timezone: 'UTC' });

  // ingest-prow: daily at 05:02 UTC (env-overridable via INGEST_PROW_CRON).
  // Same delegation as Jenkins above — bounded by the overall-run timeout, with
  // the running guard managed entirely by runIngestOnce.
  cron.schedule(prowCron, async () => {
    console.log('[cron] ingest-prow starting');
    const result = await runIngestOnce({ jenkins: false, prow: true }).catch(err => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    if (result.ok) {
      console.log('[cron] ingest-prow done: ok');
    } else {
      const reason = 'reason' in result ? result.reason : undefined;
      const agentMsg = 'prow' in result ? result.prow?.message : undefined;
      const detail = reason ?? agentMsg ?? result.message ?? 'failed';
      console.log(`[cron] ingest-prow done: ${detail}`);
    }
  }, { timezone: 'UTC' });

  // resolution-tracker: every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    if (resolutionRunning) {
      console.log('[cron] resolution-tracker already running, skipping');
      return;
    }
    resolutionRunning = true;
    try {
      console.log('[cron] resolution-tracker starting');
      const result = await resolutionTracker().catch(err => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }));
      console.log(`[cron] resolution-tracker done: ${result.success ? 'ok' : result.message}`);
    } finally {
      resolutionRunning = false;
    }
  });

  // retention cleanup: daily at 03:00 UTC
  cron.schedule('0 3 * * *', () => {
    console.log('[cron] retention cleanup starting');
    try {
      retentionCleanup();
    } catch (err) {
      console.error('[cron] retention cleanup error:', err instanceof Error ? err.message : err);
    }
  }, { timezone: 'UTC' });

  // build_logs cleanup: daily at 03:15 UTC
  cron.schedule('15 3 * * *', () => {
    console.log('[cron] build_logs cleanup starting');
    try {
      buildLogsCleanup();
    } catch (err) {
      console.error('[cron] build_logs cleanup error:', err instanceof Error ? err.message : err);
    }
  }, { timezone: 'UTC' });

  // agent_runs cleanup: daily at 03:30 UTC
  cron.schedule('30 3 * * *', () => {
    console.log('[cron] agent_runs cleanup starting');
    try {
      agentRunsCleanup();
    } catch (err) {
      console.error('[cron] agent_runs cleanup error:', err instanceof Error ? err.message : err);
    }
  }, { timezone: 'UTC' });

  console.log(
    `[scheduler] 6 cron jobs registered (jenkins: ${jenkinsCron}, prow: ${prowCron})`
  );
}
