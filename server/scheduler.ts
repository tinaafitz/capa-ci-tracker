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
}

/**
 * runIngestOnce — runs both ingest agents sequentially with overlap guards.
 *
 * Returns immediately with ok:false + a typed reason if ingest is disabled
 * ('disabled') or already running ('running'). When the agents actually run,
 * `ok` is derived from their combined success (jenkins.success && prow.success)
 * and no `reason` is set — so a fully-failed run reports ok:false with no reason.
 */
export async function runIngestOnce(): Promise<IngestResult> {
  const disableIngest = process.env.DISABLE_INGEST === 'true';
  if (disableIngest) {
    return { ok: false, reason: 'disabled', message: 'ingest disabled' };
  }

  if (jenkinsRunning || prowRunning) {
    return { ok: false, reason: 'running', message: 'ingest already running' };
  }

  jenkinsRunning = true;
  prowRunning = true;

  let jenkinsResult: AgentResult;
  let prowResult: AgentResult;

  try {
    console.log('[ingest] ingest-jenkins starting');
    jenkinsResult = await ingestJenkins().catch(err => ({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    console.log(`[ingest] ingest-jenkins done: ${jenkinsResult.success ? 'ok' : jenkinsResult.message}`);
  } finally {
    jenkinsRunning = false;
  }

  try {
    console.log('[ingest] ingest-prow starting');
    prowResult = await ingestProw().catch(err => ({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    console.log(`[ingest] ingest-prow done: ${prowResult.success ? 'ok' : prowResult.message}`);
  } finally {
    prowRunning = false;
  }

  // Derive top-level ok from the ACTUAL agent results. If either agent failed
  // internally, ok is false (with no reason) so the endpoint reports a genuine
  // failure rather than a misleading success.
  const ok = jenkinsResult!.success && prowResult!.success;
  return { ok, jenkins: jenkinsResult!, prow: prowResult! };
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

  // ingest-jenkins: daily at 05:00 UTC (env-overridable via INGEST_JENKINS_CRON)
  cron.schedule(jenkinsCron, async () => {
    if (jenkinsRunning || prowRunning) {
      console.log('[cron] ingest-jenkins already running, skipping');
      return;
    }
    jenkinsRunning = true;
    try {
      console.log('[cron] ingest-jenkins starting');
      const result = await ingestJenkins().catch(err => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }));
      console.log(`[cron] ingest-jenkins done: ${result.success ? 'ok' : result.message}`);
    } finally {
      jenkinsRunning = false;
    }
  }, { timezone: 'UTC' });

  // ingest-prow: daily at 05:02 UTC (env-overridable via INGEST_PROW_CRON)
  cron.schedule(prowCron, async () => {
    if (jenkinsRunning || prowRunning) {
      console.log('[cron] ingest-prow already running, skipping');
      return;
    }
    prowRunning = true;
    try {
      console.log('[cron] ingest-prow starting');
      const result = await ingestProw().catch(err => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }));
      console.log(`[cron] ingest-prow done: ${result.success ? 'ok' : result.message}`);
    } finally {
      prowRunning = false;
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
