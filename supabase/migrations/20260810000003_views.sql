-- Migration: Views
-- v_ticket_summary, v_build_failures, v_daily_build_stats

-- ============================================================
-- v_ticket_summary
-- Flattened view joining tickets with originating build data.
-- Used by the Tickets list and Ticket detail views.
-- ============================================================

CREATE OR REPLACE VIEW v_ticket_summary AS
SELECT
  t.id,
  t.ticket_number,
  t.title,
  t.status,
  t.severity,
  t.assignee,
  t.error_signature,
  t.root_cause,
  t.root_cause_category,
  t.fix_pr_url,
  t.fix_pr_number,
  t.upstream_issue_url,
  t.jira_key,
  t.labels,
  t.created_at,
  t.updated_at,
  t.resolved_at,
  t.verified_at,
  -- Originating build info
  b.job_name       AS build_job_name,
  b.job_url        AS build_job_url,
  b.source         AS build_source,
  b.status         AS build_status,
  b.ocp_version    AS build_ocp_version,
  b.started_at     AS build_started_at,
  b.fail_count     AS build_fail_count,
  -- Task counts (subquery to avoid GROUP BY explosion)
  (SELECT count(*)       FROM tasks tk WHERE tk.ticket_id = t.id)                       AS task_count,
  (SELECT count(*)       FROM tasks tk WHERE tk.ticket_id = t.id AND tk.status = 'done') AS tasks_done,
  -- Activity count
  (SELECT count(*)       FROM activities a WHERE a.ticket_id = t.id)                     AS activity_count,
  -- Time-to-resolve (NULL if not yet resolved)
  EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))::int AS ttf_seconds
FROM support_tickets t
LEFT JOIN builds b ON t.build_id = b.id;

-- ============================================================
-- v_build_failures
-- Failed/unstable builds with test_failures. Used by the
-- Transactions tab failure trend chart and by the triage agent.
-- ============================================================

CREATE OR REPLACE VIEW v_build_failures AS
SELECT
  b.id,
  b.source,
  b.external_id,
  b.job_name,
  b.job_url,
  b.status,
  b.fail_count,
  b.total_count,
  b.ocp_version,
  b.started_at,
  b.finished_at,
  b.duration_ms,
  b.test_failures,
  b.created_at,
  -- Whether a ticket already exists for this build
  EXISTS (SELECT 1 FROM support_tickets st WHERE st.build_id = b.id) AS has_ticket
FROM builds b
WHERE b.status IN ('failure', 'unstable');

-- ============================================================
-- v_daily_build_stats
-- Aggregated daily build statistics for the trend chart.
-- ============================================================

CREATE OR REPLACE VIEW v_daily_build_stats AS
SELECT
  date_trunc('day', started_at)::date AS build_date,
  source,
  job_name,
  count(*)                                                     AS total_builds,
  count(*) FILTER (WHERE status = 'success')                   AS success_count,
  count(*) FILTER (WHERE status = 'failure')                   AS failure_count,
  count(*) FILTER (WHERE status = 'unstable')                  AS unstable_count,
  count(*) FILTER (WHERE status = 'aborted')                   AS aborted_count,
  round(
    count(*) FILTER (WHERE status = 'success')::numeric
    / NULLIF(count(*), 0) * 100, 1
  )                                                            AS success_rate,
  avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)      AS avg_duration_ms
FROM builds
WHERE started_at IS NOT NULL
GROUP BY date_trunc('day', started_at)::date, source, job_name;
