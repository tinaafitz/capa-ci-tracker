// retention-cleanup.ts -- CronJob script for data retention enforcement.
// Runs daily at 3am on OpenShift.
//
// 1. Nulls out raw_payload on builds older than 90 days
// 2. Deletes agent_runs older than 30 days
//
// Usage:
//   node --import tsx jobs/retention-cleanup.ts

import { pool, query, log, recordAgentRun } from './db.js';

async function main() {
  const startTime = Date.now();
  log('INFO', 'retention-cleanup', 'Starting retention cleanup');

  try {
    // Phase 1: Clear raw_payload on builds older than 90 days
    const rawPayloadRes = await query(
      `UPDATE builds
       SET raw_payload = NULL
       WHERE started_at < now() - interval '90 days'
         AND raw_payload IS NOT NULL`,
    );
    const rawPayloadCleared = rawPayloadRes.rowCount ?? 0;
    log('INFO', 'retention-cleanup', `Cleared raw_payload on ${rawPayloadCleared} builds older than 90 days`);

    // Phase 2: Delete agent_runs older than 30 days
    const agentRunsRes = await query(
      `DELETE FROM agent_runs
       WHERE created_at < now() - interval '30 days'`,
    );
    const agentRunsDeleted = agentRunsRes.rowCount ?? 0;
    log('INFO', 'retention-cleanup', `Deleted ${agentRunsDeleted} agent_runs older than 30 days`);

    // Log the agent run
    await recordAgentRun({
      agentName: 'retention-cleanup',
      trigger: 'cron',
      inputPayload: { retention_days_raw_payload: 90, retention_days_agent_runs: 30 },
      outputPayload: {
        raw_payload_cleared: rawPayloadCleared,
        agent_runs_deleted: agentRunsDeleted,
      },
      success: true,
      durationMs: Date.now() - startTime,
    });

    log('INFO', 'retention-cleanup', `Job finished in ${Date.now() - startTime}ms`, {
      rawPayloadCleared,
      agentRunsDeleted,
    });

    await pool.end();
    process.exit(0);
  } catch (err) {
    const errorMessage = (err as Error).message;
    log('ERROR', 'retention-cleanup', `Fatal error: ${errorMessage}`);

    await recordAgentRun({
      agentName: 'retention-cleanup',
      trigger: 'cron',
      inputPayload: {},
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
