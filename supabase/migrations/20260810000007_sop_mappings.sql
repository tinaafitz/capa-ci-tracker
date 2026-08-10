-- Migration: SOP Mappings
-- Creates sop_mappings table, adds matched_pattern to support_tickets,
-- enables RLS, and updates v_ticket_summary to include matched_pattern.

-- ============================================================
-- New table: sop_mappings
-- Maps known-issue pattern types to SOP references.
-- ============================================================

CREATE TABLE IF NOT EXISTS sop_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type    TEXT NOT NULL,
  sop_url         TEXT NOT NULL,
  sop_title       TEXT NOT NULL,
  sop_section     TEXT,
  summary         TEXT NOT NULL,
  source_repo     TEXT,
  last_verified   TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sop_mappings_pattern_url_uq UNIQUE (pattern_type, sop_url)
);

COMMENT ON TABLE sop_mappings IS 'Maps diagnosis pattern types to Standard Operating Procedure references.';

CREATE INDEX IF NOT EXISTS idx_sop_mappings_pattern_type ON sop_mappings (pattern_type);

-- Apply set_updated_at trigger (reuse existing function from triggers migration)
CREATE TRIGGER trg_sop_mappings_updated_at
  BEFORE UPDATE ON sop_mappings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Add matched_pattern column to support_tickets
-- ============================================================

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS matched_pattern TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_matched_pattern ON support_tickets (matched_pattern)
  WHERE matched_pattern IS NOT NULL;

-- ============================================================
-- RLS: sop_mappings
-- ============================================================

ALTER TABLE sop_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_sop_mappings_select"
  ON sop_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_sop_mappings_insert"
  ON sop_mappings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_sop_mappings_update"
  ON sop_mappings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_sop_mappings_delete"
  ON sop_mappings FOR DELETE
  TO authenticated
  USING (true);

-- Grants: match the pattern from existing RLS migration
GRANT SELECT, INSERT, UPDATE, DELETE ON sop_mappings TO anon, authenticated, service_role;

-- ============================================================
-- Update v_ticket_summary to include matched_pattern
-- DROP required because adding a column in the middle changes
-- ordinal positions, which CREATE OR REPLACE cannot do.
-- ============================================================

DROP VIEW IF EXISTS v_ticket_summary;
CREATE VIEW v_ticket_summary AS
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
  t.matched_pattern,
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
