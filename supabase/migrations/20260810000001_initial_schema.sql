-- Migration: Initial Schema
-- Creates ENUMs, tables, indexes, and constraints for the CAPA CI Tracker.

-- ============================================================
-- ENUMs
-- ============================================================

CREATE TYPE build_status    AS ENUM ('pending','running','success','failure','aborted','unstable');
CREATE TYPE ticket_status   AS ENUM ('new','investigating','root_caused','fix_in_progress','resolved','verified');
CREATE TYPE ticket_severity AS ENUM ('nightly_blocker','test_regression','flaky','infrastructure','upstream_breakage');
CREATE TYPE activity_type   AS ENUM ('build_completed','ticket_created','ticket_updated','note_added',
                                     'diagnosis_completed','fix_submitted','fix_merged','notification_sent');
CREATE TYPE task_status     AS ENUM ('open','in_progress','done','blocked');

-- ============================================================
-- builds
-- ============================================================

CREATE TABLE builds (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT        NOT NULL CHECK (source IN ('jenkins', 'prow')),
  external_id     TEXT        NOT NULL,
  job_name        TEXT        NOT NULL,
  job_url         TEXT,
  status          build_status NOT NULL DEFAULT 'pending',
  pass_count      INT         NOT NULL DEFAULT 0,
  fail_count      INT         NOT NULL DEFAULT 0,
  skip_count      INT         NOT NULL DEFAULT 0,
  total_count     INT         NOT NULL DEFAULT 0,
  duration_ms     BIGINT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  ocp_version     TEXT,
  parameters      JSONB       DEFAULT '{}'::jsonb,
  test_failures   JSONB       DEFAULT '[]'::jsonb,
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT builds_source_extid_job_uq UNIQUE (source, external_id, job_name),
  CONSTRAINT builds_counts_nonneg CHECK (
    pass_count >= 0 AND fail_count >= 0 AND skip_count >= 0 AND total_count >= 0
  ),
  CONSTRAINT builds_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

COMMENT ON TABLE  builds IS 'CI build results from Jenkins and Prow, ingested by sub-agents.';
COMMENT ON COLUMN builds.test_failures IS
  'Array of {name, className, errorMessage, errorStackTrace} objects extracted during ingestion.';
COMMENT ON COLUMN builds.raw_payload IS
  'Full API response stored for debugging; subject to 90-day retention policy.';

CREATE INDEX idx_builds_status       ON builds (status);
CREATE INDEX idx_builds_started_at   ON builds (started_at DESC);
CREATE INDEX idx_builds_job_name     ON builds (job_name);
CREATE INDEX idx_builds_created_at   ON builds (created_at DESC);
CREATE INDEX idx_builds_source_job   ON builds (source, job_name);
CREATE INDEX idx_builds_ocp_version  ON builds (ocp_version) WHERE ocp_version IS NOT NULL;

-- ============================================================
-- support_tickets
-- ============================================================

CREATE TABLE support_tickets (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number       INT             GENERATED ALWAYS AS IDENTITY,
  title               TEXT            NOT NULL,
  description         TEXT,
  status              ticket_status   NOT NULL DEFAULT 'new',
  severity            ticket_severity NOT NULL DEFAULT 'test_regression',
  assignee            TEXT,
  build_id            UUID            REFERENCES builds (id) ON DELETE SET NULL,
  error_signature     TEXT,
  root_cause          TEXT,
  root_cause_category TEXT,
  fix_pr_url          TEXT,
  fix_pr_number       INT,
  upstream_issue_url  TEXT,
  jira_key            TEXT,
  labels              TEXT[]          DEFAULT '{}',
  verified_in_build_id UUID           REFERENCES builds (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,

  CONSTRAINT tickets_ticket_number_uq UNIQUE (ticket_number),
  CONSTRAINT tickets_fix_pr_nonneg CHECK (fix_pr_number IS NULL OR fix_pr_number > 0)
);

COMMENT ON TABLE support_tickets IS 'Failure-tracking tickets auto-created by the triage agent or manually.';

CREATE INDEX idx_tickets_status          ON support_tickets (status);
CREATE INDEX idx_tickets_severity        ON support_tickets (severity);
CREATE INDEX idx_tickets_error_signature ON support_tickets (error_signature)
  WHERE error_signature IS NOT NULL;
CREATE INDEX idx_tickets_ticket_number   ON support_tickets (ticket_number);
CREATE INDEX idx_tickets_build_id        ON support_tickets (build_id)
  WHERE build_id IS NOT NULL;
CREATE INDEX idx_tickets_created_at      ON support_tickets (created_at DESC);
CREATE INDEX idx_tickets_jira_key        ON support_tickets (jira_key)
  WHERE jira_key IS NOT NULL;

-- ============================================================
-- activities
-- ============================================================

CREATE TABLE activities (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type   activity_type NOT NULL,
  title           TEXT          NOT NULL,
  description     TEXT,
  build_id        UUID          REFERENCES builds (id) ON DELETE SET NULL,
  ticket_id       UUID          REFERENCES support_tickets (id) ON DELETE CASCADE,
  actor           TEXT,
  metadata        JSONB         DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE activities IS 'Append-only timeline of all system and user events.';

CREATE INDEX idx_activities_created_at ON activities (created_at DESC);
CREATE INDEX idx_activities_ticket_id  ON activities (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_activities_build_id   ON activities (build_id)  WHERE build_id IS NOT NULL;
CREATE INDEX idx_activities_type       ON activities (activity_type);

-- ============================================================
-- tasks
-- ============================================================

CREATE TABLE tasks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID        NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  status        task_status NOT NULL DEFAULT 'open',
  assignee      TEXT,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

COMMENT ON TABLE tasks IS 'Checklist items per support ticket.';

CREATE INDEX idx_tasks_ticket_id ON tasks (ticket_id);
CREATE INDEX idx_tasks_status    ON tasks (status);

-- ============================================================
-- agent_runs
-- ============================================================

CREATE TABLE agent_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT        NOT NULL,
  trigger         TEXT,
  input_payload   JSONB,
  output_payload  JSONB,
  success         BOOLEAN     NOT NULL DEFAULT true,
  error_message   TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

COMMENT ON TABLE agent_runs IS 'Sub-agent execution log for observability.';

CREATE INDEX idx_agent_runs_agent_name ON agent_runs (agent_name);
CREATE INDEX idx_agent_runs_created_at ON agent_runs (created_at DESC);
CREATE INDEX idx_agent_runs_success    ON agent_runs (success) WHERE NOT success;

-- ============================================================
-- Auth domain restriction hook
-- Prevents sign-ups from non-redhat.com domains
-- Requires supabase_admin role to modify the auth schema
-- ============================================================

DO $$
BEGIN
  -- Only create if we have access to the auth schema (production Supabase)
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'auth'
    AND has_schema_privilege(current_user, 'auth', 'CREATE')
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION auth.check_redhat_domain()
      RETURNS TRIGGER AS $trigger$
      BEGIN
        IF NEW.email IS NULL OR NOT NEW.email LIKE '%@redhat.com' THEN
          RAISE EXCEPTION 'Only @redhat.com email addresses are allowed'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $trigger$ LANGUAGE plpgsql SECURITY DEFINER;
    $fn$;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auth_check_domain'
    ) THEN
      EXECUTE $trg$
        CREATE TRIGGER trg_auth_check_domain
          BEFORE INSERT ON auth.users
          FOR EACH ROW
          EXECUTE FUNCTION auth.check_redhat_domain();
      $trg$;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- Grant table access to Supabase roles
-- Required for PostgREST to serve data via the REST API
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
