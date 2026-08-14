-- SQLite Schema for CAPA CI Tracker
-- Translated from Postgres migrations (supabase/migrations/)
-- All ENUM types become CHECK constraints, TIMESTAMPTZ -> TEXT (ISO 8601),
-- JSONB -> TEXT (JSON strings), TEXT[] -> TEXT (JSON arrays), BOOLEAN -> INTEGER (0/1).
-- UUIDs are TEXT, generated in the application layer.
-- Triggers (set_updated_at, record_status_change, pg_notify) are handled in the app layer.

-- ============================================================
-- builds
-- ============================================================

CREATE TABLE IF NOT EXISTS builds (
  id              TEXT        PRIMARY KEY,
  source          TEXT        NOT NULL CHECK (source IN ('jenkins', 'prow')),
  external_id     TEXT        NOT NULL,
  job_name        TEXT        NOT NULL,
  job_url         TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','success','failure','aborted','unstable')),
  pass_count      INTEGER     NOT NULL DEFAULT 0,
  fail_count      INTEGER     NOT NULL DEFAULT 0,
  skip_count      INTEGER     NOT NULL DEFAULT 0,
  total_count     INTEGER     NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  started_at      TEXT,
  finished_at     TEXT,
  ocp_version     TEXT,
  parameters      TEXT        DEFAULT '{}',
  test_failures   TEXT        DEFAULT '[]',
  raw_payload     TEXT,
  log_fetched     INTEGER     NOT NULL DEFAULT 0,
  created_at      TEXT        NOT NULL,
  updated_at      TEXT        NOT NULL,

  CONSTRAINT builds_source_extid_job_uq UNIQUE (source, external_id, job_name),
  CONSTRAINT builds_counts_nonneg CHECK (
    pass_count >= 0 AND fail_count >= 0 AND skip_count >= 0 AND total_count >= 0
  ),
  CONSTRAINT builds_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_builds_status       ON builds (status);
CREATE INDEX IF NOT EXISTS idx_builds_started_at   ON builds (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_builds_job_name     ON builds (job_name);
CREATE INDEX IF NOT EXISTS idx_builds_created_at   ON builds (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_builds_source_job   ON builds (source, job_name);
CREATE INDEX IF NOT EXISTS idx_builds_ocp_version  ON builds (ocp_version) WHERE ocp_version IS NOT NULL;

-- ============================================================
-- failure_streaks (before support_tickets due to FK reference)
-- ============================================================

CREATE TABLE IF NOT EXISTS failure_streaks (
  id                    TEXT        PRIMARY KEY,
  job_name              TEXT        NOT NULL,
  source                TEXT        NOT NULL DEFAULT 'prow'
                                    CHECK (source IN ('jenkins', 'prow')),
  status                TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'partial_fix', 'resolved')),
  started_at            TEXT        NOT NULL,
  ended_at              TEXT,
  streak_length         INTEGER     NOT NULL DEFAULT 1,
  phase_count           INTEGER     NOT NULL DEFAULT 1,
  phases                TEXT        NOT NULL DEFAULT '[]',
  upstream_commits      TEXT        DEFAULT '[]',
  analysis_summary      TEXT,
  analyzed_at           TEXT,
  created_at            TEXT        NOT NULL,
  updated_at            TEXT        NOT NULL,

  CONSTRAINT streaks_source_job_started_uq UNIQUE (source, job_name, started_at),
  CONSTRAINT streak_dates_valid CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_streaks_job_name   ON failure_streaks (job_name);
CREATE INDEX IF NOT EXISTS idx_streaks_status     ON failure_streaks (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_streaks_started_at ON failure_streaks (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_streaks_source_job ON failure_streaks (source, job_name);

-- ============================================================
-- support_tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id                      TEXT        PRIMARY KEY,
  ticket_number           INTEGER     UNIQUE,
  title                   TEXT        NOT NULL,
  description             TEXT,
  status                  TEXT        NOT NULL DEFAULT 'new'
                                      CHECK (status IN ('new','investigating','root_caused','fix_in_progress','resolved','verified')),
  severity                TEXT        NOT NULL DEFAULT 'test_regression'
                                      CHECK (severity IN ('nightly_blocker','test_regression','flaky','infrastructure','upstream_breakage')),
  assignee                TEXT,
  build_id                TEXT        REFERENCES builds (id) ON DELETE SET NULL,
  error_signature         TEXT,
  root_cause              TEXT,
  root_cause_category     TEXT,
  matched_pattern         TEXT,
  fix_pr_url              TEXT,
  fix_pr_number           INTEGER,
  upstream_issue_url      TEXT,
  jira_key                TEXT,
  labels                  TEXT        DEFAULT '[]',
  verified_in_build_id    TEXT        REFERENCES builds (id) ON DELETE SET NULL,
  streak_id               TEXT        REFERENCES failure_streaks (id) ON DELETE SET NULL,
  signature_cleared_in_build_id TEXT  REFERENCES builds (id) ON DELETE SET NULL,
  diagnosed_at            TEXT,
  pr_merged_at            TEXT,
  created_at              TEXT        NOT NULL,
  updated_at              TEXT        NOT NULL,
  resolved_at             TEXT,
  verified_at             TEXT,

  CONSTRAINT tickets_fix_pr_nonneg CHECK (fix_pr_number IS NULL OR fix_pr_number > 0)
);

-- Auto-assign ticket_number on INSERT when NULL
CREATE TRIGGER IF NOT EXISTS trg_ticket_number
  AFTER INSERT ON support_tickets
  FOR EACH ROW
  WHEN NEW.ticket_number IS NULL
BEGIN
  UPDATE support_tickets
  SET ticket_number = (SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM support_tickets)
  WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_tickets_status          ON support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_severity        ON support_tickets (severity);
CREATE INDEX IF NOT EXISTS idx_tickets_error_signature ON support_tickets (error_signature)
  WHERE error_signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_number   ON support_tickets (ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_build_id        ON support_tickets (build_id)
  WHERE build_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_created_at      ON support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_jira_key        ON support_tickets (jira_key)
  WHERE jira_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_matched_pattern ON support_tickets (matched_pattern)
  WHERE matched_pattern IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_diagnosed_at    ON support_tickets (diagnosed_at)
  WHERE diagnosed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_pr_merged_at    ON support_tickets (pr_merged_at)
  WHERE pr_merged_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_streak_id       ON support_tickets (streak_id)
  WHERE streak_id IS NOT NULL;

-- ============================================================
-- activities
-- ============================================================

CREATE TABLE IF NOT EXISTS activities (
  id              TEXT        PRIMARY KEY,
  activity_type   TEXT        NOT NULL
                              CHECK (activity_type IN (
                                'build_completed','ticket_created','ticket_updated','note_added',
                                'diagnosis_completed','fix_submitted','fix_merged','notification_sent',
                                'streak_detected','streak_phase_change','signature_cleared','streak_resolved'
                              )),
  title           TEXT        NOT NULL,
  description     TEXT,
  build_id        TEXT        REFERENCES builds (id) ON DELETE SET NULL,
  ticket_id       TEXT        REFERENCES support_tickets (id) ON DELETE CASCADE,
  actor           TEXT,
  metadata        TEXT        DEFAULT '{}',
  created_at      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_ticket_id  ON activities (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_build_id   ON activities (build_id)  WHERE build_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_type       ON activities (activity_type);

-- ============================================================
-- tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT        PRIMARY KEY,
  ticket_id     TEXT        NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','done','blocked')),
  assignee      TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TEXT        NOT NULL,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_ticket_id ON tasks (ticket_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks (status);

-- ============================================================
-- agent_runs
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT        PRIMARY KEY,
  agent_name      TEXT        NOT NULL,
  trigger_source  TEXT,
  input_payload   TEXT,
  output_payload  TEXT,
  success         INTEGER     NOT NULL DEFAULT 1,
  error_message   TEXT,
  duration_ms     INTEGER,
  created_at      TEXT        NOT NULL,

  CONSTRAINT agent_runs_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_name ON agent_runs (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_success    ON agent_runs (success) WHERE success = 0;

-- ============================================================
-- sop_mappings
-- ============================================================

CREATE TABLE IF NOT EXISTS sop_mappings (
  id              TEXT        PRIMARY KEY,
  pattern_type    TEXT        NOT NULL,
  sop_url         TEXT        NOT NULL,
  sop_title       TEXT        NOT NULL,
  sop_section     TEXT,
  summary         TEXT        NOT NULL,
  source_repo     TEXT,
  last_verified   TEXT,
  created_at      TEXT        NOT NULL,
  updated_at      TEXT        NOT NULL,
  CONSTRAINT sop_mappings_pattern_url_uq UNIQUE (pattern_type, sop_url)
);

CREATE INDEX IF NOT EXISTS idx_sop_mappings_pattern_type ON sop_mappings (pattern_type);

-- ============================================================
-- build_logs
-- ============================================================

CREATE TABLE IF NOT EXISTS build_logs (
  id              TEXT        PRIMARY KEY,
  build_id        TEXT        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  log_url         TEXT        NOT NULL,
  log_text        TEXT,
  log_size_bytes  INTEGER,
  error_extract   TEXT,
  error_lines     TEXT        NOT NULL DEFAULT '[]',
  fetched_at      TEXT        NOT NULL,

  CONSTRAINT build_logs_build_uq UNIQUE (build_id)
);

CREATE INDEX IF NOT EXISTS idx_build_logs_build_id ON build_logs (build_id);

-- ============================================================
-- streak_builds
-- ============================================================

CREATE TABLE IF NOT EXISTS streak_builds (
  streak_id       TEXT        NOT NULL REFERENCES failure_streaks (id) ON DELETE CASCADE,
  build_id        TEXT        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  position        INTEGER     NOT NULL,
  error_signature TEXT,
  phase_number    INTEGER     NOT NULL DEFAULT 1,

  PRIMARY KEY (streak_id, build_id)
);

CREATE INDEX IF NOT EXISTS idx_streak_builds_build ON streak_builds (build_id);

-- ============================================================
-- Views
-- ============================================================

-- v_ticket_summary
CREATE VIEW IF NOT EXISTS v_ticket_summary AS
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
  -- Task counts
  (SELECT count(*)  FROM tasks tk WHERE tk.ticket_id = t.id)                        AS task_count,
  (SELECT count(*)  FROM tasks tk WHERE tk.ticket_id = t.id AND tk.status = 'done') AS tasks_done,
  -- Activity count
  (SELECT count(*)  FROM activities a WHERE a.ticket_id = t.id)                      AS activity_count,
  -- Time-to-resolve (seconds, NULL if not yet resolved)
  CASE
    WHEN t.resolved_at IS NOT NULL
    THEN CAST((julianday(t.resolved_at) - julianday(t.created_at)) * 86400 AS INTEGER)
    ELSE NULL
  END AS ttf_seconds
FROM support_tickets t
LEFT JOIN builds b ON t.build_id = b.id;

-- v_build_failures
CREATE VIEW IF NOT EXISTS v_build_failures AS
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
  EXISTS (SELECT 1 FROM support_tickets st WHERE st.build_id = b.id) AS has_ticket
FROM builds b
WHERE b.status IN ('failure', 'unstable');

-- v_daily_build_stats
CREATE VIEW IF NOT EXISTS v_daily_build_stats AS
SELECT
  date(started_at)                                                          AS build_date,
  source,
  job_name,
  count(*)                                                                  AS total_builds,
  SUM(CASE WHEN status = 'success'  THEN 1 ELSE 0 END)                     AS success_count,
  SUM(CASE WHEN status = 'failure'  THEN 1 ELSE 0 END)                     AS failure_count,
  SUM(CASE WHEN status = 'unstable' THEN 1 ELSE 0 END)                     AS unstable_count,
  SUM(CASE WHEN status = 'aborted'  THEN 1 ELSE 0 END)                     AS aborted_count,
  ROUND(
    CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL)
    / NULLIF(count(*), 0) * 100, 1
  )                                                                         AS success_rate,
  AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE NULL END)     AS avg_duration_ms
FROM builds
WHERE started_at IS NOT NULL
GROUP BY date(started_at), source, job_name;

-- v_ticket_lifecycle
CREATE VIEW IF NOT EXISTS v_ticket_lifecycle AS
SELECT
  t.id,
  t.ticket_number,
  t.title,
  t.status,
  t.severity,
  t.assignee,

  -- Pipeline stage (ordinal 1-6)
  CASE
    WHEN t.verified_at     IS NOT NULL THEN 6
    WHEN t.pr_merged_at    IS NOT NULL THEN 5
    WHEN t.fix_pr_url      IS NOT NULL THEN 4
    WHEN t.diagnosed_at    IS NOT NULL THEN 3
    WHEN t.id              IS NOT NULL THEN 2
    ELSE 1
  END AS pipeline_stage,

  CASE
    WHEN t.verified_at     IS NOT NULL THEN 'fix_verified'
    WHEN t.pr_merged_at    IS NOT NULL THEN 'pr_merged'
    WHEN t.fix_pr_url      IS NOT NULL THEN 'pr_submitted'
    WHEN t.diagnosed_at    IS NOT NULL THEN 'root_cause_diagnosed'
    WHEN t.id              IS NOT NULL THEN 'ticket_created'
    ELSE 'build_failed'
  END AS pipeline_stage_name,

  -- Stage timestamps
  b.finished_at            AS build_failed_at,
  t.created_at             AS ticket_created_at,
  t.diagnosed_at           AS diagnosed_at,
  (SELECT MIN(a.created_at)
   FROM activities a
   WHERE a.ticket_id = t.id
     AND a.activity_type = 'fix_submitted'
  )                        AS pr_submitted_at,
  t.pr_merged_at           AS pr_merged_at,
  t.verified_at            AS verified_at,

  -- Build info
  t.build_id,
  b.job_name               AS build_job_name,
  b.job_url                AS build_job_url,
  b.source                 AS build_source,
  b.external_id            AS build_external_id,

  -- Fix PR info
  t.fix_pr_url,
  t.fix_pr_number,

  -- Verification build info
  t.verified_in_build_id,
  vb.job_name              AS verify_build_job_name,
  vb.job_url               AS verify_build_job_url,
  vb.external_id           AS verify_build_external_id,

  -- Duration metrics (seconds)
  CAST((julianday(t.created_at)   - julianday(b.finished_at)) * 86400 AS INTEGER) AS build_to_ticket_seconds,
  CAST((julianday(t.diagnosed_at) - julianday(t.created_at))  * 86400 AS INTEGER) AS ticket_to_diagnosis_seconds,
  CAST((julianday(t.pr_merged_at) - julianday(t.diagnosed_at))* 86400 AS INTEGER) AS diagnosis_to_merge_seconds,
  CAST((julianday(t.verified_at)  - julianday(t.pr_merged_at))* 86400 AS INTEGER) AS merge_to_verify_seconds,
  CAST((julianday(t.verified_at)  - julianday(b.finished_at)) * 86400 AS INTEGER) AS total_lifecycle_seconds,
  CASE
    WHEN t.resolved_at IS NOT NULL
    THEN CAST((julianday(t.resolved_at) - julianday(t.created_at)) * 86400 AS INTEGER)
    ELSE NULL
  END AS ttf_seconds

FROM support_tickets t
LEFT JOIN builds b  ON t.build_id = b.id
LEFT JOIN builds vb ON t.verified_in_build_id = vb.id;

-- v_pipeline_funnel
-- Note: percentile_cont has no SQLite equivalent. median_stage_duration_seconds returns NULL.
CREATE VIEW IF NOT EXISTS v_pipeline_funnel AS
SELECT
  stage_name,
  stage_ordinal,
  count(t.id)                                                                       AS ticket_count,
  SUM(CASE WHEN t.severity = 'nightly_blocker'   THEN 1 ELSE 0 END)                AS nightly_blocker_count,
  SUM(CASE WHEN t.severity = 'upstream_breakage'  THEN 1 ELSE 0 END)               AS upstream_breakage_count,
  SUM(CASE WHEN t.severity = 'infrastructure'     THEN 1 ELSE 0 END)               AS infrastructure_count,
  SUM(CASE WHEN t.severity = 'test_regression'    THEN 1 ELSE 0 END)               AS test_regression_count,
  SUM(CASE WHEN t.severity = 'flaky'              THEN 1 ELSE 0 END)               AS flaky_count,
  NULL AS median_stage_duration_seconds
FROM (
  SELECT 'ticket_created'       AS stage_name, 2 AS stage_ordinal
  UNION ALL SELECT 'root_cause_diagnosed', 3
  UNION ALL SELECT 'pr_submitted',         4
  UNION ALL SELECT 'pr_merged',            5
  UNION ALL SELECT 'fix_verified',         6
) AS stage
LEFT JOIN support_tickets t ON
  CASE stage.stage_ordinal
    WHEN 2 THEN 1
    WHEN 3 THEN CASE WHEN t.diagnosed_at  IS NOT NULL THEN 1 ELSE 0 END
    WHEN 4 THEN CASE WHEN t.fix_pr_url    IS NOT NULL THEN 1 ELSE 0 END
    WHEN 5 THEN CASE WHEN t.pr_merged_at  IS NOT NULL THEN 1 ELSE 0 END
    WHEN 6 THEN CASE WHEN t.verified_at   IS NOT NULL THEN 1 ELSE 0 END
    ELSE 0
  END = 1
LEFT JOIN builds b ON t.build_id = b.id
GROUP BY stage.stage_name, stage.stage_ordinal
ORDER BY stage.stage_ordinal;

-- v_failure_timeline
CREATE VIEW IF NOT EXISTS v_failure_timeline AS
SELECT
  b.id AS build_id,
  b.external_id,
  b.job_name,
  b.source,
  b.status AS build_status,
  b.started_at,
  b.finished_at,
  b.fail_count,
  b.total_count,
  b.ocp_version,

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

  bl.error_extract,
  bl.error_lines,

  t.id AS ticket_id,
  t.ticket_number,
  t.title AS ticket_title,
  t.status AS ticket_status,
  t.fix_pr_url,
  t.fix_pr_number,
  t.signature_cleared_in_build_id

FROM builds b
LEFT JOIN streak_builds sb ON b.id = sb.build_id
LEFT JOIN failure_streaks fs ON sb.streak_id = fs.id
LEFT JOIN build_logs bl ON b.id = bl.build_id
LEFT JOIN support_tickets t ON t.build_id = b.id
WHERE b.started_at > datetime('now', '-30 days')
ORDER BY b.job_name, b.started_at DESC;
