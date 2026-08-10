# CAPA CI Tracker — Implementation Plan

## Context

The CAPA team uses Jira to track CI build failures across Jenkins and Prow, but Jira is too heavyweight for the detect → diagnose → fix → verify cycle. This plan creates a **new standalone repo** `capa-ci-tracker` at `~/acm_dev/capa-ci-tracker/` — a React + Supabase system with five cooperating sub-agents that automates the full failure lifecycle.

**CI sources:**
- Jenkins: `jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/` (internal, VPN)
- Prow: `prow.ci.openshift.org/?type=periodic&job=*rosa-e2e-main_capa-e2e*` (public)

**New repo:** `~/acm_dev/capa-ci-tracker/`

---

## 1. Directory Structure

```
capa-ci-tracker/
  README.md
  .gitignore
  supabase/
    config.toml
    migrations/
      001_initial_schema.sql
      002_rls_policies.sql
    functions/
      ingest-jenkins/index.ts
      ingest-prow/index.ts
      triage/index.ts
      diagnosis/index.ts
      resolution-tracker/index.ts
      notify/index.ts
  frontend/
    package.json
    vite.config.js
    tailwind.config.js
    index.html
    src/
      main.jsx
      App.jsx
      config/supabase.js
      store/AppContext.jsx
      hooks/
        useRealtimeTable.js
        useBuilds.js
        useTickets.js
        useActivities.js
      pages/
        ActivityPage.jsx
        TicketsPage.jsx
        TransactionsPage.jsx
      components/
        layout/AppShell.jsx, TabBar.jsx
        activity/ActivityTimeline.jsx, ActivityCard.jsx
        tickets/TicketList.jsx, TicketDetail.jsx, TicketCreateModal.jsx,
                TicketStatusBadge.jsx, SeverityBadge.jsx, TaskChecklist.jsx
        transactions/BuildHistoryTable.jsx, BuildDetail.jsx, BuildTrendChart.jsx
        shared/StatusBadge.jsx, DateRangeFilter.jsx, LoadingSpinner.jsx, EmptyState.jsx
```

---

## 2. Data Model (Postgres via Supabase)

### ENUMs

```sql
CREATE TYPE build_status   AS ENUM ('pending','running','success','failure','aborted','unstable');
CREATE TYPE ticket_status  AS ENUM ('new','investigating','root_caused','fix_in_progress','resolved','verified');
CREATE TYPE ticket_severity AS ENUM ('nightly_blocker','test_regression','flaky','infrastructure','upstream_breakage');
CREATE TYPE activity_type  AS ENUM ('build_completed','ticket_created','ticket_updated','note_added',
                                    'diagnosis_completed','fix_submitted','fix_merged','notification_sent');
CREATE TYPE task_status    AS ENUM ('open','in_progress','done','blocked');
```

### `builds`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | `gen_random_uuid()` |
| source | TEXT | `'jenkins'` or `'prow'` |
| external_id | TEXT | Jenkins build# or Prow job ID |
| job_name | TEXT | `'capi_tests'` or `'periodic-...-capa-e2e'` |
| job_url | TEXT | Direct link to build |
| status | build_status | |
| pass_count, fail_count, skip_count, total_count | INT | From test report |
| duration_ms | BIGINT | |
| started_at, finished_at | TIMESTAMPTZ | |
| ocp_version | TEXT | e.g. `'4.22.0-nightly-2026-08-09'` |
| parameters | JSONB | Jenkins params / Prow args |
| test_failures | JSONB | `[{name, className, errorMessage, errorStackTrace}]` |
| raw_payload | JSONB | Full API response |
| created_at, updated_at | TIMESTAMPTZ | |
| **UNIQUE** | | `(source, external_id, job_name)` |

**Indexes:** `status`, `started_at DESC`, `job_name`

### `support_tickets`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| ticket_number | SERIAL | Human-friendly `CAPA-1234` |
| title | TEXT | |
| description | TEXT | |
| status | ticket_status | Default `'new'` |
| severity | ticket_severity | Default `'test_regression'` |
| assignee | TEXT | |
| build_id | UUID FK → builds | Originating build |
| error_signature | TEXT | Normalized fingerprint for dedup |
| root_cause | TEXT | |
| root_cause_category | TEXT | `'capi_migration'`, `'aws_quota'`, etc. |
| fix_pr_url | TEXT | |
| fix_pr_number | INT | |
| upstream_issue_url | TEXT | |
| jira_key | TEXT | Link back to Jira `RHACM4K-xxxxx` |
| labels | TEXT[] | `['capi-v1beta2','ocp-4.22']` |
| verified_in_build_id | UUID FK → builds | |
| created_at, updated_at, resolved_at, verified_at | TIMESTAMPTZ | |

**Indexes:** `status`, `severity`, `error_signature`, `ticket_number`

### `activities`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| activity_type | activity_type | |
| title | TEXT | `"Build #347 failed"` |
| description | TEXT | Detail body |
| build_id | UUID FK → builds | nullable |
| ticket_id | UUID FK → support_tickets | nullable |
| actor | TEXT | `'system'`, `'triage-agent'`, user |
| metadata | JSONB | Flexible payload |
| created_at | TIMESTAMPTZ | |

**Indexes:** `created_at DESC`, `ticket_id`, `build_id`

### `tasks`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| ticket_id | UUID FK → support_tickets | ON DELETE CASCADE |
| title | TEXT | |
| status | task_status | Default `'open'` |
| assignee | TEXT | |
| sort_order | INT | |
| created_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

### `agent_runs`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_name | TEXT | `'ingest-jenkins'`, `'triage'`, etc. |
| trigger | TEXT | `'cron'`, `'webhook'`, `'manual'` |
| input_payload, output_payload | JSONB | |
| success | BOOL | |
| error_message | TEXT | |
| duration_ms | INT | |
| created_at | TIMESTAMPTZ | |

### Triggers

- `set_updated_at()` — auto-update `updated_at` on `builds` and `support_tickets`
- `record_status_change()` — on ticket status change, auto-insert into `activities` and set timestamp fields (`resolved_at`, `verified_at`)

---

## 3. React Frontend

**Stack:** Vite + React 18 + Tailwind CSS + React Router 6 + `@supabase/supabase-js`
**State:** `useReducer` + Context (same pattern as `test-automation-capa/ui/frontend/src/store/AppContext.jsx`)
**Charts:** Custom stacked bar using Tailwind (same pattern as `JenkinsTestResultsTrend.jsx` — no charting library needed)

### Routes

| Path | Page | Tab |
|---|---|---|
| `/` | `ActivityPage` | Activity |
| `/tickets` | `TicketsPage` | Tickets |
| `/tickets/:id` | `TicketsPage` (detail) | Tickets |
| `/transactions` | `TransactionsPage` | Transactions |

### Key Components

- **`AppShell`** — layout with `TabBar` (Activity / Tickets / Transactions)
- **`ActivityTimeline`** — vertical timeline of all events, filterable by type/actor/date
- **`TicketList`** — sortable table with status/severity filters and search
- **`TicketDetail`** — full view with: description, root cause, resolution, linked builds, `TaskChecklist`, scoped `ActivityTimeline`, `CommentForm`
- **`TicketStatusBadge`** / **`SeverityBadge`** — colored pills
- **`BuildHistoryTable`** — paginated build list with source/status filters
- **`BuildTrendChart`** — stacked bar chart (pass/fail/skip) — port from existing `JenkinsTestResultsTrend.jsx`
- **`BuildDetail`** — expandable row with test failures, parameters, links
- **`DateRangeFilter`** — 24h/7d/30d/All toggle

### Custom Hooks

- **`useRealtimeTable(table, filters, orderBy)`** — generic Supabase Realtime subscription, returns `{data, loading, error}`
- **`useBuilds(dateRange)`**, **`useTickets(filters)`**, **`useActivities(scope)`** — wrappers

### Supabase Client (`config/supabase.js`)

```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### Realtime Integration

Subscribe to `builds`, `support_tickets`, `activities` for live UI updates:
```js
supabase.channel('builds-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'builds' }, handleChange)
  .subscribe()
```

### Auth

Supabase Auth with Google OAuth (`@redhat.com` domain). RLS: all authenticated users read/write everything (small team). Edge Functions use `service_role` key.

---

## 4. CI Ingestion (Edge Functions)

### Jenkins (`ingest-jenkins/index.ts`)

Port the pattern from `test-automation-capa/ui/backend/aws_dashboard_routes.py:320-411`:

1. Poll `{jenkins_base}/api/json?tree=builds[number,result,timestamp,duration,actions[parameters[name,value]]]{0,20}` every 5 min via `pg_cron`
2. For each build, fetch `/{buildNumber}/testReport/api/json` → `passCount`, `failCount`, `skipCount`, individual `suites[].cases[]`
3. Upsert into `builds` with `ON CONFLICT (source, external_id, job_name)` — idempotent
4. SSL: `rejectUnauthorized: false` (self-signed cert)
5. Auth: Jenkins API token via Edge Function secrets

**Network note:** Jenkins is behind VPN. Options: (a) self-host Supabase on OpenShift, (b) internal cron pushes to Supabase REST API, (c) VPN bridge.

### Prow (`ingest-prow/index.ts`)

1. Poll `https://prow.ci.openshift.org/prowjobs.js?type=periodic&job=*rosa-e2e-main_capa-e2e*`
2. Parse ProwJob objects: `spec.job`, `status.state`, `status.startTime`, `status.completionTime`, `status.url`, `status.build_id`
3. Map state: `success`/`failure`/`pending`/`aborted`/`error`
4. Upsert into `builds`

---

## 5. Sub-Agent Architecture (Edge Functions)

All agents coordinate through the database — one agent's writes trigger the next agent via Postgres triggers or `pg_cron`.

```
pg_cron (5min) → ingest-jenkins/ingest-prow → INSERT builds
                                                    │
                                        Postgres trigger (status='failure')
                                                    │
                                                    ▼
                                                triage → CREATE support_ticket
                                                    │
                                                    ▼
                                              diagnosis → UPDATE root_cause
                                                    │
                                        Postgres trigger (new activity)
                                                    │
                                                    ▼
                                                 notify → Slack message

User links PR → UPDATE fix_pr_url, status='fix_in_progress'

pg_cron (15min) → resolution-tracker → check PR merged → status='resolved'
                                     → check next build passes → status='verified'
                                                    │
                                                    ▼
                                                 notify → Slack message
```

### Triage Agent

1. Normalize error: strip timestamps, UUIDs, IPs → `error_signature`
2. Match against open tickets with same `error_signature` → link build, add activity
3. No match → create ticket with auto-severity:
   - `nightly_blocker`: job contains 'nightly' OR all tests failed
   - `upstream_breakage`: error matches CAPI/OCP version patterns
   - `infrastructure`: matches timeout/VPC/IAM patterns
   - `flaky`: same test alternates pass/fail in last 10 builds
   - `test_regression`: default
4. Create default tasks: "Investigate logs", "Identify root cause", "Submit fix PR", "Verify in next nightly"

### Diagnosis Agent

Port the 12 patterns from `rosa-hcp-e2e-test-fresh-upstream/agents/knowledge_base/known_issues.json`:
- `cloudformation_deletion_failure`, `ocm_auth_failure`, `capi_not_installed`, `api_rate_limit`, `resource_quota_exceeded`, `rosacontrolplane_stuck_deletion`, `rosanetwork_stuck_deletion`, `rosaroleconfig_stuck_deletion`, `vpc_deletion_failure`, `networking_configuration_error`, `repeated_timeouts`, `iam_permission_error`

Match `test_failures[].errorMessage` against these regex patterns → populate `root_cause` and `root_cause_category` on the ticket.

### Resolution Tracker

- Check GitHub API: `GET /repos/stolostron/rosa-hcp-e2e-test/pulls/{number}` for `merged_at`
- On merge → status `'resolved'`, record activity
- On next successful build with no matching `error_signature` → status `'verified'`

### Notification Agent

Slack Block Kit messages via webhook (port pattern from `test-automation-capa/ui/backend/slack_notification_service.py`):
- New failure: "Build #{n} failed — {fail_count} tests"
- Ticket created: "CAPA-{number}: {title} — {severity}"
- Ticket resolved/verified

---

## 6. Implementation Phases

| Phase | What | Days |
|---|---|---|
| **1. Foundation** | `git init capa-ci-tracker`, Supabase init + migration, React scaffold + AppShell + routing | 1-2 |
| **2. Ingestion** | Jenkins + Prow edge functions, pg_cron, upsert logic | 3-4 |
| **3. Transactions** | `BuildHistoryTable`, `BuildTrendChart`, `BuildDetail`, `DateRangeFilter` | 5-6 |
| **4. Triage + Tickets** | Triage edge function, `TicketList`, `TicketDetail`, `TicketCreateModal`, `TaskChecklist` | 7-9 |
| **5. Activity + Diagnosis** | Diagnosis edge function (12 patterns), `ActivityTimeline`, `CommentForm` | 10-12 |
| **6. Resolution + Notifications** | Resolution tracker, notify edge function, Slack integration, "Link PR" UI | 13-14 |
| **7. Polish** | Auth (Google OAuth), error boundaries, responsive design | 15-16 |

---

## 7. Reference Files to Reuse

| Pattern | Source File |
|---|---|
| Jenkins API polling | `~/acm_dev/test-automation-capa/ui/backend/aws_dashboard_routes.py:320-411` |
| Stacked bar chart | `~/acm_dev/test-automation-capa/ui/frontend/src/components/charts/JenkinsTestResultsTrend.jsx` |
| Slack Block Kit | `~/acm_dev/test-automation-capa/ui/backend/slack_notification_service.py` |
| Error pattern regexes | `~/acm_dev/rosa-hcp-e2e-test-fresh-upstream/agents/knowledge_base/known_issues.json` (12 patterns) |
| State management pattern | `~/acm_dev/test-automation-capa/ui/frontend/src/store/AppContext.jsx` |

---

## Verification

1. `cd ~/acm_dev/capa-ci-tracker && supabase start` → verify all tables created, triggers working
2. `cd frontend && npm run dev` → verify React app loads with all 3 tabs
3. Manually invoke `ingest-jenkins` edge function → verify builds appear in Transactions tab
4. Insert a failed build → verify triage auto-creates a ticket
5. Verify ticket detail shows linked build, auto-generated tasks, activity timeline
6. Link a PR → verify resolution tracker advances status
7. Verify Slack notification fires on ticket creation
