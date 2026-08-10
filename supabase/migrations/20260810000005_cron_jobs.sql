-- Migration: pg_cron + pg_net Scheduling
-- Schedules sub-agent invocations via HTTP calls to Edge Functions.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Jenkins ingestion: every 5 minutes
SELECT cron.schedule(
  'ingest-jenkins',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/ingest-jenkins',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Prow ingestion: every 5 minutes (offset by 2 min to stagger)
SELECT cron.schedule(
  'ingest-prow',
  '2-59/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/ingest-prow',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Resolution tracker: every 15 minutes
SELECT cron.schedule(
  'resolution-tracker',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/resolution-tracker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Retention cleanup: daily at 03:00 UTC, nullify raw_payload older than 90 days
SELECT cron.schedule(
  'retention-cleanup',
  '0 3 * * *',
  $$
  UPDATE builds
  SET raw_payload = NULL
  WHERE raw_payload IS NOT NULL
    AND created_at < now() - interval '90 days';
  $$
);
