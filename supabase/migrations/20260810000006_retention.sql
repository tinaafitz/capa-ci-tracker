-- Migration: Agent Runs Retention Cleanup
-- Deletes agent_runs older than 180 days, daily at 03:30 UTC.

SELECT cron.schedule(
  'cleanup-agent-runs',
  '30 3 * * *',
  $$
  DELETE FROM agent_runs WHERE created_at < now() - interval '180 days';
  $$
);
