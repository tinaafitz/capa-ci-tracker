# OpenShift Deployment Architecture

Replaces Supabase with self-hosted components on an existing OCP cluster behind VPN.

## Architecture Decisions

**PostgreSQL: Single StatefulSet.** Data is rebuildable from CI APIs. CrunchyData adds operator dependency, HA complexity, and backup infra the team does not need. A single-replica StatefulSet with a PVC is sufficient. If the pod restarts, the PVC survives. If the PVC is lost, re-run ingestion to backfill.

**API layer: PostgREST.** The entire frontend already speaks Supabase REST (which _is_ PostgREST). Every query, filter operator (`eq`, `gte`, `ilike`, `in`), and `select` with embedded joins in `useRealtimeTable.js` works unchanged against raw PostgREST. An Express rewrite would mean reimplementing 6 endpoints that PostgREST gives for free. PostgREST also exposes the views (`v_ticket_summary`, `v_build_failures`, `v_daily_build_stats`) and the `dedup_triage_check` RPC automatically.

**Ingestion: Node.js CronJobs.** The 6 Edge Functions are already TypeScript. Converting from Deno to Node requires only: (1) replace `Deno.env.get()` with `process.env`, (2) replace `import { serve }` with an Express one-shot or direct `main()`, (3) replace Supabase client with `pg` direct queries or keep `@supabase/supabase-js` pointed at PostgREST. The triage/diagnosis chain (triage calls diagnosis via HTTP) works the same -- triage calls the diagnosis CronJob's Service URL. Python rewrite discards working code for no benefit.

**Realtime: Polling.** Without Supabase Realtime, the frontend's `useRealtimeTable` hook needs a 30-second `setInterval` refetch. For 4-6 engineers looking at a dashboard that updates every 5 minutes from CI, polling is indistinguishable from WebSocket push. SSE would require a new server component.

**Auth: OCP OAuth Proxy sidecar.** `oauth-proxy` container in the frontend Deployment. Anyone on VPN with a cluster RBAC identity can access. Supabase RLS is replaced by PostgREST role-based access (single `app_user` role with full CRUD). The `auth.check_redhat_domain()` trigger and all RLS policies are dropped.

## Kubernetes Resources

```
Namespace: capa-ci-tracker
|
|-- StatefulSet/postgres          (1 replica, PVC 20Gi, postgres:16-alpine)
|-- Deployment/postgrest          (2 replicas, postgrest/postgrest:v12)
|-- Deployment/frontend           (2 replicas, nginx:alpine serving Vite build)
|-- CronJob/ingest-jenkins        (*/5 * * * *, node:22-alpine)
|-- CronJob/ingest-prow           (2-59/5 * * * *, node:22-alpine)
|-- CronJob/resolution-tracker    (*/15 * * * *, node:22-alpine)
|-- CronJob/retention-cleanup     (0 3 * * *, node:22-alpine)
|-- Service/postgres              (ClusterIP, port 5432)
|-- Service/postgrest             (ClusterIP, port 3000)
|-- Route/frontend                (edge TLS, oauth-proxy sidecar)
|-- ConfigMap/postgrest-config    (PGRST_DB_SCHEMA, PGRST_DB_ANON_ROLE, etc.)
|-- ConfigMap/app-config          (JENKINS_BASE_URL, PROW_API_URL, job lists)
|-- Secret/db-credentials         (POSTGRES_PASSWORD, PGRST_DB_URI)
|-- Secret/api-tokens             (JENKINS_API_TOKEN, GITHUB_PAT, SLACK_WEBHOOK_URL)
```

## Data Flow

```
CronJob/ingest-jenkins --|
                         |--> postgres:5432 (direct pg connection)
CronJob/ingest-prow ----|
                         |
                         |--> on INSERT with status='failure':
                         |    trigger fires pg_notify('build_failure')
                         |    (but no listener -- triage runs inline)
                         |
CronJob/resolution-tracker --> postgres:5432

Browser --> Route/frontend --> oauth-proxy --> nginx (static files)
                                   |
                                   +--> PostgREST:3000 (API proxy via nginx)
```

**Key change from Supabase model:** The pg_notify trigger-driven pipeline (ingest -> triage -> diagnosis -> notify) was designed for Edge Functions listening on channels. On OCP, the triage and diagnosis logic runs _inline_ within the ingestion CronJobs instead. After upserting a failed build, `ingest-jenkins` and `ingest-prow` call `triageBuild()` and `diagnoseFailures()` directly as imported functions, then call `sendSlackNotification()`. This eliminates the need for pg_notify listeners and inter-function HTTP calls. The notify function also runs inline after triage/diagnosis complete. The `pg_notify` triggers in migration 002 remain harmless but unused.

## Code Changes Required

### Frontend (3 files)

**`src/config/supabase.js`** -- Replace Supabase client with a thin REST wrapper:

```js
const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function query(table, { select, filters, order, limit, offset, count } = {}) {
  const params = new URLSearchParams()
  if (select) params.set('select', select)
  if (order) params.set('order', `${order.column}.${order.ascending ? 'asc' : 'desc'}`)
  if (limit) {
    const start = offset || 0
    // Range header for PostgREST pagination
  }
  // Build filter params from the same filter object shape useRealtimeTable uses
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === null || value === undefined || value === 'all' || value === '') continue
    if (key.endsWith('_gte')) params.append(key.replace('_gte', ''), `gte.${value}`)
    else if (key.endsWith('_lte')) params.append(key.replace('_lte', ''), `lte.${value}`)
    else if (key.endsWith('_ilike')) params.append(key.replace('_ilike', ''), `ilike.*${value}*`)
    else if (key.endsWith('_in')) params.append(key.replace('_in', ''), `in.(${value.join(',')})`)
    else if (key.endsWith('_neq')) params.append(key.replace('_neq', ''), `neq.${value}`)
    else params.append(key, `eq.${value}`)
  }

  const headers = { 'Accept': 'application/json', 'Prefer': count ? 'count=exact' : '' }
  if (limit) headers['Range'] = `${offset || 0}-${(offset || 0) + limit - 1}`
  const res = await fetch(`${API_URL}/${table}?${params}`, { headers })
  const data = await res.json()
  const total = res.headers.get('Content-Range')?.split('/')?.pop()
  return { data, count: total ? parseInt(total) : data.length, error: res.ok ? null : data }
}

export async function insert(table, row) {
  return fetch(`${API_URL}/${table}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  }).then(r => r.json())
}

export async function update(table, filters, row) {
  const params = Object.entries(filters).map(([k,v]) => `${k}=eq.${v}`).join('&')
  return fetch(`${API_URL}/${table}?${params}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  }).then(r => r.json())
}

export async function rpc(fn, args) {
  return fetch(`${API_URL}/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  }).then(r => r.json())
}
```

**`src/hooks/useRealtimeTable.js`** -- Replace Supabase realtime with polling:

- Remove `supabase.channel()` subscription
- Add `setInterval(fetchData, 30000)` with cleanup
- Replace `supabase.from(table).select()` with `query(table, ...)`

**`src/hooks/useAuth.js`** -- Remove Supabase OAuth entirely. On OCP, the oauth-proxy handles auth before traffic reaches nginx. The hook returns a static authenticated state:

```js
export function useAuth() {
  return { user: { email: 'authenticated-via-ocp' }, session: {}, loading: false, signIn: () => {}, signOut: () => {} }
}
```

### Ingestion CronJobs (consolidate 6 functions into 2 scripts)

**`jobs/ingest.ts`** -- Single entry point. Contains `ingestJenkins()`, `ingestProw()`, `triageBuild()`, `diagnoseFailures()`, `sendSlackNotification()` as imported modules. Runs as: `node --import tsx jobs/ingest.ts --source=jenkins|prow`.

Changes from Edge Function versions:
- `Deno.env.get()` -> `process.env`
- `serve()` wrapper removed; replaced with `async function main()`
- Supabase client replaced with `pg` Pool for direct Postgres queries (no PostgREST hop for writes)
- Triage calls diagnosis synchronously instead of via HTTP `fetch()`
- Notify calls Slack webhook directly at end of pipeline

**`jobs/resolution-tracker.ts`** -- Standalone. Same logic, same env var swap. Runs every 15 minutes.

**`jobs/retention-cleanup.ts`** -- Simple SQL runner. `UPDATE builds SET raw_payload = NULL WHERE ...` and `DELETE FROM agent_runs WHERE ...`. Runs daily.

### SQL Migrations (subtract, do not add)

Apply migrations 001-003 and 007 as-is. Modifications:

- **Drop migration 004 (RLS).** PostgREST uses a single `app_user` role; no RLS needed.
- **Drop migration 005 (pg_cron).** Scheduling moves to OCP CronJobs.
- **Drop migration 006 (retention cron).** Retention moves to OCP CronJob.
- **Drop the `auth.check_redhat_domain()` block** from migration 001. No auth schema on plain Postgres.
- **Drop the `GRANT ... TO anon, authenticated, service_role`** from migration 001. Replace with grants to `app_user` and `postgrest_anon` roles.

New init SQL added to the Postgres StatefulSet entrypoint:

```sql
CREATE ROLE postgrest_anon NOLOGIN;
CREATE ROLE app_user NOLOGIN;
GRANT app_user TO postgrest_anon;
GRANT USAGE ON SCHEMA public TO postgrest_anon, app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
```

## nginx Configuration (frontend)

```nginx
server {
  listen 8080;

  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://postgrest:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

This gives the frontend a `/api/builds`, `/api/support_tickets`, `/api/v_ticket_summary`, `/api/rpc/dedup_triage_check` that maps directly to PostgREST.

## PostgREST Configuration

```
PGRST_DB_URI=postgresql://app_user:${DB_PASSWORD}@postgres:5432/capa_ci_tracker
PGRST_DB_SCHEMA=public
PGRST_DB_ANON_ROLE=postgrest_anon
PGRST_DB_MAX_ROWS=1000
PGRST_OPENAPI_SERVER_PROXY_URI=https://capa-ci-tracker.apps.cluster.example.com/api
```

## Migration Strategy (Local Supabase to OCP)

1. `oc new-project capa-ci-tracker`
2. Apply Secrets and ConfigMaps
3. Deploy StatefulSet/postgres, wait for ready
4. Run migrations 001, 002, 003, 007 via `oc exec` or init container
5. Run role-setup SQL (postgrest_anon, app_user)
6. Deploy Deployment/postgrest, verify with `curl postgrest:3000/builds`
7. Build and push frontend image (`podman build`), deploy Deployment/frontend + Route
8. Build and push jobs image, deploy CronJobs
9. Verify first CronJob run: `oc logs job/ingest-jenkins-<hash>`

Total: ~4 hours for someone familiar with OCP. The database starts empty and backfills from the next CronJob cycle.

## Container Images

| Image | Base | Build |
|---|---|---|
| frontend | `nginx:1.27-alpine` | Multi-stage: `node:22-alpine` for `npm run build`, copy `dist/` + `nginx.conf` |
| jobs | `node:22-alpine` | `npm install` + copy TS source, `CMD ["node", "--import", "tsx", "jobs/ingest.ts"]` |
| postgres | `postgres:16-alpine` | Stock image, init SQL via ConfigMap mounted to `/docker-entrypoint-initdb.d/` |
| postgrest | `postgrest/postgrest:v12.2.3` | Stock image, configured via env vars |

## What This Does NOT Change

- The 5-table data model (builds, support_tickets, activities, tasks, agent_runs) and sop_mappings
- The 3 views (v_ticket_summary, v_build_failures, v_daily_build_stats)
- The trigger functions (set_updated_at, record_status_change, dedup_triage_check)
- The known_issues pattern matching logic
- The error_signature normalization algorithm
- The Slack Block Kit message format
- The GitHub PR status checking logic
