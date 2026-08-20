/**
 * Cron scheduler — replaces pg_cron + pg_net scheduling.
 *
 * Registers 6 recurring jobs:
 *   1. ingest-jenkins     every 5 minutes
 *   2. ingest-prow        every 5 minutes (offset +2 min)
 *   3. resolution-tracker every 15 minutes
 *   4. retention cleanup  daily at 03:00 UTC (nullify raw_payload > 90 days)
 *   5. agent_runs cleanup daily at 03:30 UTC (delete > 180 days)
 *   6. build_logs cleanup daily at 03:15 UTC (nullify log_text > 30 days)
 */

import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db/connection.js';
import { run as ingestJenkins } from './agents/ingest-jenkins.js';
import { run as ingestProw } from './agents/ingest-prow.js';
import { run as resolutionTracker } from './agents/resolution-tracker.js';

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
// Scheduler entry point
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  if (config.nodeEnv === 'test') return;

  // Overlap guards — prevent concurrent runs of the same agent
  let jenkinsRunning = false;
  let prowRunning = false;
  let resolutionRunning = false;

  const disableIngest = process.env.DISABLE_INGEST === 'true';

  // ingest-jenkins: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    if (disableIngest) return;
    if (jenkinsRunning) {
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
  });

  // ingest-prow: every 5 minutes, offset by 2 minutes (matches pg_cron '2-59/5')
  cron.schedule('2-59/5 * * * *', async () => {
    if (disableIngest) return;
    if (prowRunning) {
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
  });

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

  console.log('[scheduler] 6 cron jobs registered');
}
