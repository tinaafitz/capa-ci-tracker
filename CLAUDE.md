# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CAPA CI Tracker is an internal tool for the Red Hat CAPA/ROSA HCP team that automatically ingests CI build failures from Jenkins and Prow, triages them into support tickets, diagnoses root causes, tracks resolution through PR merge, and verifies fixes. It replaces manual CI failure triage.

## Commands

```bash
# Frontend (run from frontend/)
npm run dev          # Vite dev server on :5173
npm run build        # Production build
npm run lint         # Oxlint

# Supabase (run from repo root)
supabase start       # Start local Supabase (requires Docker/Podman)
supabase db reset    # Reset DB, re-apply all migrations, re-seed
supabase stop        # Stop local Supabase

# Makefile shortcuts (from repo root)
make dev             # Start frontend dev server
make build           # Production build
make db-reset        # Reset and reseed local DB
make deploy          # Push migrations + deploy all Edge Functions
```

## Architecture

### Frontend (`frontend/`)

React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui (Base UI variant, not Radix).

- **Pages:** `src/pages/` — ActivityPage, TicketsPage, TransactionsPage
- **State:** `src/store/AppContext.jsx` — useReducer + Context. Three contexts: `AppContext` (app state), `AppDispatchContext` (dispatch), `AuthContext` (auth). Use `useAppState()`, `useAppActions()`, `useAuthContext()`.
- **Data hooks:** `src/hooks/useRealtimeTable.js` is the core data hook — fetches from Supabase and subscribes to postgres_changes for live updates. Domain hooks (`useTickets`, `useBuilds`, `useActivities`) wrap it with specific filters. The filter system uses suffixed keys: `_gte`, `_lte`, `_ilike`, `_in`, `_neq`.
- **Auth:** `src/hooks/useAuth.js` — Google OAuth via Supabase Auth. Set `VITE_DEV_BYPASS_AUTH=true` in `.env` to skip login locally. Uses service_role key locally to bypass RLS.
- **Routing:** react-router-dom v7, routes in `App.jsx`, layout in `AppShell`.
- **Path alias:** `@/` resolves to `src/` (configured in vite.config.js).

### Backend (`supabase/`)

Supabase (Postgres 15 + Edge Functions + Realtime + pg_cron).

**Schema** (6 ordered migrations in `migrations/`):
- `builds` — CI build results from Jenkins/Prow
- `support_tickets` — Triage tickets linked to builds via `build_id`
- `activities` — Immutable audit log of all events
- `tasks` — Checklist items on tickets
- `agent_runs` — Observability log for Edge Function executions

**Views:** `v_ticket_summary` (enriched tickets with task counts + TTF), `v_build_failures` (failed builds only), `v_daily_build_stats` (aggregated daily stats). The `useTickets` hook queries `v_ticket_summary` for list views.

**Edge Functions** (Deno/TypeScript in `functions/`) form a sub-agent pipeline:
1. `ingest-jenkins` / `ingest-prow` — Poll CI APIs on pg_cron (every 5min), upsert builds
2. `triage` — Triggered by pg_notify on new failures. Computes error_signature (SHA-256), deduplicates with advisory locks via `dedup_triage_check` RPC, creates tickets
3. `diagnosis` — Pattern-matches error messages against 12 known-issue regexes, sets root_cause/category
4. `resolution-tracker` — Checks GitHub PRs for merge (pg_cron 15min), auto-advances resolved→verified when next build passes
5. `notify` — Sends Slack Block Kit messages on ticket/build events

**RLS:** All tables have RLS enabled. Only `authenticated` role has access. `anon` is denied everything. Edge Functions use `service_role` key.

**Important:** The initial migration includes `GRANT` statements for Supabase roles. If you add new tables, grant access: `GRANT SELECT, INSERT, UPDATE, DELETE ON new_table TO anon, authenticated, service_role;`

### CI/CD (`.github/workflows/`)

- `ci.yml` — Runs on push/PR: frontend lint + build, Supabase migration validation + Deno type-check on Edge Functions
- `deploy.yml` — Runs on push to main after CI passes: deploys migrations then Edge Functions. Requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` secrets.

## Key Conventions

- **shadcn/ui uses Base UI (`@base-ui/react`), not Radix.** Tooltip, Dialog, etc. use the `render` prop pattern for custom elements, NOT `asChild` (which is Radix-only and causes nested-button DOM errors).
- **@tanstack/react-table v9** changed its API. Import `useLegacyTable` and `getCoreRowModel` from `@tanstack/react-table/legacy`, and `flexRender` from `@tanstack/react-table`.
- **Edge Functions** use Deno imports (`https://deno.land/std`, `https://esm.sh/`), not npm. They authenticate with `SUPABASE_SERVICE_ROLE_KEY` env var.
- **Ticket lifecycle:** new → investigating → root_caused → fix_in_progress → resolved → verified. The `record_status_change` trigger auto-sets `resolved_at`/`verified_at` timestamps — don't set them manually in frontend code.
- **Realtime handlers** should call `fetchData()` to re-query with correct filters/joins, not directly mutate local state from the payload (payloads lack joined/computed columns).

## Custom Agents (`.claude/agents/`)

The project has 11 specialized agents. Key ones: `project-manager` (orchestrates ClickUp tasks → subagents → code-review → commit), `code-reviewer`, `backend-supabase-engineer`, `uiux-crm-designer`, `test-engineer`, `status-report` (weekly reports for skip-level leadership).
