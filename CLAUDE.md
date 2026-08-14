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

# Server (run from server/)
npm run dev          # Express dev server on :3001 (tsx watch)
npm run build        # TypeScript compile to server/dist/
npm start            # Production start (runs compiled JS)
npm run seed         # Seed the SQLite database with sample data

# Makefile shortcuts (from repo root)
make dev             # Start both frontend and backend dev servers
make build           # Build frontend then server
make start           # Start production server (after build)
make install         # Install all dependencies (frontend + server)
make seed            # Seed the database
make db-reset        # Delete DB files, re-seed from scratch
make lint            # Lint frontend
make deploy          # Build everything (alias for make build)
```

## Architecture

### Frontend (`frontend/`)

React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui (Base UI variant, not Radix).

- **Pages:** `src/pages/` — ActivityPage, TicketsPage, TransactionsPage
- **State:** `src/store/AppContext.jsx` — useReducer + Context. Three contexts: `AppContext` (app state), `AppDispatchContext` (dispatch), `AuthContext` (auth). Use `useAppState()`, `useAppActions()`, `useAuthContext()`.
- **Data hooks:** `src/hooks/useRealtimeTable.js` is the core data hook -- fetches from the Express API using a PostgREST-compatible client and polls every 30 seconds. Domain hooks (`useTickets`, `useBuilds`, `useActivities`) wrap it with specific filters. The filter system uses suffixed keys: `_gte`, `_lte`, `_ilike`, `_in`, `_neq`.
- **Auth:** `src/hooks/useAuth.js` -- returns a static user object. In production (OCP), oauth-proxy handles auth before traffic reaches the app. Set `VITE_DEV_BYPASS_AUTH=true` in `.env` to skip login locally.
- **Routing:** react-router-dom v7, routes in `App.jsx`, layout in `AppShell`.
- **Path alias:** `@/` resolves to `src/` (configured in vite.config.js).

### Backend (`server/`)

Express + SQLite (Node.js 22 built-in `node:sqlite`) + node-cron. Single-process server that handles API, background agents, and static file serving.

**Schema** (`server/db/schema.sql` — applied on startup via `CREATE TABLE/VIEW IF NOT EXISTS`):
- `builds` — CI build results from Jenkins/Prow
- `support_tickets` — Triage tickets linked to builds via `build_id`
- `activities` — Immutable audit log of all events
- `tasks` — Checklist items on tickets
- `agent_runs` — Observability log for agent executions
- `failure_streaks`, `streak_builds`, `build_logs`, `sop_mappings` — Supporting tables

**Views:** `v_ticket_summary`, `v_build_failures`, `v_daily_build_stats`, `v_ticket_lifecycle`, `v_pipeline_funnel`, `v_failure_timeline`. The `useTickets` hook queries `v_ticket_summary` for list views.

**API** (`server/api/`):
- `router.ts` — Express router implementing PostgREST-compatible GET/POST/PATCH/DELETE on all tables and views
- `postgrest-compat.ts` — Query parser translating PostgREST filter syntax (`eq`, `gte`, `in`, `ilike`, etc.) to SQLite SQL
- `rpc.ts` — RPC endpoints (`dedup_triage_check`)

**Agents** (`server/agents/`) — Node.js modules scheduled by node-cron:
1. `ingest-jenkins` / `ingest-prow` — Poll CI APIs (every 5min), upsert builds
2. `triage` — Triggered in-process on new build failures. Computes error_signature (SHA-256), deduplicates, creates tickets
3. `diagnosis` — Pattern-matches error messages against known-issue regexes, sets root_cause/category
4. `resolution-tracker` — Checks GitHub PRs for merge (every 15min), auto-advances resolved to verified
5. `notify` — Sends Slack Block Kit messages on ticket/build events

**Triggers** (`server/triggers.ts`) — In-process EventEmitter hooks that fire after database writes (replaces Postgres triggers). Handles `updated_at` timestamps, status change tracking, and agent dispatch.

**Scheduler** (`server/scheduler.ts`) — node-cron jobs replacing pg_cron. Runs all background agent schedules.

**Important:** SQLite uses WAL mode for concurrent reads. The database file lives at `DB_PATH` (default `./capa-ci-tracker.db`). In production containers, mount a persistent volume at `/data/`.

### CI/CD (`.github/workflows/`)

- `ci.yml` — Runs on push/PR: frontend lint + build, server TypeScript type-check + build + smoke test (starts server, curls `/api/builds`)
- `deploy.yml` — Runs on push to main after CI passes: builds Docker image. Container registry push is commented out until a registry is configured.

## Key Conventions

- **shadcn/ui uses Base UI (`@base-ui/react`), not Radix.** Tooltip, Dialog, etc. use the `render` prop pattern for custom elements, NOT `asChild` (which is Radix-only and causes nested-button DOM errors).
- **@tanstack/react-table v9** changed its API. Import `useLegacyTable` and `getCoreRowModel` from `@tanstack/react-table/legacy`, and `flexRender` from `@tanstack/react-table`.
- **Server agents** are Node.js/TypeScript modules in `server/agents/`. They use built-in `fetch` for external APIs and direct `db` calls (via `node:sqlite`) for database access. Scheduled by node-cron in `server/scheduler.ts`.
- **Ticket lifecycle:** new -> investigating -> root_caused -> fix_in_progress -> resolved -> verified. The `beforeTicketUpdate` trigger hook in `server/triggers.ts` auto-sets `resolved_at`/`verified_at` timestamps -- don't set them manually in frontend code.
- **Polling:** The frontend uses 30-second polling (`setInterval` in `useRealtimeTable.js`). There are no WebSocket subscriptions. Call `fetchData()` to re-query with correct filters/joins rather than mutating local state.

## Custom Agents (`.claude/agents/`)

The project has 12 specialized agents. Key ones: `project-manager` (orchestrates ClickUp tasks → subagents → code-review → commit), `code-reviewer`, `backend-engineer`, `uiux-crm-designer`, `test-engineer`, `status-report` (weekly reports for skip-level leadership).
