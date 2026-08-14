# Migration Plan: Supabase to SQLite + Express

**Status:** Draft
**Author:** System Architect
**Date:** 2026-08-14

## 1. Executive Summary

Replace the Supabase dependency (Postgres, PostgREST, Edge Functions, pg_cron, Realtime) with a single Node.js process running Express + better-sqlite3. The React frontend stays largely unchanged -- it already uses a custom PostgREST-compatible client (`src/config/supabase.js`) with 30-second polling instead of Supabase Realtime. The migration's main work is: (a) translating the Postgres schema to SQLite, (b) building an Express API layer that matches the PostgREST query protocol the frontend speaks, (c) porting 6 Deno Edge Functions to Node.js modules, and (d) replacing pg_cron with node-cron.

**Key insight that simplifies everything:** The frontend does NOT use `@supabase/supabase-js`. It uses a hand-rolled PostgREST client (`PostgRESTFilterBuilder` in `src/config/supabase.js`) that speaks raw HTTP to `/api/{table}?column=operator.value`. The backend just needs to implement that same HTTP protocol.

## 2. New Backend Directory Structure

```
server/
  index.ts                    # Express app entry point, static file serving
  db/
    schema.sql                # SQLite schema (translated from Postgres)
    seed.sql                  # Seed data (translated from Postgres)
    connection.ts             # better-sqlite3 setup, WAL mode, pragmas
    migrations/
      001_initial.sql         # Combined initial schema
  api/
    postgrest-compat.ts       # PostgREST-compatible query parser + response formatter
    router.ts                 # Express router: GET/POST/PATCH/DELETE /:table
    rpc.ts                    # RPC endpoints (dedup_triage_check)
    views.ts                  # View query definitions (v_ticket_summary, etc.)
  agents/
    ingest-jenkins.ts         # Ported from supabase/functions/ingest-jenkins/
    ingest-prow.ts            # Ported from supabase/functions/ingest-prow/
    triage.ts                 # Ported from supabase/functions/triage/
    diagnosis.ts              # Ported from supabase/functions/diagnosis/
    resolution-tracker.ts     # Ported from supabase/functions/resolution-tracker/
    notify.ts                 # Ported from supabase/functions/notify/
    known-issues.ts           # 12 known-issue patterns (extracted from diagnosis)
  scheduler.ts                # node-cron job definitions
  triggers.ts                 # Post-write hooks (replaces Postgres triggers)
  auth.ts                     # Auth middleware (dev bypass / OCP proxy)
  config.ts                   # Environment variables, defaults
  package.json
  tsconfig.json
```

## 3. NPM Package Selection

| Purpose | Package | Why |
|---|---|---|
| HTTP server | `express` ^5.1 | Industry standard, team knows it, TS support |
| SQLite driver | `better-sqlite3` ^11 | Synchronous API (no async overhead), WAL mode, prepared statements, fastest Node.js SQLite driver |
| UUID generation | `uuid` ^11 | Generate UUIDs for primary keys (SQLite has no gen_random_uuid) |
| Cron scheduling | `node-cron` ^3 | Drop-in replacement for pg_cron syntax |
| SHA-256 hashing | Node.js `crypto` (built-in) | Replaces Deno crypto.subtle for error signature computation |
| Slack notifications | Built-in `fetch` (Node 18+) | No package needed, same as Edge Function |
| GitHub API | Built-in `fetch` | Same as resolution-tracker Edge Function |
| Jenkins API | Built-in `fetch` | Same as ingest-jenkins Edge Function |
| Env vars | `dotenv` ^16 | Load .env file |
| TypeScript | `tsx` ^4 | Run TS directly in dev; `tsc` for production build |
| Static serving | `express.static` | Serve built React frontend from `frontend/dist/` |

**Dev dependencies:** `typescript`, `@types/express`, `@types/better-sqlite3`, `@types/node`, `@types/uuid`

## 4. Feature Mapping: Supabase to SQLite + Express

### 4.1 Database Schema

**Postgres ENUMs** become **SQLite CHECK constraints:**

```sql
-- Postgres:
CREATE TYPE build_status AS ENUM ('pending','running','success','failure','aborted','unstable');

-- SQLite:
-- No ENUM type. Use TEXT with CHECK constraint.
CREATE TABLE builds (
  ...
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','failure','aborted','unstable')),
  ...
);
```

**UUID primary keys** stay as TEXT. Generate with `uuid.v4()` in the application layer. SQLite does not have `gen_random_uuid()`.

**TIMESTAMPTZ** becomes **TEXT** storing ISO 8601 strings. SQLite has no native timestamp type, but ISO 8601 strings sort correctly and parse with `new Date()`.

**JSONB** becomes **TEXT** storing JSON strings. Use `json_extract()` for queries against JSON fields. SQLite's JSON1 extension is built-in to better-sqlite3.

**GENERATED ALWAYS AS IDENTITY** (`ticket_number`) becomes **INTEGER PRIMARY KEY AUTOINCREMENT** on a separate column, or an explicit `INTEGER` with a trigger that increments from a sequence table.

**Recommended approach for ticket_number:**
```sql
-- Use a separate auto-increment since SQLite only supports AUTOINCREMENT on the PK
-- ticket_number gets assigned in the INSERT trigger or application code
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  ticket_number INTEGER UNIQUE,  -- assigned by trigger
  ...
);

-- Trigger to auto-assign ticket_number
CREATE TRIGGER trg_ticket_number
  AFTER INSERT ON support_tickets
  FOR EACH ROW
  WHEN NEW.ticket_number IS NULL
BEGIN
  UPDATE support_tickets
  SET ticket_number = (SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM support_tickets)
  WHERE id = NEW.id;
END;
```

**Array columns** (`labels TEXT[]`) become **TEXT** storing JSON arrays. Query with `json_each()`:
```sql
-- Postgres: WHERE 'jenkins' = ANY(labels)
-- SQLite: WHERE EXISTS (SELECT 1 FROM json_each(labels) WHERE value = 'jenkins')
```

**Key schema differences to handle:**

| Postgres Feature | SQLite Equivalent |
|---|---|
| `gen_random_uuid()` | Application-layer `uuid.v4()` |
| `TIMESTAMPTZ` | `TEXT` (ISO 8601) |
| `JSONB` | `TEXT` + `json_extract()` |
| `TEXT[]` | `TEXT` (JSON array) |
| `GENERATED ALWAYS AS IDENTITY` | Auto-increment trigger |
| `now()` | Application passes `new Date().toISOString()` |
| `EXTRACT(EPOCH FROM ...)` | `(julianday(a) - julianday(b)) * 86400` |
| `date_trunc('day', x)` | `date(x)` |
| `FILTER (WHERE ...)` | `CASE WHEN ... THEN 1 END` with `SUM` |
| `percentile_cont(0.5) WITHIN GROUP` | Manual median via subquery or application code |
| Advisory locks (`pg_advisory_xact_lock`) | SQLite's single-writer serialization (implicit) |
| `pg_notify` | In-process event emitter |

### 4.2 Views

All 5 views translate to SQLite with these adjustments:

**v_ticket_summary** -- direct translation, replace `count(*) FILTER (WHERE ...)` with `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`, replace `EXTRACT(EPOCH FROM ...)` with julianday math.

**v_build_failures** -- direct translation, no special Postgres features used.

**v_daily_build_stats** -- replace `date_trunc('day', started_at)::date` with `date(started_at)`, replace `FILTER (WHERE ...)` with CASE/SUM, replace `avg(...) FILTER (WHERE ...)` with a conditional average.

**v_ticket_lifecycle** -- replace `EXTRACT(EPOCH FROM ...)` with julianday math. Subquery for `pr_submitted_at` stays the same.

**v_pipeline_funnel** -- the `percentile_cont` aggregation has no SQLite equivalent. Options:
1. Compute median in application code (recommended -- only 5 rows returned)
2. Use a CTE with NTILE or ROW_NUMBER (verbose but works)
3. Drop median from the view, compute it in the API layer

**Recommended:** Return `NULL` for `median_stage_duration_seconds` from the SQLite view and compute it in the API response handler using a separate query.

**v_failure_timeline** -- direct translation, replace `::text` casts with implicit text (SQLite is typeless).

### 4.3 Triggers

The 4 Postgres trigger functions become **application-layer post-write hooks** in `server/triggers.ts`:

| Postgres Trigger | SQLite Replacement |
|---|---|
| `set_updated_at()` | Application sets `updated_at` on every UPDATE call in the API layer |
| `record_status_change()` | Post-UPDATE hook in Express: if `status` changed, INSERT activity, set `resolved_at`/`verified_at` |
| `notify_new_build_failure()` | Post-INSERT hook: if `status === 'failure'`, call triage agent directly (in-process) |
| `notify_new_activity()` | Post-INSERT hook: call notify agent directly (in-process) |
| `dedup_triage_check()` | Regular function call -- SQLite is single-writer, so advisory locks are unnecessary. The serialization is implicit. |

This is actually simpler than Postgres triggers. Since everything runs in one process, the "trigger" is just a function call after the database write.

```typescript
// server/triggers.ts
import { EventEmitter } from 'events';

export const dbEvents = new EventEmitter();

// Called by the API layer after every INSERT on builds
export function afterBuildInsert(build: Build) {
  if (build.status === 'failure') {
    // Equivalent to pg_notify('build_failure', ...)
    dbEvents.emit('build_failure', { build_id: build.id, job_name: build.job_name, source: build.source });
  }
}

// Called by the API layer after every INSERT on activities
export function afterActivityInsert(activity: Activity) {
  // Equivalent to pg_notify('new_activity', ...)
  dbEvents.emit('new_activity', { activity_id: activity.id, activity_type: activity.activity_type });
}
```

### 4.4 PostgREST-Compatible API Layer

The frontend's `PostgRESTFilterBuilder` sends requests like:

```
GET /api/builds?status=eq.failure&started_at=gte.2026-08-07T00:00:00Z&order=started_at.desc&select=*
Headers: Range: 0-19, Prefer: count=exact
```

The Express API must parse this protocol. The key operations:

| PostgREST Operator | SQL Translation |
|---|---|
| `eq.value` | `= ?` |
| `neq.value` | `!= ?` |
| `gt.value` | `> ?` |
| `gte.value` | `>= ?` |
| `lt.value` | `< ?` |
| `lte.value` | `<= ?` |
| `in.(a,b,c)` | `IN (?, ?, ?)` |
| `ilike.%pattern%` | `LIKE ? (case-insensitive via COLLATE NOCASE)` |
| `is.null` | `IS NULL` |
| `not.in.(a,b)` | `NOT IN (?, ?)` |
| `or=(a.eq.1,b.eq.2)` | `(a = ? OR b = ?)` |
| `cs.["value"]` | `json_extract` + `json_each` contains check |
| `order=col.desc` | `ORDER BY col DESC` |
| `Range: 0-19` | `LIMIT 20 OFFSET 0` |
| `Prefer: count=exact` | Execute a parallel `SELECT count(*)` and return via `Content-Range` header |
| `select=col1,col2` | `SELECT col1, col2` |

**Embedded resources (foreign key joins):** The frontend uses PostgREST's embedded resource syntax in a few places:

```javascript
// useTicketDetail: 
select: '*, builds:build_id(id, external_id, ...), verify_build:verified_in_build_id(id, ...)'

// useActivities:
select: '*, support_tickets:ticket_id(id, ticket_number, ...), builds:build_id(id, ...)'
```

This is the most complex PostgREST feature to replicate. Options:
1. **Implement a basic join parser** -- parse `table:fk_column(col1,col2)` syntax, generate LEFT JOINs, nest results in the response. This is the clean approach.
2. **Move joins to dedicated endpoints** -- e.g., `GET /api/tickets/:id/detail` returns pre-joined data. Requires frontend changes.
3. **Hybrid** -- implement the join parser for the 2-3 patterns actually used.

**Recommended:** Option 3. The codebase only uses embedded resources in 2 hooks (`useTicketDetail` and `useActivities`). Build a minimal join parser that handles `alias:fk_column(col1,col2,...)` syntax.

**RPC endpoints:**
```
POST /api/rpc/dedup_triage_check  { p_error_signature: "..." }
```
Implement as a regular Express route that runs the dedup query. No advisory lock needed -- SQLite serializes writes automatically.

**Mutation operations:**
```
POST   /api/{table}          -- INSERT (body = row data)
PATCH  /api/{table}?filters  -- UPDATE (body = partial row, filters select rows)
DELETE /api/{table}?filters  -- DELETE
POST   /api/{table}          -- UPSERT (when Prefer header includes resolution=merge-duplicates)
```

For UPSERT, translate to SQLite's `INSERT OR REPLACE` or `INSERT ... ON CONFLICT DO UPDATE`.

### 4.5 Auth

The current auth is already simplified:

- **Production (OCP):** oauth-proxy sidecar handles auth before traffic reaches the app. The app never sees unauthenticated requests. `useAuth.js` returns a static `OCP_USER`.
- **Development:** `VITE_DEV_BYPASS_AUTH=true` returns a static `DEV_USER`.

**No change needed.** The Express server simply serves all requests without auth middleware. If OCP oauth-proxy is in front, it handles authentication. For local dev, everything is open.

If API key auth is desired later, add a simple middleware that checks `Authorization: Bearer <static-token>` from an env var.

### 4.6 Realtime / Polling

The frontend already uses 30-second polling (`setInterval(fetchData, 30000)` in `useRealtimeTable.js`). There are no Supabase Realtime WebSocket subscriptions. The `realtimeTable` option in hooks is unused (kept for API compat per the comment in the code).

**No change needed.** Polling continues to work against the new Express API.

**Future option (not in scope):** Add Server-Sent Events (SSE) endpoint `/api/events` that the frontend can subscribe to. The `dbEvents` EventEmitter in `triggers.ts` would push events to SSE clients. This would reduce polling load and improve latency. But it is not required for parity.

### 4.7 Scheduling (pg_cron replacement)

| pg_cron Job | node-cron Equivalent |
|---|---|
| `ingest-jenkins` every 5 min | `cron.schedule('*/5 * * * *', () => ingestJenkins())` |
| `ingest-prow` every 5 min (offset +2) | `cron.schedule('2-59/5 * * * *', () => ingestProw())` |
| `resolution-tracker` every 15 min | `cron.schedule('*/15 * * * *', () => resolutionTracker())` |
| `retention-cleanup` daily 03:00 UTC | `cron.schedule('0 3 * * *', () => retentionCleanup())` |
| `cleanup-agent-runs` daily 03:30 UTC | `cron.schedule('30 3 * * *', () => cleanupAgentRuns())` |

These are direct function calls in-process, not HTTP calls. Much simpler than the pg_cron + pg_net + Edge Function chain.

### 4.8 Edge Function Porting

Each Edge Function becomes a Node.js module exporting an `async function run(params)`. The changes per function:

**ingest-jenkins.ts:**
- Replace `import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"` with direct `db` calls using better-sqlite3
- Replace `supabase.from("builds").upsert(...)` with `db.prepare("INSERT INTO builds (...) VALUES (...) ON CONFLICT (source, external_id, job_name) DO UPDATE SET ...").run(...)`
- Replace `supabase.from("activities").insert(...)` with `db.prepare("INSERT INTO activities ...").run(...)`
- Replace `Deno.env.get(...)` with `process.env.`
- Remove `serve(async (req) => ...)` wrapper -- export a plain async function
- Replace `supabase.from("agent_runs").insert(...)` with direct INSERT

**ingest-prow.ts:** Same pattern as ingest-jenkins.

**triage.ts:**
- Replace `crypto.subtle.digest("SHA-256", data)` with `crypto.createHash('sha256').update(input).digest('hex')`
- Replace `supabase.rpc("dedup_triage_check", ...)` with a direct SQL query. No advisory lock needed.
- Instead of HTTP-calling the diagnosis function, call it directly: `await diagnosis.run({ ticket_id, build_id })`
- Replace `supabase.from(...)` operations with prepared statements

**diagnosis.ts:** Minimal changes -- just replace Supabase client calls with direct SQL.

**resolution-tracker.ts:** Same pattern. Replace Supabase client calls with direct SQL.

**notify.ts:** Same pattern. The Slack webhook call stays the same (both use `fetch`).

## 5. API Surface Required by Frontend

### 5.1 Table/View Endpoints

All use the PostgREST query protocol described in 4.4.

| Method | Path | Used By | Notes |
|---|---|---|---|
| GET | `/api/builds` | `useBuilds`, `useBuildTrendData`, `useSidebarCounts`, `useTriageSummary` | Supports eq, gte, in, order, range, count |
| GET | `/api/support_tickets` | `useTicketDetail`, `useSidebarCounts` | Supports eq, not, in, is, embedded resources |
| PATCH | `/api/support_tickets` | Ticket detail (status change, assignee, PR link) | Filtered by `id=eq.{uuid}` |
| POST | `/api/support_tickets` | Manual ticket creation | Returns `Prefer: return=representation` |
| DELETE | `/api/support_tickets` | Ticket deletion | Filtered by `id=eq.{uuid}` |
| GET | `/api/activities` | `useActivities` | Supports eq, gte, order, embedded resources, range, count |
| POST | `/api/activities` | Note creation (note_added) | |
| GET | `/api/tasks` | Ticket detail (task list) | Filtered by `ticket_id=eq.{uuid}` |
| POST | `/api/tasks` | Add task | |
| PATCH | `/api/tasks` | Update task status | Filtered by `id=eq.{uuid}` |
| DELETE | `/api/tasks` | Delete task | Filtered by `id=eq.{uuid}` |
| GET | `/api/agent_runs` | Agent observability page (if exists) | |
| GET | `/api/v_ticket_summary` | `useTickets` | View endpoint |
| GET | `/api/v_build_failures` | Build failure views | View endpoint |
| GET | `/api/v_daily_build_stats` | Build trend chart | View endpoint |
| GET | `/api/v_ticket_lifecycle` | `useLifecyclePipeline` | View endpoint |
| GET | `/api/v_pipeline_funnel` | `usePipelineFunnel` | View endpoint |
| GET | `/api/v_failure_timeline` | `useStreakDetail` | View endpoint |
| GET | `/api/failure_streaks` | `useStreaks`, `useStreakDetail`, `useTicketStreak` | |
| GET | `/api/build_logs` | `useStreakDetail`, `useBuildLogs` | |
| GET | `/api/streak_builds` | (internal, agents) | |
| GET | `/api/sop_mappings` | `useSopMappings` | |
| POST | `/api/rpc/dedup_triage_check` | Triage agent (internal) | RPC endpoint |

### 5.2 Response Format

Match PostgREST exactly:
- **GET (list):** Returns `200` with JSON array. `Content-Range: 0-19/42` header when `Prefer: count=exact`.
- **GET (single via `Accept: application/vnd.pgrst.object+json`):** Returns `200` with JSON object. `406` if not found.
- **POST (insert):** Returns `201` with JSON array (or object if single). `Prefer: return=representation` returns inserted rows.
- **PATCH (update):** Returns `200` with JSON array of updated rows.
- **DELETE:** Returns `200` with JSON array of deleted rows, or `204` with no body.
- **UPSERT (`Prefer: return=representation, resolution=merge-duplicates`):** Returns `200`/`201` with upserted rows.

### 5.3 Embedded Resource Syntax

Two specific patterns used by the frontend:

**Pattern 1: `useTicketDetail`**
```
GET /api/support_tickets?id=eq.{uuid}&select=*,builds:build_id(id,external_id,job_name,job_url,status,test_failures,pass_count,fail_count,skip_count,ocp_version,started_at,finished_at),verify_build:verified_in_build_id(id,external_id,job_name,job_url)
```

Response shape:
```json
{
  "id": "...",
  "title": "...",
  "builds": { "id": "...", "external_id": "...", ... },
  "verify_build": { "id": "...", ... }
}
```

**Pattern 2: `useActivities`**
```
GET /api/activities?...&select=*,support_tickets:ticket_id(id,ticket_number,title,status),builds:build_id(id,external_id,job_name,status)
```

Response shape: each activity has nested `support_tickets` and `builds` objects.

Implementation: parse the `select` parameter, detect `alias:fk_column(cols...)` patterns, execute LEFT JOINs, and nest the joined columns under the alias key in the response JSON.

## 6. Frontend Changes

### 6.1 Config (`src/config/supabase.js`)

**Change:** Update `API_URL` default from `/api` to match the Express server.

Minimal change -- the current default is already `/api`, which is what the Express server will serve. If running the Express server on a different port during development, the `VITE_API_URL` env var handles it.

For development with Vite's proxy:
```javascript
// vite.config.js -- add proxy for /api to Express server
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
```

### 6.2 Hooks

**No hook changes required.** All hooks use the `supabase` client from `src/config/supabase.js`, which speaks PostgREST protocol over HTTP. As long as the Express API implements the same protocol, every hook works unchanged.

Specifically verified:
- `useRealtimeTable.js` -- uses `supabase.from(table).select().order().range()` with filter operators. Works unchanged.
- `useBuilds.js` -- uses `useRealtimeTable` + direct `supabase.from('builds').select().gte().order().limit()`. Works unchanged.
- `useTickets.js` -- uses `useRealtimeTable` on `v_ticket_summary`. Uses embedded resources on `support_tickets`. Works unchanged if API implements embedded resources.
- `useActivities.js` -- uses `useRealtimeTable` with embedded resources. Works unchanged.
- `useSidebarCounts.js` -- uses `.select('id', { count: 'exact', head: true })` with `.in()` and `.not()`. Works unchanged.
- `useTriageSummary.js` -- uses `.select('id', { count: 'exact', head: true })` with `.eq()`, `.gte()`, `.in()`, `.is()`. Works unchanged.
- `useSopMappings.js` -- simple `.from('sop_mappings').select().eq().order()`. Works unchanged.
- `useStreaks.js` -- uses `useRealtimeTable` + direct `.from().select().eq().maybeSingle()` and `.in()`. Works unchanged.
- `useLifecycleData.js` -- uses `useRealtimeTable` on `v_ticket_lifecycle` and `v_pipeline_funnel`. Works unchanged.

### 6.3 Auth (`src/hooks/useAuth.js`)

**No change required.** The current implementation returns a static user object. It does not call any Supabase auth endpoints.

### 6.4 App Shell / Routing (`src/App.jsx`)

**No change required.** Auth check is already a simple `if (!user)` against the static user from `useAuth`.

### 6.5 Build Configuration

Add Vite proxy config for development:

```javascript
// frontend/vite.config.js
export default defineConfig({
  // ... existing config ...
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
```

For production, Express serves the built frontend from `frontend/dist/` directly.

## 7. Migration Phases

### Phase 1: SQLite Schema + Express Skeleton (3-4 days)

**Goal:** Running Express server with SQLite database, basic CRUD on all tables, seed data loading.

**Tasks:**
1. Create `server/` directory structure
2. Translate Postgres schema to SQLite (`server/db/schema.sql`):
   - 8 tables: builds, support_tickets, activities, tasks, agent_runs, sop_mappings, failure_streaks, build_logs, streak_builds
   - CHECK constraints for enums
   - All indexes
   - auto-increment trigger for ticket_number
3. Translate seed data to SQLite (`server/db/seed.sql`)
4. Build `server/db/connection.ts`:
   - better-sqlite3 with WAL mode, foreign keys enabled
   - `db.pragma('journal_mode = WAL')`
   - `db.pragma('foreign_keys = ON')`
5. Build PostgREST-compatible query parser (`server/api/postgrest-compat.ts`):
   - Parse query string operators (eq, neq, gt, gte, lt, lte, in, ilike, is, not, or)
   - Parse `order`, `limit`, `offset` from query params
   - Parse `Range` header for pagination
   - Parse `Prefer` header for count, return=representation, resolution=merge-duplicates
   - Parse `select` parameter for column selection and embedded resources
   - Generate parameterized SQL
   - Format response with `Content-Range` header
6. Build table/view router (`server/api/router.ts`):
   - `GET /:table` -- SELECT with filters
   - `POST /:table` -- INSERT
   - `PATCH /:table` -- UPDATE with filters
   - `DELETE /:table` -- DELETE with filters
   - Whitelist of allowed tables/views
7. Build RPC router (`server/api/rpc.ts`):
   - `POST /rpc/dedup_triage_check`
8. Register SQLite views (`server/api/views.ts`):
   - v_ticket_summary, v_build_failures, v_daily_build_stats, v_ticket_lifecycle, v_pipeline_funnel, v_failure_timeline
9. Set up Express app (`server/index.ts`):
   - Mount API router at `/api`
   - Serve static files from `frontend/dist/`
   - Fallback route for SPA (all non-API routes serve index.html)
10. Add Vite proxy config for dev

**Verification:** Run `npm run dev` in frontend, `npm run dev` in server. All existing frontend pages load and display seed data correctly.

**Files to create:** 9 files in `server/`

### Phase 2: Post-Write Hooks (Triggers) (1-2 days)

**Goal:** Automatic timestamp management, status change tracking, and event emission.

**Tasks:**
1. Build `server/triggers.ts`:
   - `afterBuildInsert(build)` -- emit `build_failure` event if status is 'failure'
   - `afterActivityInsert(activity)` -- emit `new_activity` event
   - `beforeTicketUpdate(oldTicket, newTicket)` -- if status changed: insert activity, set/clear resolved_at/verified_at
   - `beforeAnyUpdate(table, data)` -- set `updated_at = new Date().toISOString()`
2. Wire triggers into the API router:
   - After POST on `builds` -> call `afterBuildInsert`
   - After POST on `activities` -> call `afterActivityInsert`
   - Before PATCH on `support_tickets` -> call `beforeTicketUpdate`
   - Before any PATCH -> call `beforeAnyUpdate`

**Verification:** Create a ticket via API, change its status. Verify activities are auto-created and timestamps are set.

### Phase 3: Port Agents (3-4 days)

**Goal:** All 6 Edge Functions ported to Node.js modules.

**Tasks:**
1. Port `ingest-jenkins.ts`:
   - Replace Supabase client with direct `db.prepare(...).run(...)` calls
   - Replace `Deno.env.get` with `process.env`
   - Replace `serve()` wrapper with exported `async function run()`
   - Handle SSL/cert issues for internal Jenkins (Node.js `NODE_TLS_REJECT_UNAUTHORIZED` or custom agent)
2. Port `ingest-prow.ts`:
   - Same pattern as Jenkins
   - Prow API is public, no auth changes needed
3. Port `triage.ts`:
   - Replace `crypto.subtle.digest` with Node.js `crypto.createHash`
   - Replace `supabase.rpc("dedup_triage_check")` with direct SQL query (no advisory lock needed)
   - Replace HTTP call to diagnosis with direct function call
4. Port `diagnosis.ts`:
   - Extract known issues patterns to `server/agents/known-issues.ts`
   - Replace Supabase client calls with SQL
5. Port `resolution-tracker.ts`:
   - Replace Supabase client calls with SQL
   - GitHub API calls stay the same (both use `fetch`)
6. Port `notify.ts`:
   - Replace Supabase client calls with SQL
   - Slack webhook call stays the same

**Verification:** Manually trigger each agent function and verify it reads/writes the SQLite database correctly.

### Phase 4: Scheduler (1 day)

**Goal:** Cron jobs running on schedule.

**Tasks:**
1. Build `server/scheduler.ts`:
   - Import node-cron
   - Import all agent modules
   - Register 5 cron jobs with the same schedules as pg_cron
   - Wire `dbEvents` listeners: on `build_failure` -> call triage, on `new_activity` -> call notify
2. Add retention cleanup functions:
   - Nullify `raw_payload` on builds older than 90 days
   - Delete `agent_runs` older than 180 days
   - Nullify `log_text` on build_logs older than 30 days

**Verification:** Start server, wait for cron ticks, verify agent_runs table has new entries.

### Phase 5: Production Packaging (1-2 days)

**Goal:** Single deployable artifact.

**Tasks:**
1. Add `server/package.json` with build and start scripts:
   - `build`: `tsc && cd ../frontend && npm run build`
   - `start`: `node dist/index.js`
   - `dev`: `tsx watch index.ts`
2. Add `server/tsconfig.json` targeting ES2022, CommonJS output
3. Update root `Makefile`:
   - `make dev` -> starts both Vite dev server and Express server
   - `make build` -> builds frontend then backend
   - `make start` -> starts production Express server
4. Update `CLAUDE.md` with new commands and architecture
5. Add `Dockerfile` for containerized deployment:
   ```dockerfile
   FROM node:20-slim
   WORKDIR /app
   COPY server/dist/ ./server/dist/
   COPY server/db/ ./server/db/
   COPY frontend/dist/ ./frontend/dist/
   COPY server/package.json ./server/
   RUN cd server && npm install --production
   ENV PORT=3001
   ENV DB_PATH=/data/capa-ci-tracker.db
   EXPOSE 3001
   CMD ["node", "server/dist/index.js"]
   ```
6. Update `.github/workflows/ci.yml` to build and test the server
7. Update `.github/workflows/deploy.yml` for the new deployment target

### Phase 6: Cleanup (1 day)

**Goal:** Remove Supabase dependencies.

**Tasks:**
1. Delete `supabase/` directory (migrations, functions, config)
2. Remove `supabase` CLI references from Makefile
3. Update `CLAUDE.md` to reflect new architecture
4. Update `docs/backend_design.md`
5. Update `.claude/agents/` agent definitions that reference Supabase

## 8. Risks and Gotchas

### 8.1 SQLite Concurrency

**Risk:** SQLite is single-writer. If the scheduler's cron jobs and incoming API requests compete for writes, SQLite will serialize them. This adds latency under load.

**Mitigation:** With 50-100 builds/day and a 4-6 person team, write contention is minimal. WAL mode allows concurrent reads during writes. better-sqlite3's synchronous API avoids callback queue starvation. If this becomes a problem, batch agent writes into single transactions.

**Concrete scenario:** Two cron jobs fire simultaneously (ingest-jenkins at minute 5, ingest-prow at minute 7 offset). Each does 20 upserts. With WAL mode, reads are unaffected. Writes serialize but each INSERT takes <1ms, so 40 writes complete in <50ms total. No user-visible impact.

### 8.2 Advisory Lock Replacement

**Risk:** The triage agent uses `pg_advisory_xact_lock(hashtext(error_signature))` to serialize concurrent dedup checks. Without this, two concurrent triage calls for the same error signature could create duplicate tickets.

**Mitigation:** SQLite is single-writer, so this is a non-issue. Only one write transaction can execute at a time. The dedup check + insert is inherently serialized. This is actually simpler and more correct than the Postgres approach.

### 8.3 JSONB Query Performance

**Risk:** The frontend doesn't query JSONB fields directly, but the agents do (resolution-tracker scans `test_failures` for error signature matching). SQLite's `json_extract()` is slower than Postgres JSONB operators for large JSON values.

**Mitigation:** The `test_failures` arrays are small (typically 1-10 entries). The resolution-tracker processes at most a few dozen tickets per run. Performance is not a concern at this scale. If needed, extract critical JSONB fields into regular columns.

### 8.4 Embedded Resource Parsing Complexity

**Risk:** The PostgREST embedded resource syntax (`alias:fk_column(col1,col2)`) is used in 2 hooks. Building a general parser is significant work.

**Mitigation:** Only parse the 2 specific patterns used. Hardcode the join logic for `support_tickets -> builds` and `activities -> support_tickets, builds`. The parser does not need to be general-purpose. If new join patterns emerge, add them explicitly.

**Alternative:** Create 2 dedicated API endpoints (`/api/tickets/:id/detail`, `/api/activities/with-context`) that return pre-joined data, and update the 2 hooks to call those endpoints instead. This is ~20 lines of frontend change vs. ~100 lines of parser code.

### 8.5 Missing Postgres Features

**`percentile_cont` in v_pipeline_funnel:** Compute median in the API layer or return NULL.

**`date_trunc` with timezone:** SQLite's `date()` operates on UTC. Since all timestamps are stored as UTC ISO 8601 strings, this is fine. The `v_daily_build_stats` view groups by UTC date, which matches the Postgres behavior (Postgres was also using UTC via `timestamptz`).

**`FILTER (WHERE ...)` clause:** Replace with `SUM(CASE WHEN condition THEN 1 ELSE 0 END)` in every view. Tedious but mechanical.

### 8.6 Data Migration

**Risk:** If there is existing production data in Supabase Postgres that needs to be preserved.

**Mitigation:** Write a one-time export script:
1. `pg_dump --data-only --inserts` from Supabase Postgres
2. Translate INSERT statements for SQLite compatibility (remove `::jsonb` casts, fix array syntax, replace `now()` with ISO strings)
3. Load into SQLite

For this project, the seed data is small (2 builds, 2 tickets) and can be manually translated. If production data exists, the export script is straightforward since the schema is the same -- just different SQL dialect.

### 8.7 File Locking on Network Filesystems

**Risk:** If the SQLite database file is on a network filesystem (NFS, CIFS), file locking may not work correctly, leading to corruption.

**Mitigation:** Store the database on local disk. In the Docker container, mount a local volume at `/data/`. In OpenShift, use a PersistentVolumeClaim with `ReadWriteOnce` access mode.

### 8.8 Backup Strategy

**Risk:** SQLite is a single file. No built-in point-in-time recovery like Postgres.

**Mitigation:**
1. Use the SQLite Online Backup API (`db.backup(destination)`) via better-sqlite3's `.backup()` method
2. Schedule a daily backup via node-cron (e.g., `0 2 * * *` -> backup to `/data/backups/capa-ci-tracker-YYYY-MM-DD.db`)
3. For OpenShift, the PVC can be backed up via Velero or similar

## 9. Effort Estimate

| Phase | Days | Dependency |
|---|---|---|
| Phase 1: Schema + Express skeleton | 3-4 | None |
| Phase 2: Post-write hooks (triggers) | 1-2 | Phase 1 |
| Phase 3: Port agents | 3-4 | Phase 2 |
| Phase 4: Scheduler | 1 | Phase 3 |
| Phase 5: Production packaging | 1-2 | Phase 4 |
| Phase 6: Cleanup | 1 | Phase 5 |
| **Total** | **10-14** | |

The critical path is Phase 1 (PostgREST-compatible query parser). If the embedded resource parsing proves too complex, the alternative dedicated-endpoint approach (8.4) saves 1-2 days but requires minor frontend changes.

## 10. What Does NOT Change

- React 19 + Vite + Tailwind + shadcn/ui frontend
- All React components, pages, and routing
- All frontend hooks (assuming PostgREST protocol parity)
- `PostgRESTFilterBuilder` client in `src/config/supabase.js`
- Auth flow (dev bypass / OCP proxy)
- 30-second polling for live updates
- Slack notification format (Block Kit messages)
- Known-issue regex patterns (12 patterns)
- CI job names and API URLs (Jenkins, Prow, GitHub)
- Error signature computation algorithm
- Ticket lifecycle state machine
