-- Migration: Failure Streaks
-- Adds tables and views for multi-day failure analysis:
--   failure_streaks  - contiguous runs of failed builds per job
--   build_logs       - fetched GCS build logs with error extracts
--   streak_builds    - join table linking builds to streaks
--   v_failure_timeline - view powering the frontend failure timeline
-- Also adds columns to support_tickets and builds, and new activity_type enum values.

-- ============================================================
-- New activity_type enum values for streak events
-- Postgres 15 allows ADD VALUE inside transactions.
-- ============================================================

ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_detected';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_phase_change';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'signature_cleared';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_resolved';

-- ============================================================
-- failure_streaks
-- Represents a contiguous run of failed builds for a specific job.
-- Created and updated by the streak-analyzer CronJob.
-- ============================================================

CREATE TABLE failure_streaks (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name              TEXT        NOT NULL,
  source                TEXT        NOT NULL DEFAULT 'prow'
                                    CHECK (source IN ('jenkins', 'prow')),
  status                TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'partial_fix', 'resolved')),

  -- Streak bounds
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  streak_length         INT         NOT NULL DEFAULT 1,
  phase_count           INT         NOT NULL DEFAULT 1,

  -- Phases: each phase has a distinct error signature
  -- [{phase_number: 1, error_signature: "...", first_build_id: "...", last_build_id: "...",
  --   first_seen: "...", last_seen: "...", build_count: 1, ticket_id: "...",
  --   fix_pr_url: "...", fix_verified: false, summary: "..."}]
  phases                JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Upstream commits between last green and first red
  -- [{repo: "stolostron/rosa-hcp-e2e-test", commits: [{sha: "...", message: "...",
  --   author: "...", date: "..."}], compare_url: "https://github.com/.../compare/..."}]
  upstream_commits      JSONB       DEFAULT '[]'::jsonb,

  -- Claude-generated analysis summary (optional)
  analysis_summary      TEXT,
  analyzed_at           TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotent upsert key: one streak per (source, job_name, started_at)
  CONSTRAINT streaks_source_job_started_uq UNIQUE (source, job_name, started_at),
  CONSTRAINT streak_dates_valid CHECK (ended_at IS NULL OR ended_at > started_at)
);

COMMENT ON TABLE failure_streaks IS
  'Contiguous runs of failed builds for a specific job. Created by the streak-analyzer CronJob.';

CREATE INDEX idx_streaks_job_name   ON failure_streaks (job_name);
CREATE INDEX idx_streaks_status     ON failure_streaks (status) WHERE status = 'active';
CREATE INDEX idx_streaks_started_at ON failure_streaks (started_at DESC);
CREATE INDEX idx_streaks_source_job ON failure_streaks (source, job_name);

-- Reuse existing set_updated_at() trigger function
CREATE TRIGGER trg_streaks_updated_at
  BEFORE UPDATE ON failure_streaks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- build_logs
-- Stores fetched GCS build logs for failed Prow builds.
-- Full log_text retained 30 days; error_extract is permanent.
-- ============================================================

CREATE TABLE build_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id        UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,

  -- GCS source URL
  log_url         TEXT        NOT NULL,

  -- Full log (nullified after 30 days by retention cleanup)
  log_text        TEXT,
  log_size_bytes  INT,

  -- Permanent extract: the relevant error lines (FAILED tasks, fatal errors, PLAY RECAP)
  error_extract   TEXT,

  -- Structured error lines for display
  -- [{line_number: 1234, content: "fatal: ...", task_name: "Apply ROSA control plane",
  --   severity: "fatal"}]
  error_lines     JSONB       NOT NULL DEFAULT '[]'::jsonb,

  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT build_logs_build_uq UNIQUE (build_id)
);

COMMENT ON TABLE build_logs IS
  'Fetched GCS build logs for failed Prow builds. log_text nullified after 30 days.';

CREATE INDEX idx_build_logs_build_id ON build_logs (build_id);

-- ============================================================
-- streak_builds
-- Join table linking builds to their streak with position and phase number.
-- ============================================================

CREATE TABLE streak_builds (
  streak_id       UUID        NOT NULL REFERENCES failure_streaks (id) ON DELETE CASCADE,
  build_id        UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  position        INT         NOT NULL,      -- 1-based position in streak
  error_signature TEXT,                       -- cached from the build's triage
  phase_number    INT         NOT NULL DEFAULT 1,

  PRIMARY KEY (streak_id, build_id)
);

COMMENT ON TABLE streak_builds IS
  'Join table linking builds to failure streaks with position and phase tracking.';

CREATE INDEX idx_streak_builds_build ON streak_builds (build_id);

-- ============================================================
-- New columns on support_tickets
-- ============================================================

-- Link ticket to parent failure streak (multiple tickets can share a streak, one per phase)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS streak_id UUID REFERENCES failure_streaks (id) ON DELETE SET NULL;

-- First build where this ticket's error_signature was absent (even if build still failed)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS signature_cleared_in_build_id UUID REFERENCES builds (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_streak_id
  ON support_tickets (streak_id) WHERE streak_id IS NOT NULL;

-- ============================================================
-- New column on builds
-- ============================================================

-- Track whether GCS log has been fetched for this build
ALTER TABLE builds ADD COLUMN IF NOT EXISTS log_fetched BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- View: v_failure_timeline
-- Joins builds with streak/phase/ticket/log data for the frontend timeline.
-- ============================================================

CREATE OR REPLACE VIEW v_failure_timeline AS
SELECT
  b.id AS build_id,
  b.external_id,
  b.job_name,
  b.source,
  b.status::text AS build_status,
  b.started_at,
  b.finished_at,
  b.fail_count,
  b.total_count,
  b.ocp_version,

  -- Streak info
  sb.streak_id,
  sb.position AS streak_position,
  sb.phase_number,
  sb.error_signature,
  fs.status AS streak_status,
  fs.streak_length,
  fs.phase_count,
  fs.phases AS streak_phases,
  fs.analysis_summary,
  fs.upstream_commits,

  -- Error log extract (the lines developers need)
  bl.error_extract,
  bl.error_lines,

  -- Linked ticket
  t.id AS ticket_id,
  t.ticket_number,
  t.title AS ticket_title,
  t.status::text AS ticket_status,
  t.fix_pr_url,
  t.fix_pr_number,
  t.signature_cleared_in_build_id

FROM builds b
LEFT JOIN streak_builds sb ON b.id = sb.build_id
LEFT JOIN failure_streaks fs ON sb.streak_id = fs.id
LEFT JOIN build_logs bl ON b.id = bl.build_id
LEFT JOIN support_tickets t ON t.build_id = b.id
WHERE b.started_at > now() - INTERVAL '30 days'
ORDER BY b.job_name, b.started_at DESC;

-- ============================================================
-- RLS: failure_streaks
-- ============================================================

ALTER TABLE failure_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_failure_streaks_select"
  ON failure_streaks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_failure_streaks_insert"
  ON failure_streaks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_failure_streaks_update"
  ON failure_streaks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_failure_streaks_delete"
  ON failure_streaks FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- RLS: build_logs
-- ============================================================

ALTER TABLE build_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_build_logs_select"
  ON build_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_build_logs_insert"
  ON build_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_build_logs_update"
  ON build_logs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_build_logs_delete"
  ON build_logs FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- RLS: streak_builds
-- ============================================================

ALTER TABLE streak_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_streak_builds_select"
  ON streak_builds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_streak_builds_insert"
  ON streak_builds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_streak_builds_update"
  ON streak_builds FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_streak_builds_delete"
  ON streak_builds FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- Grants
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON failure_streaks TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON build_logs TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON streak_builds TO anon, authenticated, service_role;
