---
name: run-app
description: Launch and drive the CAPA CI Tracker app locally — Express+SQLite backend on :3001 and Vite frontend on :5173, then verify pages render with a headless browser. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real UI.
---

# Running CAPA CI Tracker locally

Two long-running dev servers plus a headless-browser smoke check. Backend
serves the API and background agents; frontend is the React UI that talks to it.

## 1. Start the backend (Express + SQLite, port 3001)

Run in the background from `server/`:

```bash
cd server && npm run dev > /tmp/capa-server.log 2>&1
```

Wait ~4s, then confirm it came up cleanly:

```bash
grep -E 'listening on port|cron jobs registered' /tmp/capa-server.log
```

Expect `server listening on port 3001` and `N cron jobs registered`. The
`ExperimentalWarning: SQLite` line is normal (Node 22+ built-in `node:sqlite`).

**DB:** `server/capa-ci-tracker.db` is committed-adjacent and usually already
seeded — do NOT reseed unless it's missing or empty. To reset from scratch:
`make db-reset` (deletes `server/*.db*`, re-seeds). The root `capa-ci-tracker.db`
is a stray empty file; ignore it — the server uses the one in `server/`.

Smoke-test the API before touching the UI:

```bash
curl -s "http://localhost:3001/api/builds?limit=3" | head -c 400; echo
curl -s "http://localhost:3001/api/v_ticket_summary?limit=3" | head -c 400; echo
```

Non-empty JSON arrays = backend is healthy.

## 2. Start the frontend (Vite, port 5173)

```bash
cd frontend && npm run dev > /tmp/capa-frontend.log 2>&1
```

Wait ~4s, confirm `VITE` + `Local: http://localhost:5173/` in
`/tmp/capa-frontend.log`. Auth is bypassed locally via
`frontend/.env` (`VITE_DEV_BYPASS_AUTH=true`) — no login step needed.

## 3. Drive the UI and screenshot (don't just launch it)

Playwright is already a `frontend` dependency, so the driver script must run
with `frontend/` as cwd (module resolution) — copy it in, run, remove:

```bash
cp .claude/skills/run-app/drive.mjs frontend/drive.mjs && \
  (cd frontend && node drive.mjs); rm -f frontend/drive.mjs
```

First run only: `cd frontend && npx --no-install playwright install chromium`.

The script visits `/` (Activity), `/tickets`, `/transactions`, writes
`/tmp/capa-<page>.png`, prints page text, and reports console errors.
**Read the screenshots** — a blank frame means the app didn't actually render
even if the server is up. Expect the sidebar (Activity / Tickets / Builds /
Pipeline), seeded builds, and the auto-created ticket from build #336.

## Teardown

The two `npm run dev` processes stay running in the background across turns.
Leave them up unless asked to stop; to stop, kill the background tasks (or
`pkill -f 'tsx watch index.ts'` and `pkill -f vite`).
