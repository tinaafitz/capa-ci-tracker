# CAPA CI Tracker -- Backend Design Document

> **Status:** Approved  
> **Database:** Supabase (Postgres 15+)  
> **Auth:** Supabase Auth with Google OAuth (@redhat.com)  
> **Edge Runtime:** Supabase Edge Functions (Deno)  
> **Scheduling:** pg_cron  

---

## 1. Schema Design

### 1.1 ENUMs

```sql
CREATE TYPE build_status    AS ENUM ('pending','running','success','failure','aborted','unstable');
CREATE TYPE ticket_status   AS ENUM ('new','investigating','root_caused','fix_in_progress','resolved','verified');
CREATE TYPE ticket_severity AS ENUM ('nightly_blocker','test_regression','flaky','infrastructure','upstream_breakage');
CREATE TYPE activity_type   AS ENUM ('build_completed','ticket_created','ticket_updated','note_added',
                                     'diagnosis_completed','fix_submitted','fix_merged','notification_sent');
CREATE TYPE task_status     AS ENUM ('open','in_progress','done','blocked');
```

### 1.2 Tables

#### builds

Stores CI build results ingested from Jenkins and Prow. Each row represents one build
execution. `test_failures` carries structured failure data so the triage agent can match
error signatures without parsing raw_payload.

```sql
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
```

#### support_tickets

Failure-tracking tickets. Each ticket links to the build that triggered it and
optionally to the build where the fix was verified.

```sql
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
```

#### activities

Immutable timeline log. Every meaningful event (build completed, ticket status change,
note added, etc.) is recorded here for the Activity tab.

```sql
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
```

#### tasks

Checklist items attached to a ticket. Cascade-deleted when the parent ticket is removed.

```sql
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
```

#### agent_runs

Execution log for every sub-agent invocation. Used for observability and debugging.

```sql
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
```

### 1.3 Trigger Functions

#### set_updated_at()

Automatically sets `updated_at = now()` on every UPDATE for builds and support_tickets.

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_builds_updated_at
  BEFORE UPDATE ON builds
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

#### record_status_change()

When a ticket's status changes, this trigger:
1. Inserts a `ticket_updated` activity with the old and new status in metadata.
2. Sets `resolved_at` when status moves to `'resolved'`.
3. Sets `verified_at` when status moves to `'verified'`.
4. Clears `resolved_at`/`verified_at` if status regresses back from those states.

```sql
CREATE OR REPLACE FUNCTION record_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Record the status transition as an activity
    INSERT INTO activities (activity_type, title, description, ticket_id, actor, metadata)
    VALUES (
      'ticket_updated',
      format('Ticket #%s status changed to %s', NEW.ticket_number, NEW.status),
      format('Status changed from %s to %s', OLD.status, NEW.status),
      NEW.id,
      NEW.assignee,                       -- best-effort actor attribution
      jsonb_build_object(
        'old_status', OLD.status::text,
        'new_status', NEW.status::text
      )
    );

    -- Set resolved_at when entering 'resolved'
    IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
      NEW.resolved_at = now();
    END IF;

    -- Clear resolved_at if regressing from resolved/verified
    IF NEW.status NOT IN ('resolved', 'verified')
       AND OLD.status IN ('resolved', 'verified') THEN
      NEW.resolved_at = NULL;
    END IF;

    -- Set verified_at when entering 'verified'
    IF NEW.status = 'verified' AND OLD.status <> 'verified' THEN
      NEW.verified_at = now();
    END IF;

    -- Clear verified_at if regressing from verified
    IF NEW.status <> 'verified' AND OLD.status = 'verified' THEN
      NEW.verified_at = NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_status_change
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION record_status_change();
```

#### notify_new_build_failure()

Fires after a build with `status = 'failure'` is inserted. Uses `pg_notify` to signal
the triage Edge Function via Supabase's Realtime/Postgres changes or a direct webhook.

```sql
CREATE OR REPLACE FUNCTION notify_new_build_failure()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'failure' THEN
    PERFORM pg_notify(
      'build_failure',
      json_build_object(
        'build_id', NEW.id,
        'job_name', NEW.job_name,
        'source',   NEW.source
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_build_failure_notify
  AFTER INSERT ON builds
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_build_failure();
```

#### notify_new_activity()

Fires after an activity is inserted. Signals the notify Edge Function via `pg_notify`.

```sql
CREATE OR REPLACE FUNCTION notify_new_activity()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'new_activity',
    json_build_object(
      'activity_id',   NEW.id,
      'activity_type', NEW.activity_type,
      'ticket_id',     NEW.ticket_id,
      'build_id',      NEW.build_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_activity_notify
  AFTER INSERT ON activities
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_activity();
```

### 1.4 Views

#### v_ticket_summary

Flattened view that joins tickets with their originating build data. Used by the
Tickets list and Ticket detail views.

```sql
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
```

#### v_build_failures

View filtering to only failed builds with their test_failures expanded. Used by the
Transactions tab's failure trend chart and by the triage agent.

```sql
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
```

#### v_daily_build_stats

Aggregated daily build statistics for the trend chart on the Transactions tab.

```sql
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
```

### 1.5 pg_cron Setup

pg_cron schedules sub-agent invocations by calling Supabase Edge Functions via
`net.http_post` (the `pg_net` extension).

```sql
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
```

---

## 2. Access Patterns & Operations

### 2.1 Frontend Views

#### Activity Tab

**Purpose:** Chronological feed of all system events.

**Primary query:**
```sql
-- Paginated activity feed (cursor-based on created_at)
SELECT
  a.id,
  a.activity_type,
  a.title,
  a.description,
  a.actor,
  a.metadata,
  a.created_at,
  a.build_id,
  a.ticket_id,
  t.ticket_number,
  t.title AS ticket_title
FROM activities a
LEFT JOIN support_tickets t ON a.ticket_id = t.id
WHERE a.created_at < :cursor_timestamp     -- cursor-based pagination
ORDER BY a.created_at DESC
LIMIT 50;
```

**Supabase client call:**
```ts
supabase
  .from('activities')
  .select(`
    *,
    support_tickets!activities_ticket_id_fkey (ticket_number, title)
  `)
  .order('created_at', { ascending: false })
  .lt('created_at', cursorTimestamp)
  .limit(50);
```

**Realtime subscription:**
```ts
supabase
  .channel('activities-feed')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'activities',
  }, (payload) => {
    // Prepend new activity to the feed
  })
  .subscribe();
```

#### Tickets List

**Purpose:** Filterable, paginated list of support tickets with summary info.

**Primary query (via the view):**
```sql
SELECT *
FROM v_ticket_summary
WHERE 1=1
  AND (:status_filter IS NULL     OR status   = :status_filter)
  AND (:severity_filter IS NULL   OR severity = :severity_filter)
  AND (:assignee_filter IS NULL   OR assignee = :assignee_filter)
  AND (:search_text IS NULL       OR title ILIKE '%' || :search_text || '%'
                                  OR error_signature ILIKE '%' || :search_text || '%')
ORDER BY
  CASE severity
    WHEN 'nightly_blocker'    THEN 1
    WHEN 'upstream_breakage'  THEN 2
    WHEN 'test_regression'    THEN 3
    WHEN 'infrastructure'     THEN 4
    WHEN 'flaky'              THEN 5
  END,
  created_at DESC
LIMIT :page_size OFFSET :offset;
```

**Supabase client call:**
```ts
let query = supabase
  .from('v_ticket_summary')
  .select('*', { count: 'exact' });

if (statusFilter)   query = query.eq('status', statusFilter);
if (severityFilter)  query = query.eq('severity', severityFilter);
if (assigneeFilter)  query = query.eq('assignee', assigneeFilter);
if (searchText)      query = query.or(`title.ilike.%${searchText}%,error_signature.ilike.%${searchText}%`);

query = query
  .order('severity', { ascending: true })     // relies on enum ordering
  .order('created_at', { ascending: false })
  .range(offset, offset + pageSize - 1);
```

**Realtime subscription (ticket list refresh):**
```ts
supabase
  .channel('tickets-list')
  .on('postgres_changes', {
    event: '*',                    // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'support_tickets',
  }, () => {
    // Invalidate and refetch the ticket list
  })
  .subscribe();
```

#### Ticket Detail

**Purpose:** Full ticket view with activities timeline, tasks checklist, and linked build.

**Queries (executed in parallel):**

```ts
// 1. Ticket with build join
const { data: ticket } = await supabase
  .from('support_tickets')
  .select(`
    *,
    builds!support_tickets_build_id_fkey (*),
    verified_build:builds!support_tickets_verified_in_build_id_fkey (id, job_name, status, job_url, started_at)
  `)
  .eq('id', ticketId)
  .single();

// 2. Tasks for the ticket (ordered by sort_order)
const { data: tasks } = await supabase
  .from('tasks')
  .select('*')
  .eq('ticket_id', ticketId)
  .order('sort_order', { ascending: true });

// 3. Activities for the ticket
const { data: activities } = await supabase
  .from('activities')
  .select('*')
  .eq('ticket_id', ticketId)
  .order('created_at', { ascending: false });
```

**Realtime subscriptions (scoped to this ticket):**
```ts
supabase
  .channel(`ticket-${ticketId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'support_tickets',
    filter: `id=eq.${ticketId}`,
  }, handleTicketUpdate)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'tasks',
    filter: `ticket_id=eq.${ticketId}`,
  }, handleTaskChange)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'activities',
    filter: `ticket_id=eq.${ticketId}`,
  }, handleNewActivity)
  .subscribe();
```

#### Transactions Tab (Builds)

**Purpose:** Build history with pass/fail trend chart and build list.

**Build list query:**
```ts
const { data: builds } = await supabase
  .from('builds')
  .select('id, source, external_id, job_name, job_url, status, pass_count, fail_count, total_count, duration_ms, started_at, ocp_version')
  .order('started_at', { ascending: false })
  .range(offset, offset + pageSize - 1);
```

**Trend chart query (aggregated daily stats):**
```ts
const { data: stats } = await supabase
  .from('v_daily_build_stats')
  .select('*')
  .gte('build_date', thirtyDaysAgo)
  .order('build_date', { ascending: true });
```

**Realtime subscription:**
```ts
supabase
  .channel('builds-feed')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'builds',
  }, handleNewBuild)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'builds',
  }, handleBuildUpdate)
  .subscribe();
```

### 2.2 Sub-Agent Operations

#### ingest-jenkins

| Operation | Detail |
|-----------|--------|
| **Trigger** | pg_cron every 5 min |
| **Reads** | External: Jenkins REST API (`/api/json?tree=...`) for recent builds |
| **Reads (DB)** | `SELECT external_id FROM builds WHERE source='jenkins' AND job_name = :job ORDER BY started_at DESC LIMIT 1` (find watermark) |
| **Writes** | `INSERT INTO builds (...) VALUES (...) ON CONFLICT (source, external_id, job_name) DO UPDATE SET status=EXCLUDED.status, ...` (upsert) |
| **Writes** | `INSERT INTO activities (activity_type, title, build_id, ...) VALUES ('build_completed', ...)` for each newly finished build |
| **Writes** | `INSERT INTO agent_runs (agent_name, trigger, input_payload, output_payload, success, duration_ms)` |

```sql
-- Core upsert pattern used by ingestion agents
INSERT INTO builds (source, external_id, job_name, job_url, status,
                    pass_count, fail_count, skip_count, total_count,
                    duration_ms, started_at, finished_at, ocp_version,
                    parameters, test_failures, raw_payload)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (source, external_id, job_name) DO UPDATE SET
  status        = EXCLUDED.status,
  pass_count    = EXCLUDED.pass_count,
  fail_count    = EXCLUDED.fail_count,
  skip_count    = EXCLUDED.skip_count,
  total_count   = EXCLUDED.total_count,
  duration_ms   = EXCLUDED.duration_ms,
  finished_at   = EXCLUDED.finished_at,
  test_failures = EXCLUDED.test_failures,
  raw_payload   = EXCLUDED.raw_payload
WHERE builds.status IN ('pending', 'running')   -- only update if not terminal
   OR builds.status IS DISTINCT FROM EXCLUDED.status;
```

#### ingest-prow

Identical pattern to ingest-jenkins but reads from the Prow API. Same upsert logic.
Staggered by 2 minutes to avoid overlapping resource usage.

#### triage

| Operation | Detail |
|-----------|--------|
| **Trigger** | `pg_notify('build_failure', ...)` via database trigger on builds INSERT |
| **Reads** | `SELECT * FROM builds WHERE id = :build_id` |
| **Reads** | Dedup check (see Section 2.3 below) |
| **Writes** | `INSERT INTO support_tickets (...)` with error_signature derived from test_failures |
| **Writes** | `INSERT INTO activities (...) VALUES ('ticket_created', ...)` |
| **Writes** | `INSERT INTO agent_runs (...)` |

**Error signature derivation:**
The triage agent computes `error_signature` by normalizing the first test failure:
```ts
function computeSignature(testFailures: TestFailure[]): string {
  if (!testFailures.length) return 'unknown';
  const f = testFailures[0];
  // Normalize: strip line numbers, timestamps, UUIDs, hex addresses
  const normalized = f.errorMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/0x[0-9a-fA-F]+/g, '<ADDR>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TS>')
    .replace(/:\d+/g, ':<N>')
    .trim();
  return `${f.className}::${f.name}::${sha256(normalized).substring(0, 16)}`;
}
```

#### diagnosis

| Operation | Detail |
|-----------|--------|
| **Trigger** | Called by triage agent after ticket creation |
| **Reads** | `SELECT * FROM builds WHERE id = :build_id` (test_failures, parameters) |
| **Reads** | `known_issues.json` (12 regex patterns bundled with the Edge Function) |
| **Writes** | `UPDATE support_tickets SET root_cause = :cause, root_cause_category = :cat, severity = :sev WHERE id = :ticket_id` |
| **Writes** | `INSERT INTO activities (...) VALUES ('diagnosis_completed', ...)` |
| **Writes** | `INSERT INTO agent_runs (...)` |

Pattern-matching logic:
```ts
for (const failure of build.test_failures) {
  for (const issue of knownIssues) {
    if (new RegExp(issue.pattern).test(failure.errorMessage)) {
      return {
        root_cause: issue.description,
        root_cause_category: issue.category,
        severity: issue.default_severity,
      };
    }
  }
}
```

#### resolution-tracker

| Operation | Detail |
|-----------|--------|
| **Trigger** | pg_cron every 15 min |
| **Reads** | `SELECT id, fix_pr_url, fix_pr_number, status FROM support_tickets WHERE status IN ('fix_in_progress') AND fix_pr_url IS NOT NULL` |
| **Reads** | GitHub API: `GET /repos/:owner/:repo/pulls/:number` for merge status |
| **Writes** | `UPDATE support_tickets SET status = 'resolved' WHERE id = :id` (triggers record_status_change) |
| **Writes** | `INSERT INTO activities (...) VALUES ('fix_merged', ...)` |
| **Writes** | `INSERT INTO agent_runs (...)` |

#### notify

| Operation | Detail |
|-----------|--------|
| **Trigger** | `pg_notify('new_activity', ...)` via database trigger on activities INSERT |
| **Reads** | `SELECT * FROM activities WHERE id = :activity_id` |
| **Reads** | Joins to support_tickets/builds as needed for Slack message context |
| **Writes** | External: Slack `chat.postMessage` with Block Kit payload |
| **Writes** | `INSERT INTO activities (...) VALUES ('notification_sent', ..., metadata: {channel, ts})` |
| **Writes** | `INSERT INTO agent_runs (...)` |

### 2.3 Triage Dedup Strategy

The triage agent must avoid creating duplicate tickets for the same recurring failure.
The dedup strategy uses `error_signature` matching with an advisory lock to prevent
race conditions when multiple failures arrive simultaneously.

**Dedup query:**
```sql
-- Check for existing open/active ticket with the same error signature
SELECT id, ticket_number, status
FROM support_tickets
WHERE error_signature = :computed_signature
  AND status NOT IN ('resolved', 'verified')
ORDER BY created_at DESC
LIMIT 1;
```

**Full triage flow with advisory lock:**
```sql
-- 1. Acquire advisory lock based on error_signature hash
SELECT pg_advisory_xact_lock(hashtext(:error_signature));

-- 2. Check for existing ticket
SELECT id FROM support_tickets
WHERE error_signature = :error_signature
  AND status NOT IN ('resolved', 'verified')
LIMIT 1;

-- 3a. If found: link the build to the existing ticket via an activity
INSERT INTO activities (activity_type, title, ticket_id, build_id, metadata)
VALUES ('build_completed', 'Recurring failure detected', :existing_ticket_id, :build_id,
        '{"dedup": true}'::jsonb);

-- 3b. If not found: create a new ticket
INSERT INTO support_tickets (title, description, status, severity, build_id, error_signature)
VALUES (:title, :description, 'new', 'test_regression', :build_id, :error_signature)
RETURNING id;
```

The advisory lock uses `pg_advisory_xact_lock(hashtext(error_signature))`, which is
automatically released at transaction end. This prevents two concurrent triage runs
from both seeing "no existing ticket" and creating duplicates.

---

## 3. Auth, RLS & Roles

### 3.1 Google OAuth Configuration

Supabase Auth is configured with Google OAuth restricted to the @redhat.com domain:

```json
// supabase/config.toml (relevant auth section)
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_CLIENT_SECRET)"
```

**Domain restriction** is enforced at the application level via a Supabase Auth hook
or in the sign-up flow, since Supabase does not natively restrict OAuth to a specific
email domain. Implementation:

```sql
-- Database hook: prevent sign-ups from non-redhat.com domains
CREATE OR REPLACE FUNCTION auth.check_redhat_domain()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL OR NOT NEW.email LIKE '%@redhat.com' THEN
    RAISE EXCEPTION 'Only @redhat.com email addresses are allowed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auth_check_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.check_redhat_domain();
```

Alternatively, enforce in the Edge Function middleware or via the Google OAuth
consent screen's "internal" organization setting (if the Google Workspace is
configured for redhat.com).

### 3.2 Role Model

| Role | Description | Used by |
|------|-------------|---------|
| `anon` | Unauthenticated requests | Blocked entirely |
| `authenticated` | Logged-in users via Google OAuth | Frontend (all 4-6 engineers) |
| `service_role` | Bypasses RLS | Edge Functions (sub-agents) |

### 3.3 RLS Policies

RLS is enabled on all tables. The `service_role` bypasses RLS by default in Supabase,
so sub-agents using the service_role key have unrestricted access.

```sql
-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE builds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ANON: no access to any table
-- ============================================================
-- (No policies created for anon = implicit deny when RLS is on)

-- ============================================================
-- AUTHENTICATED: full read/write on all operational tables
-- Small team (4-6), all engineers, no row-level segregation needed.
-- ============================================================

-- builds: authenticated can read all, write all
CREATE POLICY "authenticated_builds_select"
  ON builds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_builds_insert"
  ON builds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_builds_update"
  ON builds FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Note: no DELETE policy on builds. Builds are immutable once ingested.
-- Deletion is only via retention cleanup (service_role).

-- support_tickets: authenticated can CRUD
CREATE POLICY "authenticated_tickets_select"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_tickets_insert"
  ON support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_tickets_update"
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_tickets_delete"
  ON support_tickets FOR DELETE
  TO authenticated
  USING (true);

-- activities: authenticated can read all, insert (for notes), no update/delete
CREATE POLICY "authenticated_activities_select"
  ON activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_activities_insert"
  ON activities FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Note: no UPDATE or DELETE on activities. They are an immutable audit log.

-- tasks: authenticated can CRUD
CREATE POLICY "authenticated_tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_tasks_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_tasks_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_tasks_delete"
  ON tasks FOR DELETE
  TO authenticated
  USING (true);

-- agent_runs: authenticated can read (observability), no write
-- (Only service_role writes to agent_runs from Edge Functions)
CREATE POLICY "authenticated_agent_runs_select"
  ON agent_runs FOR SELECT
  TO authenticated
  USING (true);
```

### 3.4 Service Role Access

Edge Functions use the `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS entirely.
This is the correct approach for backend sub-agents that need unrestricted access.

```ts
// Edge Function initialization pattern
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,  // Bypasses RLS
);
```

### 3.5 RLS Design Rationale

The permissive "all authenticated users can do everything" model is deliberate:

1. **Small team (4-6 engineers):** Row-level segregation adds complexity without value.
2. **Trust boundary is at authentication:** Once you're in with a @redhat.com Google
   account, you're a trusted team member.
3. **Audit trail via activities:** All changes are tracked in the activities table
   (via triggers and explicit inserts), providing accountability without restrictive
   policies.
4. **Evolution path:** If the team grows, add an `auth.users` metadata field (e.g.,
   `role: 'admin' | 'viewer'`) and tighten RLS policies to check
   `auth.jwt() ->> 'role'`. No schema changes needed.

---

## 4. Performance, Safety & Evolution

### 4.1 Index Strategy

Each index targets a specific hot query path. Indexes are listed with their
justification.

| Index | Table | Query Path | Type |
|-------|-------|------------|------|
| `idx_builds_status` | builds | Filter by status (dashboard counts) | btree |
| `idx_builds_started_at` | builds | Chronological build list, trend chart | btree DESC |
| `idx_builds_job_name` | builds | Filter builds by job | btree |
| `idx_builds_created_at` | builds | Retention cleanup, recent builds | btree DESC |
| `idx_builds_source_job` | builds | Upsert conflict detection (composite) | btree |
| `idx_builds_ocp_version` | builds | Filter by OCP version (partial) | btree, WHERE NOT NULL |
| `idx_tickets_status` | support_tickets | Ticket list filter | btree |
| `idx_tickets_severity` | support_tickets | Ticket list sort/filter | btree |
| `idx_tickets_error_signature` | support_tickets | Triage dedup lookup (partial) | btree, WHERE NOT NULL |
| `idx_tickets_ticket_number` | support_tickets | Direct ticket lookup by # | btree |
| `idx_tickets_build_id` | support_tickets | Find tickets for a build (partial) | btree, WHERE NOT NULL |
| `idx_tickets_created_at` | support_tickets | Chronological ticket list | btree DESC |
| `idx_tickets_jira_key` | support_tickets | JIRA integration lookup (partial) | btree, WHERE NOT NULL |
| `idx_activities_created_at` | activities | Activity feed pagination | btree DESC |
| `idx_activities_ticket_id` | activities | Ticket detail activities (partial) | btree, WHERE NOT NULL |
| `idx_activities_build_id` | activities | Build-related activities (partial) | btree, WHERE NOT NULL |
| `idx_activities_type` | activities | Filter by activity type | btree |
| `idx_tasks_ticket_id` | tasks | Tasks per ticket | btree |
| `idx_agent_runs_agent_name` | agent_runs | Filter runs by agent | btree |
| `idx_agent_runs_created_at` | agent_runs | Recent runs | btree DESC |
| `idx_agent_runs_success` | agent_runs | Failed runs dashboard (partial) | btree, WHERE NOT success |

**Partial indexes** are used wherever columns are frequently NULL. This reduces index
size and speeds up scans since only relevant rows are indexed.

The UNIQUE constraint `builds_source_extid_job_uq` on `(source, external_id, job_name)`
serves double duty as the upsert conflict target and an implicit index.

### 4.2 JSONB Query Patterns

The `test_failures` column is a JSONB array of objects. Common access patterns:

```sql
-- Count failures with a specific error message pattern
SELECT id, job_name
FROM builds
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(test_failures) AS tf
  WHERE tf->>'errorMessage' ILIKE '%timeout%'
);

-- Extract all failure names from a build
SELECT
  b.id,
  tf->>'name'         AS test_name,
  tf->>'className'    AS class_name,
  tf->>'errorMessage' AS error_message
FROM builds b,
     jsonb_array_elements(b.test_failures) AS tf
WHERE b.id = :build_id;

-- Find builds with a specific test class failure
SELECT id, job_name, started_at
FROM builds
WHERE test_failures @> '[{"className": "com.example.SomeTest"}]'::jsonb;
```

**GIN index consideration:** A GIN index on `test_failures` would accelerate `@>`
(containment) queries but adds write overhead. Given the expected volume (~50-100
builds/day), the GIN index is worth adding only if JSONB containment queries become
frequent:

```sql
-- Add only if needed (monitor query performance first)
CREATE INDEX idx_builds_test_failures_gin ON builds USING gin (test_failures);
```

For the `parameters` JSONB column, queries are rare (mostly display-only), so no
index is warranted.

### 4.3 Data Volume Projections

| Metric | Estimate | Basis |
|--------|----------|-------|
| Builds ingested per day | 50-100 | ~10 Jenkins jobs + ~10 Prow jobs, each running 3-5x/day |
| Builds per month | 1,500-3,000 | |
| Builds per year | ~20,000-36,000 | |
| Support tickets created per week | 10-30 | ~20-40% failure rate, dedup reduces volume |
| Tickets per year | ~500-1,500 | |
| Activities per day | 100-300 | 2-3 per build + 3-5 per ticket lifecycle |
| Activities per year | ~50,000-100,000 | |
| Tasks per ticket | 3-8 | Checklist items |
| Agent runs per day | 300-500 | 288 cron invocations + event-driven |
| Raw payload size (avg) | 10-50 KB | Jenkins/Prow API response |
| Total DB size at 1 year | ~2-5 GB | Dominated by raw_payload before retention cleanup |

**Conclusion:** Supabase's free/Pro tier (8 GB database) handles this volume comfortably.
The 90-day retention cleanup for `raw_payload` keeps growth linear and bounded.

### 4.4 Retention & Archival Strategy

| Data | Retention | Strategy |
|------|-----------|----------|
| `builds.raw_payload` | 90 days | pg_cron sets to NULL daily (see Section 1.5) |
| `builds` (rows) | Indefinite | Rows are small once raw_payload is cleared (~1 KB each) |
| `activities` | Indefinite | Append-only audit log; rows are small (~0.5 KB) |
| `agent_runs` | 180 days | pg_cron deletes rows older than 180 days |
| `support_tickets` | Indefinite | Business data, never auto-deleted |
| `tasks` | Indefinite | Cascade-deleted with parent ticket only |

**Additional retention cron job for agent_runs:**
```sql
SELECT cron.schedule(
  'cleanup-agent-runs',
  '30 3 * * *',
  $$
  DELETE FROM agent_runs WHERE created_at < now() - interval '180 days';
  $$
);
```

**Archival (future):** If historical build data is needed beyond the retention window,
export raw_payload to an S3 bucket before the cleanup job runs. This can be implemented
as a pre-cleanup Edge Function that streams expiring records to S3.

### 4.5 Migration Strategy

#### Adding new enum values

Postgres supports `ALTER TYPE ... ADD VALUE` which is safe and non-locking:

```sql
-- Example: adding a new build_status value
ALTER TYPE build_status ADD VALUE 'timeout' AFTER 'unstable';
```

**Caveats:**
- `ADD VALUE` cannot run inside a transaction block. Supabase migrations run each file
  as a single transaction, so wrap enum additions in their own migration file.
- Enum value removal is not supported natively. To remove a value, create a new type,
  migrate columns, and drop the old type (rare operation, plan carefully).

#### Adding new columns

Non-breaking additions with defaults:

```sql
-- Adding a nullable column: instant, no table rewrite
ALTER TABLE support_tickets ADD COLUMN slack_thread_ts TEXT;

-- Adding a column with a default: instant on Postgres 11+ (no table rewrite)
ALTER TABLE builds ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
```

**Migration file convention:**
```
supabase/migrations/
  20260810000001_initial_schema.sql
  20260810000002_add_slack_thread_ts.sql
  ...
```

Each migration is idempotent where possible (use `IF NOT EXISTS` for types, tables).

#### Adding new tables

Follow the same pattern as the initial schema: CREATE TABLE, indexes, RLS enable,
RLS policies. Wrap in a single migration file.

### 4.6 Concurrency Safety

#### Triage dedup (advisory locks)

The triage agent uses `pg_advisory_xact_lock(hashtext(error_signature))` to serialize
concurrent dedup checks (detailed in Section 2.3). This prevents the TOCTOU race
where two simultaneous failures with the same signature both create tickets.

**Why advisory locks over UNIQUE constraints on error_signature:**
- A UNIQUE constraint on `error_signature` would prevent multiple tickets for the
  same error entirely, even across resolved/new cycles. This is too restrictive --
  a new occurrence of a previously-resolved error should create a new ticket.
- The advisory lock scopes to the transaction, allowing the check-then-insert to
  be atomic without permanently constraining the column.

#### Upsert safety for build ingestion

The `ON CONFLICT (source, external_id, job_name) DO UPDATE` clause handles concurrent
ingestion safely. The WHERE clause on the upsert prevents overwriting terminal states:

```sql
WHERE builds.status IN ('pending', 'running')
   OR builds.status IS DISTINCT FROM EXCLUDED.status;
```

This means if two ingestion runs try to update the same build simultaneously, both
succeed but the final state is deterministic (last writer wins, which is correct
since both carry the same upstream data).

#### Realtime subscription ordering

Supabase Realtime delivers changes in WAL order, so the frontend receives events in
commit order. No additional client-side ordering is needed for the activity feed
beyond sorting by `created_at`.

### 4.7 Monitoring Queries

Useful queries for operational monitoring (can be exposed in an admin view or used
in alerts):

```sql
-- Agent health: failures in the last hour
SELECT agent_name, count(*) AS failures
FROM agent_runs
WHERE NOT success AND created_at > now() - interval '1 hour'
GROUP BY agent_name;

-- Ingestion lag: time since last successful build ingestion
SELECT source,
       max(created_at) AS last_ingested,
       now() - max(created_at) AS lag
FROM builds
GROUP BY source;

-- Ticket backlog by severity
SELECT severity, status, count(*)
FROM support_tickets
WHERE status NOT IN ('resolved', 'verified')
GROUP BY severity, status
ORDER BY severity, status;

-- Average time-to-resolve by severity (last 30 days)
SELECT severity,
       count(*) AS resolved_count,
       avg(EXTRACT(EPOCH FROM (resolved_at - created_at))) / 3600 AS avg_hours
FROM support_tickets
WHERE resolved_at IS NOT NULL
  AND resolved_at > now() - interval '30 days'
GROUP BY severity;
```
