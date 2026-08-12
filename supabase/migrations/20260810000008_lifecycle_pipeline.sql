-- Migration: Lifecycle Pipeline View
-- Adds timestamp columns for pipeline stage tracking
-- and the v_ticket_lifecycle view for the Pipeline page.

-- ============================================================
-- Add milestone timestamp columns to support_tickets
-- ============================================================

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS diagnosed_at  TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS pr_merged_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_diagnosed_at
  ON support_tickets (diagnosed_at) WHERE diagnosed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_pr_merged_at
  ON support_tickets (pr_merged_at) WHERE pr_merged_at IS NOT NULL;

-- ============================================================
-- v_ticket_lifecycle
-- Exposes pipeline stage, timestamps, and durations for each
-- ticket. Used by both the per-ticket stepper and the overview
-- funnel aggregation.
-- ============================================================

CREATE OR REPLACE VIEW v_ticket_lifecycle AS
SELECT
  t.id,
  t.ticket_number,
  t.title,
  t.status,
  t.severity,
  t.assignee,

  -- Pipeline stage (ordinal 1-6 for sorting and funnel display)
  CASE
    WHEN t.verified_at     IS NOT NULL THEN 6
    WHEN t.pr_merged_at    IS NOT NULL THEN 5
    WHEN t.fix_pr_url      IS NOT NULL THEN 4
    WHEN t.diagnosed_at    IS NOT NULL THEN 3
    WHEN t.id              IS NOT NULL THEN 2  -- ticket exists = created
    ELSE 1                                      -- should not happen for tickets
  END AS pipeline_stage,

  CASE
    WHEN t.verified_at     IS NOT NULL THEN 'fix_verified'
    WHEN t.pr_merged_at    IS NOT NULL THEN 'pr_merged'
    WHEN t.fix_pr_url      IS NOT NULL THEN 'pr_submitted'
    WHEN t.diagnosed_at    IS NOT NULL THEN 'root_cause_diagnosed'
    WHEN t.id              IS NOT NULL THEN 'ticket_created'
    ELSE 'build_failed'
  END AS pipeline_stage_name,

  -- Stage timestamps (all nullable)
  b.finished_at            AS build_failed_at,
  t.created_at             AS ticket_created_at,
  t.diagnosed_at           AS diagnosed_at,
  -- For pr_submitted_at, use the fix_submitted activity timestamp
  -- or fall back to updated_at when fix_pr_url was set.
  -- Using a subquery to get the exact activity timestamp:
  (SELECT MIN(a.created_at)
   FROM activities a
   WHERE a.ticket_id = t.id
     AND a.activity_type = 'fix_submitted'
  )                        AS pr_submitted_at,
  t.pr_merged_at           AS pr_merged_at,
  t.verified_at            AS verified_at,

  -- Originating build info (for "Build Failed" stage link)
  t.build_id,
  b.job_name               AS build_job_name,
  b.job_url                AS build_job_url,
  b.source                 AS build_source,
  b.external_id            AS build_external_id,

  -- Fix PR info (for "PR Submitted" / "PR Merged" stage links)
  t.fix_pr_url,
  t.fix_pr_number,

  -- Verification build info (for "Fix Verified" stage link)
  t.verified_in_build_id,
  vb.job_name              AS verify_build_job_name,
  vb.job_url               AS verify_build_job_url,
  vb.external_id           AS verify_build_external_id,

  -- Duration metrics (seconds, NULL when stages not reached)
  EXTRACT(EPOCH FROM (t.created_at    - b.finished_at))::int   AS build_to_ticket_seconds,
  EXTRACT(EPOCH FROM (t.diagnosed_at  - t.created_at))::int    AS ticket_to_diagnosis_seconds,
  EXTRACT(EPOCH FROM (t.pr_merged_at  - t.diagnosed_at))::int  AS diagnosis_to_merge_seconds,
  EXTRACT(EPOCH FROM (t.verified_at   - t.pr_merged_at))::int  AS merge_to_verify_seconds,
  EXTRACT(EPOCH FROM (t.verified_at   - b.finished_at))::int   AS total_lifecycle_seconds,
  -- Time-to-resolve (same as v_ticket_summary for consistency)
  EXTRACT(EPOCH FROM (t.resolved_at   - t.created_at))::int    AS ttf_seconds

FROM support_tickets t
LEFT JOIN builds b  ON t.build_id = b.id
LEFT JOIN builds vb ON t.verified_in_build_id = vb.id;

-- ============================================================
-- v_pipeline_funnel
-- Pre-aggregated funnel counts by pipeline stage.
-- Designed for the overview funnel chart -- single query,
-- no client-side aggregation needed.
-- ============================================================

CREATE OR REPLACE VIEW v_pipeline_funnel AS
SELECT
  stage.name                                        AS stage_name,
  stage.ordinal                                     AS stage_ordinal,
  count(t.id)                                       AS ticket_count,
  count(t.id) FILTER (WHERE t.severity = 'nightly_blocker')   AS nightly_blocker_count,
  count(t.id) FILTER (WHERE t.severity = 'upstream_breakage') AS upstream_breakage_count,
  count(t.id) FILTER (WHERE t.severity = 'infrastructure')   AS infrastructure_count,
  count(t.id) FILTER (WHERE t.severity = 'test_regression')   AS test_regression_count,
  count(t.id) FILTER (WHERE t.severity = 'flaky')             AS flaky_count,
  -- Median time spent at this stage (across all tickets that have passed through it)
  percentile_cont(0.5) WITHIN GROUP (ORDER BY
    CASE stage.ordinal
      WHEN 2 THEN EXTRACT(EPOCH FROM (t.created_at   - COALESCE(b.finished_at, t.created_at)))
      WHEN 3 THEN EXTRACT(EPOCH FROM (t.diagnosed_at - t.created_at))
      WHEN 4 THEN EXTRACT(EPOCH FROM (COALESCE(t.pr_merged_at, now()) - t.diagnosed_at))
      WHEN 5 THEN EXTRACT(EPOCH FROM (t.pr_merged_at - t.diagnosed_at))
      WHEN 6 THEN EXTRACT(EPOCH FROM (t.verified_at  - t.pr_merged_at))
      ELSE NULL
    END
  )::int                                            AS median_stage_duration_seconds
FROM (
  VALUES
    ('ticket_created',        2),
    ('root_cause_diagnosed',  3),
    ('pr_submitted',          4),
    ('pr_merged',             5),
    ('fix_verified',          6)
) AS stage(name, ordinal)
LEFT JOIN support_tickets t ON
  CASE stage.ordinal
    WHEN 2 THEN TRUE                              -- all tickets have been "created"
    WHEN 3 THEN t.diagnosed_at  IS NOT NULL
    WHEN 4 THEN t.fix_pr_url    IS NOT NULL
    WHEN 5 THEN t.pr_merged_at  IS NOT NULL
    WHEN 6 THEN t.verified_at   IS NOT NULL
  END
LEFT JOIN builds b ON t.build_id = b.id
GROUP BY stage.name, stage.ordinal
ORDER BY stage.ordinal;

-- ============================================================
-- Grant access (matches existing pattern)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
