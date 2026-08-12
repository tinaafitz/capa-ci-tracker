# CAPA CI Tracker

Automated CI build failure tracking for the CAPA/ROSA HCP team. Ingests failures from Prow and Jenkins, triages them into tickets, diagnoses root causes, tracks resolution through PR merge, and verifies fixes.

![CAPA CI Tracker Demo](docs/demo/demo.gif)

## Features

### Real-time CI failure activity feed
Automated ingestion from Prow and Jenkins with triage events, streak detection, and build status updates.

![Activity Feed](docs/demo/01-activity.png)

### Build history with pass/fail trends
Track build results over time with filtering by job, status, and date range.

![Build History](docs/demo/02-builds.png)

### Auto-triaged tickets on kanban board
CI failures are automatically triaged into tickets with severity classification, error signature deduplication, and root cause diagnosis.

![Tickets Kanban](docs/demo/03-tickets.png)

### Resolution funnel with conversion metrics
Visualize the failure-to-fix lifecycle: ticket created, root cause diagnosed, PR submitted, merged, fix verified. Track conversion rates and time-in-stage.

![Resolution Funnel](docs/demo/04-funnel.png)

### Multi-day failure streak detection
Automatically detects consecutive CI failures, identifies when error signatures change between builds (multiple root causes), and captures relevant log lines from Prow GCS artifacts for developer triage.

![Failure Streaks](docs/demo/05-streaks.png)

## Architecture

```
Browser --> Route --> OAuth Proxy --> nginx (static + /api/ proxy)
                                            |
                                       PostgREST:3000 --> Postgres:5432
                                                               |
                             CronJobs (ingest, streak-analyzer, resolution-tracker, morning-digest)
```

- **Frontend:** React 19 + Vite + TailwindCSS + shadcn/ui
- **API:** PostgREST (auto-exposes all tables, views, and RPCs)
- **Database:** PostgreSQL 16
- **Ingestion:** Node.js CronJobs polling Prow and Jenkins APIs
- **Deployment:** OpenShift with kustomize

## Quick Start

```bash
# Start local Supabase (requires Docker/Podman)
supabase start
supabase db reset

# Start frontend
cd frontend && npm ci && npm run dev

# Ingest Prow builds
cd jobs && npm ci
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres npx tsx ingest.ts --source=prow

# Run streak analyzer
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres npx tsx streak-analyzer.ts
```

## OpenShift Deployment

See [deployment docs](deploy/openshift/README.md) for full OCP deployment with kustomize.

```bash
oc apply -k deploy/openshift/
```
