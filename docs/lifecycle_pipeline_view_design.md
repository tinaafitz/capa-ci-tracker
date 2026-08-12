# Lifecycle Pipeline View -- Technical Design

## Overview

The Lifecycle Pipeline View adds a fourth navigation tab ("Pipeline") that visualizes the full failure-fix lifecycle across two levels:

1. **Funnel overview** -- aggregate counts showing how many tickets are at each pipeline stage, with conversion rates and timing metrics
2. **Per-ticket stepper** -- a horizontal flow widget (reusable in TicketDetail) showing exactly where a specific ticket is in the 6-stage pipeline, with timestamps and links at each stage

### Pipeline Stages (not the same as ticket statuses)

The pipeline has 6 stages that map onto -- but are not identical to -- the existing ticket lifecycle statuses:

| Pipeline Stage | Data Source | Ticket Status Gate |
|---|---|---|
| 1. Build Failed | `builds.status = 'failure'` | (pre-ticket) |
| 2. Ticket Created | `support_tickets.created_at` | `new` or later |
| 3. Root Cause Diagnosed | `root_cause IS NOT NULL` | `root_caused` or later |
| 4. PR Submitted | `fix_pr_url IS NOT NULL` | `fix_in_progress` or later |
| 5. PR Merged | `pr_merged_at IS NOT NULL` | `resolved` or later |
| 6. Fix Verified | `verified_at IS NOT NULL` | `verified` |

Key distinction: ticket statuses are a state machine (one value at a time). Pipeline stages are **cumulative milestones** -- a ticket in `verified` status has passed through all 6 stages. The view needs timestamps for when each milestone was reached, which the current schema partially provides.

---

## 1. Data Model Changes

### 1a. New Column: `pr_merged_at` on `support_tickets`

**Problem:** The resolution-tracker Edge Function detects PR merges and advances status to `resolved`, but it does not record *when* the PR was merged. The `resolved_at` timestamp is set by the `record_status_change` trigger when status transitions, which is close but not the same -- `resolved_at` reflects when the *system processed* the merge, not when the merge happened on GitHub. For the pipeline view, we need the actual GitHub merge timestamp.

**Solution:** Add one nullable column:

```sql
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS pr_merged_at TIMESTAMPTZ;
```

The resolution-tracker Edge Function already has `pr.merged_at` from the GitHub API response. The change is a one-line addition to the existing UPDATE call.

**Why not derive it?** We could scan `activities` for `fix_merged` events and extract `metadata->>'merged_at'`, but that requires a join or subquery on every view render. A denormalized column on the ticket is simpler and matches the existing pattern (`resolved_at`, `verified_at`).

### 1b. New Column: `diagnosed_at` on `support_tickets`

**Problem:** The diagnosis agent sets `root_cause` and `root_cause_category`, but there is no timestamp recording when the diagnosis was completed. We currently have to scan `activities` for `diagnosis_completed` events to find this timestamp.

**Solution:** Add one nullable column:

```sql
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS diagnosed_at TIMESTAMPTZ;
```

This is set by the diagnosis Edge Function when it writes `root_cause`. For manually-entered root causes via the frontend, the `handleSaveRootCause` callback in TicketDetail.jsx should also set `diagnosed_at: new Date().toISOString()`.

### 1c. No New Tables Required

Everything else needed for the pipeline view already exists:

- **Build failure timestamp:** `builds.finished_at` (when the build completed as a failure)
- **Ticket creation:** `support_tickets.created_at`
- **PR submitted:** `support_tickets.fix_pr_url` (presence = submitted), inferred from `activities` where `activity_type = 'fix_submitted'`
- **Verification:** `support_tickets.verified_at` and `verified_in_build_id`

### 1d. Migration File

New migration: `20260810000008_lifecycle_pipeline.sql`

```sql
-- Migration: Lifecycle Pipeline View
-- Adds timestamp columns for pipeline stage tracking
-- and the v_ticket_lifecycle view for the Pipeline page.

-- ============================================================
-- Add milestone timestamp columns to support_tickets
-- ============================================================

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS diagnosed_at  TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS pr_merged_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_diagnosed_at
  ON support_tickets (diagnosed_at) WHERE diagnosed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_pr_merged_at
  ON support_tickets (pr_merged_at) WHERE pr_merged_at IS NOT NULL;

-- ============================================================
-- v_ticket_lifecycle
-- Exposes pipeline stage, timestamps, and durations for each
-- ticket. Used by both the per-ticket stepper and the overview
-- funnel aggregation.
-- ============================================================

CREATE OR REPLACE VIEW v_ticket_lifecycle AS
SELECT
  t.id,
  t.ticket_number,
  t.title,
  t.status,
  t.severity,
  t.assignee,

  -- Pipeline stage (ordinal 1-6 for sorting and funnel display)
  CASE
    WHEN t.verified_at     IS NOT NULL THEN 6
    WHEN t.pr_merged_at    IS NOT NULL THEN 5
    WHEN t.fix_pr_url      IS NOT NULL THEN 4
    WHEN t.diagnosed_at    IS NOT NULL THEN 3
    WHEN t.id              IS NOT NULL THEN 2  -- ticket exists = created
    ELSE 1                                      -- should not happen for tickets
  END AS pipeline_stage,

  CASE
    WHEN t.verified_at     IS NOT NULL THEN 'fix_verified'
    WHEN t.pr_merged_at    IS NOT NULL THEN 'pr_merged'
    WHEN t.fix_pr_url      IS NOT NULL THEN 'pr_submitted'
    WHEN t.diagnosed_at    IS NOT NULL THEN 'root_cause_diagnosed'
    WHEN t.id              IS NOT NULL THEN 'ticket_created'
    ELSE 'build_failed'
  END AS pipeline_stage_name,

  -- Stage timestamps (all nullable)
  b.finished_at            AS build_failed_at,
  t.created_at             AS ticket_created_at,
  t.diagnosed_at           AS diagnosed_at,
  -- For pr_submitted_at, use the fix_submitted activity timestamp
  -- or fall back to updated_at when fix_pr_url was set.
  -- Using a subquery to get the exact activity timestamp:
  (SELECT MIN(a.created_at)
   FROM activities a
   WHERE a.ticket_id = t.id
     AND a.activity_type = 'fix_submitted'
  )                        AS pr_submitted_at,
  t.pr_merged_at           AS pr_merged_at,
  t.verified_at            AS verified_at,

  -- Originating build info (for "Build Failed" stage link)
  t.build_id,
  b.job_name               AS build_job_name,
  b.job_url                AS build_job_url,
  b.source                 AS build_source,
  b.external_id            AS build_external_id,

  -- Fix PR info (for "PR Submitted" / "PR Merged" stage links)
  t.fix_pr_url,
  t.fix_pr_number,

  -- Verification build info (for "Fix Verified" stage link)
  t.verified_in_build_id,
  vb.job_name              AS verify_build_job_name,
  vb.job_url               AS verify_build_job_url,
  vb.external_id           AS verify_build_external_id,

  -- Duration metrics (seconds, NULL when stages not reached)
  EXTRACT(EPOCH FROM (t.created_at    - b.finished_at))::int   AS build_to_ticket_seconds,
  EXTRACT(EPOCH FROM (t.diagnosed_at  - t.created_at))::int    AS ticket_to_diagnosis_seconds,
  EXTRACT(EPOCH FROM (t.pr_merged_at  - t.diagnosed_at))::int  AS diagnosis_to_merge_seconds,
  EXTRACT(EPOCH FROM (t.verified_at   - t.pr_merged_at))::int  AS merge_to_verify_seconds,
  EXTRACT(EPOCH FROM (t.verified_at   - b.finished_at))::int   AS total_lifecycle_seconds,
  -- Time-to-resolve (same as v_ticket_summary for consistency)
  EXTRACT(EPOCH FROM (t.resolved_at   - t.created_at))::int    AS ttf_seconds

FROM support_tickets t
LEFT JOIN builds b  ON t.build_id = b.id
LEFT JOIN builds vb ON t.verified_in_build_id = vb.id;

-- ============================================================
-- v_pipeline_funnel
-- Pre-aggregated funnel counts by pipeline stage.
-- Designed for the overview funnel chart -- single query,
-- no client-side aggregation needed.
-- ============================================================

CREATE OR REPLACE VIEW v_pipeline_funnel AS
SELECT
  stage.name                                        AS stage_name,
  stage.ordinal                                     AS stage_ordinal,
  count(t.id)                                       AS ticket_count,
  count(t.id) FILTER (WHERE t.severity = 'nightly_blocker')   AS nightly_blocker_count,
  count(t.id) FILTER (WHERE t.severity = 'upstream_breakage') AS upstream_breakage_count,
  count(t.id) FILTER (WHERE t.severity = 'infrastructure')   AS infrastructure_count,
  count(t.id) FILTER (WHERE t.severity = 'test_regression')   AS test_regression_count,
  count(t.id) FILTER (WHERE t.severity = 'flaky')             AS flaky_count,
  -- Median time spent at this stage (across all tickets that have passed through it)
  percentile_cont(0.5) WITHIN GROUP (ORDER BY
    CASE stage.ordinal
      WHEN 2 THEN EXTRACT(EPOCH FROM (t.created_at   - COALESCE(b.finished_at, t.created_at)))
      WHEN 3 THEN EXTRACT(EPOCH FROM (t.diagnosed_at - t.created_at))
      WHEN 4 THEN EXTRACT(EPOCH FROM (COALESCE(t.pr_merged_at, now()) - t.diagnosed_at))
      WHEN 5 THEN EXTRACT(EPOCH FROM (t.pr_merged_at - t.diagnosed_at))
      WHEN 6 THEN EXTRACT(EPOCH FROM (t.verified_at  - t.pr_merged_at))
      ELSE NULL
    END
  )::int                                            AS median_stage_duration_seconds
FROM (
  VALUES
    ('ticket_created',        2),
    ('root_cause_diagnosed',  3),
    ('pr_submitted',          4),
    ('pr_merged',             5),
    ('fix_verified',          6)
) AS stage(name, ordinal)
LEFT JOIN support_tickets t ON
  CASE stage.ordinal
    WHEN 2 THEN TRUE                              -- all tickets have been "created"
    WHEN 3 THEN t.diagnosed_at  IS NOT NULL
    WHEN 4 THEN t.fix_pr_url    IS NOT NULL
    WHEN 5 THEN t.pr_merged_at  IS NOT NULL
    WHEN 6 THEN t.verified_at   IS NOT NULL
  END
LEFT JOIN builds b ON t.build_id = b.id
GROUP BY stage.name, stage.ordinal
ORDER BY stage.ordinal;

-- ============================================================
-- Grant access (matches existing pattern)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
```

### 1e. Edge Function Changes

**resolution-tracker/index.ts** -- Two changes:

1. When advancing `fix_in_progress` to `resolved`, also set `pr_merged_at`:

```typescript
// Current:
.update({ status: "resolved" })

// New:
.update({ status: "resolved", pr_merged_at: pr.merged_at })
```

2. No other Edge Function changes needed. The diagnosis function should set `diagnosed_at: new Date().toISOString()` alongside `root_cause` in its UPDATE call.

### 1f. Seed Data Updates

Add `diagnosed_at` and `pr_merged_at` to the two seed tickets:

```sql
-- CAPA-1: diagnosed 1 min after ticket created, PR merged would be set by resolution-tracker
UPDATE support_tickets
SET diagnosed_at = '2026-08-09T09:01:00Z'
WHERE id = 'b0000001-0000-0000-0000-000000000001';

-- CAPA-4: diagnosed 1 min after ticket created, no PR yet
UPDATE support_tickets
SET diagnosed_at = '2026-08-10T01:31:00Z'
WHERE id = 'b0000001-0000-0000-0000-000000000004';
```

---

## 2. Frontend Architecture

### 2a. New Hook: `useLifecycleData.js`

```
src/hooks/useLifecycleData.js
```

Two exported hooks:

**`useLifecyclePipeline(filterOptions)`** -- Fetches from `v_ticket_lifecycle` view with realtime subscription on `support_tickets`. Used by the Pipeline page ticket list and the per-ticket stepper.

```javascript
import { useRealtimeTable } from './useRealtimeTable'

export function useLifecyclePipeline(filterOptions = {}) {
  const { severity, dateRange, stageFilter } = filterOptions

  const filters = useMemo(() => {
    const f = {}
    if (severity && severity !== 'all') f.severity = severity
    if (stageFilter && stageFilter !== 'all') f.pipeline_stage = stageFilter
    if (dateRange) f.ticket_created_at_gte = computeDateBound(dateRange)
    return f
  }, [severity, dateRange, stageFilter])

  return useRealtimeTable('v_ticket_lifecycle', {
    filters,
    orderBy: 'ticket_created_at',
    ascending: false,
    limit: 200,
    realtime: true,
    realtimeTable: 'support_tickets',
  })
}
```

**`usePipelineFunnel()`** -- Fetches from `v_pipeline_funnel` view. This is a small, infrequently changing dataset (5 rows). Uses realtime on `support_tickets` to refresh when any ticket status changes.

```javascript
export function usePipelineFunnel() {
  return useRealtimeTable('v_pipeline_funnel', {
    orderBy: 'stage_ordinal',
    ascending: true,
    limit: 10,
    realtime: true,
    realtimeTable: 'support_tickets',
  })
}
```

### 2b. New Page: `PipelinePage.jsx`

```
src/pages/PipelinePage.jsx
```

Route: `/pipeline` (added to App.jsx)

The page has two sections stacked vertically:

1. **Pipeline Funnel** (top) -- horizontal funnel/bar visualization
2. **Pipeline Ticket List** (bottom) -- table of tickets with pipeline stage columns

```
+------+-----------------------------------------------------------+
| [A]  | Pipeline                                                  |
| [T]  |----------------------------------------------------------|
| [B]  | Filters: [Severity: All v] [Last 30 days v]              |
| [P*] |----------------------------------------------------------|
|      |                                                           |
|      | PIPELINE FUNNEL                                           |
|      |                                                           |
|      | Ticket    Root Cause    PR          PR        Fix          |
|      | Created   Diagnosed    Submitted   Merged    Verified     |
|      | +------+  +------+    +------+    +------+  +------+     |
|      | |      |  |      |    |      |    |      |  |      |     |
|      | |  23  |  |  19  |    |  14  |    |  11  |  |   8  |     |
|      | |      |  |      |    |      |    |      |  |      |     |
|      | +------+  +------+    +------+    +------+  +------+     |
|      |   100%     82.6%       60.9%       47.8%     34.8%       |
|      |   --       ~2.1h       ~6.4h       ~18h      ~4.2h       |
|      |                                                           |
|      |----------------------------------------------------------|
|      |                                                           |
|      | TICKETS BY STAGE                                          |
|      |                                                           |
|      | Ticket   | Title              | Stage        | Duration  |
|      |----------|--------------------|--------------| ----------|
|      | CAPA-1   | CAPI v1beta2       | PR Submitted | 6h        |
|      |          |                    | ****[====    |           |
|      | CAPA-4   | ROSAControlPlane   | Diagnosed    | 34h       |
|      |          |                    | **[========= |           |
|      |----------|--------------------|--------------| ----------|
|      |                                                           |
|      | Showing 2 of 23 tickets         [< 1 2 3 >]              |
|      |                                                           |
+------+-----------------------------------------------------------+
```

### 2c. Component Hierarchy

```
PipelinePage
  PipelineFunnel                    -- overview funnel visualization
    FunnelStageBar (x5)             -- individual stage bar with count + percentage
  PipelineTicketList                -- table of tickets with inline stepper
    PipelineTicketRow (xN)          -- single ticket row with mini stepper
      TicketPipelineStepper         -- reusable 6-stage horizontal stepper
  TicketDetail                      -- existing component, opened on row click
```

### 2d. Component: `TicketPipelineStepper`

```
src/components/tickets/TicketPipelineStepper.jsx
```

This is the core reusable widget. It renders a horizontal 6-stage flow with:
- Stage dots connected by lines
- Completed stages filled, current stage pulsing, future stages hollow
- Timestamps below each completed stage
- External links (build URL, PR URL, verify build URL) on relevant stages
- Click handler to navigate to the linked resource

It replaces the existing status pipeline in TicketDetail.jsx (lines 282-329) which is currently a simpler stepper based on ticket statuses only.

**Props:**

```typescript
interface TicketPipelineStepperProps {
  // Stage timestamps (all nullable)
  buildFailedAt: string | null
  ticketCreatedAt: string | null
  diagnosedAt: string | null
  prSubmittedAt: string | null
  prMergedAt: string | null
  verifiedAt: string | null

  // External links
  buildJobUrl: string | null
  buildExternalId: string | null
  buildSource: string | null
  fixPrUrl: string | null
  fixPrNumber: number | null
  verifyBuildJobUrl: string | null
  verifyBuildExternalId: string | null

  // Display mode
  compact?: boolean    // true for table rows, false for detail view
}
```

**Rendering logic:**

```
Stage 1     Stage 2       Stage 3       Stage 4       Stage 5       Stage 6
Build       Ticket        Root Cause    PR            PR            Fix
Failed      Created       Diagnosed     Submitted     Merged        Verified
 (*)----------(*)----------(*)----------( )----------( )----------( )
 8:35 AM     9:00 AM      9:01 AM
 [Jenkins]                              [Link PR]
```

- `(*)` = completed stage (filled circle)
- `( )` = future stage (hollow circle)
- The current/active stage gets a ring/pulse treatment
- Lines between completed stages are solid; lines to future stages are dashed
- Each completed stage shows a relative timestamp below
- Stages 1, 4, 5, 6 show clickable external links when available

**Compact mode** (for table rows): Renders as a thin horizontal bar with colored segments and no labels. Hover shows a tooltip with full stage details.

### 2e. Component: `PipelineFunnel`

```
src/components/pipeline/PipelineFunnel.jsx
```

A horizontal bar chart showing 5 bars (stages 2-6, since all tickets have passed stage 1 by definition). Each bar shows:

- Stage name (label above)
- Count (large number inside bar)
- Percentage of total (below bar)
- Median duration at this stage (small text below percentage)
- Color coding by severity breakdown (stacked segments within bar)

Uses the existing `Card` component for the container. No external charting library needed -- pure CSS/Tailwind bars are sufficient for 5 fixed categories. This avoids adding Recharts as a dependency for a simple visualization.

If the team later wants animated transitions or more sophisticated charts, Recharts can be added, but for 5 bars with known values, HTML/CSS is simpler and faster to render.

### 2f. Component: `PipelineTicketList`

```
src/components/pipeline/PipelineTicketList.jsx
```

A table built with the same patterns as TicketList.jsx (sortable columns via @tanstack/react-table), displaying:

| Column | Source | Notes |
|---|---|---|
| Ticket | `ticket_number` | Clickable, opens TicketDetail |
| Title | `title` | 2-line clamp |
| Severity | `severity` | SeverityBadge component |
| Current Stage | `pipeline_stage_name` | Badge with stage-specific color |
| Pipeline | (computed) | Compact TicketPipelineStepper |
| Total Duration | `total_lifecycle_seconds` | Formatted as "Xh Ym" or "Xd" |
| Assignee | `assignee` | Truncated email |

Clicking a row opens the existing TicketDetail sheet, which now includes the full TicketPipelineStepper (replacing the current status stepper).

### 2g. Integration with TicketDetail

The existing `TicketDetail.jsx` has a "Status Pipeline" section (lines 281-329) that renders ticket statuses as a horizontal stepper. This section is replaced with the `TicketPipelineStepper` component, which provides richer information:

Before:
```
[New] -> [Investigating] -> [Root Caused] -> [Fix In Progress] -> [Resolved] -> [Verified]
```

After:
```
Build Failed -> Ticket Created -> Root Cause Diagnosed -> PR Submitted -> PR Merged -> Fix Verified
 8:35 AM        9:00 AM           9:01 AM                3:00 PM
 Jenkins #348                                            PR #127
```

The "Advance to..." button remains below the stepper. The existing `handleAdvanceStatus` callback continues to work unchanged.

To populate the stepper, `useTicketDetail` needs to be updated to also fetch `diagnosed_at` and `pr_merged_at` from `support_tickets`, and the originating build's `finished_at` and `job_url`. The current `select` string in `useTicketDetail` already fetches the build via a join -- we just need to ensure the new columns are included.

Updated select in `useTicketDetail`:

```javascript
select: '*, builds:build_id(id, external_id, job_name, job_url, status, test_failures, pass_count, fail_count, skip_count, ocp_version, started_at, finished_at), verify_build:verified_in_build_id(id, external_id, job_name, job_url)'
```

### 2h. Navigation Changes

**Sidebar.jsx** -- Add a fourth nav item:

```javascript
{
  to: '/pipeline',
  label: 'Pipeline',
  shortcut: '4',
  icon: (/* horizontal pipeline/flow icon SVG */),
  countKey: 'activeTickets',  // tickets not yet verified
}
```

**App.jsx** -- Add route:

```jsx
<Route path="/pipeline" element={<PipelinePage />} />
```

**useSidebarCounts.js** -- Add `activeTickets` count (tickets with status not in `resolved`, `verified`):

```javascript
const activeResult = await supabase
  .from('support_tickets')
  .select('id', { count: 'exact', head: true })
  .not('status', 'in', '("resolved","verified")')
```

---

## 3. Realtime Considerations

### What triggers updates?

| Event | Source | Tables Changed | Pipeline Effect |
|---|---|---|---|
| New build failure | ingest-jenkins/prow | `builds` INSERT | No pipeline change (pre-ticket) |
| Triage creates ticket | triage Edge Function | `support_tickets` INSERT, `activities` INSERT | Stage 1->2 |
| Diagnosis completes | diagnosis Edge Function | `support_tickets` UPDATE (root_cause, diagnosed_at) | Stage 2->3 |
| User links PR | Frontend (TicketDetail) | `support_tickets` UPDATE (fix_pr_url) | Stage 3->4 |
| PR merge detected | resolution-tracker | `support_tickets` UPDATE (status, pr_merged_at) | Stage 4->5 |
| Fix verified | resolution-tracker | `support_tickets` UPDATE (status, verified_at, verified_in_build_id) | Stage 5->6 |

### Subscription strategy

All pipeline stage transitions flow through `support_tickets` UPDATE events. A single Realtime subscription on `support_tickets` (which `useRealtimeTable` already provides when `realtimeTable: 'support_tickets'` is set) handles all updates.

The existing pattern of "refetch on any change" (used throughout the codebase in `useRealtimeTable.js`) works well here. The `v_ticket_lifecycle` view is a simple JOIN -- re-querying it on each ticket update is cheap (< 50ms for 100 tickets with the existing indexes).

The `v_pipeline_funnel` view is an aggregation that gets re-queried when any ticket changes. With 10-30 tickets/week volume, this is a 5-row result set over a few hundred tickets -- negligible cost.

### Debouncing concern

When the resolution-tracker runs, it may update multiple tickets in rapid succession (e.g., 3 PRs merged since last check). Each UPDATE fires a Realtime event, causing 3 rapid refetches. The existing `useRealtimeTable` does not debounce. For the Pipeline page this is acceptable -- 3 quick refetches of a 5-row aggregation is not noticeable. If it becomes a problem later, add a 500ms debounce to `fetchData` in `useRealtimeTable`.

---

## 4. Risks and Trade-offs

### Risk 1: `pr_submitted_at` requires scanning `activities`

The `v_ticket_lifecycle` view uses a subquery to find the `fix_submitted` activity timestamp. This is an N+1-style pattern -- for each ticket, we scan the activities table. Mitigation: the `idx_activities_ticket_id` partial index already exists, so the subquery is an index scan. For 100 tickets, this adds ~10ms total. If it becomes a bottleneck, denormalize `pr_submitted_at` onto `support_tickets` (same pattern as `diagnosed_at` and `pr_merged_at`).

**Decision: Accept the subquery for now.** The volume is low and the index covers it. If we add `pr_submitted_at` as a column later, it is a backward-compatible migration.

### Risk 2: Pipeline stages diverge from ticket status

A ticket can have `diagnosed_at` set but status still at `investigating` (if the user set root_cause but did not advance status). The pipeline stage would show "Root Cause Diagnosed" while the ticket status badge shows "Investigating." This is not a bug -- the pipeline shows milestone completion, not workflow state -- but it could confuse users.

**Mitigation:** The TicketPipelineStepper shows both the pipeline stage progress and the current ticket status badge, making the distinction visible. The label "Current stage" (pipeline) vs "Current status" (workflow) disambiguates.

### Risk 3: Builds without tickets don't appear in the pipeline

Failed builds that have not been triaged into tickets are invisible to the pipeline view. This is by design -- the pipeline tracks the fix lifecycle, which starts at ticket creation. The Builds page already shows untriaged failures. However, the funnel overview should show "Untriaged Builds" as a pre-funnel count to highlight the gap.

**Solution:** The `PipelineFunnel` component fetches a separate count of builds with `status = 'failure'` that have no linked ticket (using the existing `v_build_failures.has_ticket = false` view). This is displayed as a "stage 0" entry before the funnel.

### Risk 4: Existing TicketDetail status stepper replacement

Replacing the status pipeline in TicketDetail with the new TicketPipelineStepper changes a user-facing component. The existing stepper shows 6 statuses with "Advance" button. The new stepper shows 6 pipeline stages with timestamps and links.

**Mitigation:** The "Advance to..." button is preserved below the new stepper. The status transitions remain unchanged -- only the visual representation changes. The new stepper is strictly more informative.

### Risk 5: v_pipeline_funnel uses `percentile_cont` which requires `ORDER BY`

The `percentile_cont` aggregate for median duration works on PostgreSQL 15+ (which Supabase uses). It is an ordered-set aggregate and cannot be indexed. For the current volume (< 500 tickets), this is a sub-100ms query. At 5000+ tickets, consider materializing the funnel as a materialized view refreshed by pg_cron.

---

## 5. Implementation Plan

### Phase 1: Schema (backend-supabase-engineer)

1. Create migration `20260810000008_lifecycle_pipeline.sql` with:
   - `diagnosed_at` and `pr_merged_at` columns on `support_tickets`
   - `v_ticket_lifecycle` view
   - `v_pipeline_funnel` view
   - Indexes on new columns
2. Update seed data to populate `diagnosed_at` for existing seed tickets
3. Run `supabase db reset` to validate

**Dependency:** None. Can be done first.

### Phase 2: Edge Function updates (backend-supabase-engineer)

1. Update `resolution-tracker/index.ts` to set `pr_merged_at: pr.merged_at` in the UPDATE call
2. Update `diagnosis/index.ts` to set `diagnosed_at: new Date().toISOString()` alongside root_cause
3. Test both functions with `supabase functions serve`

**Dependency:** Phase 1 (schema must exist).

### Phase 3: Frontend hooks (uiux-crm-designer or backend-supabase-engineer)

1. Create `src/hooks/useLifecycleData.js` with `useLifecyclePipeline` and `usePipelineFunnel`
2. Update `useTicketDetail` select string to include `finished_at` from builds and `verified_in_build_id` join
3. Add `activeTickets` to `useSidebarCounts`

**Dependency:** Phase 1 (views must exist). Can be done in parallel with Phase 2.

### Phase 4: Components (uiux-crm-designer)

1. Create `TicketPipelineStepper.jsx` -- the reusable per-ticket stepper widget
2. Create `PipelineFunnel.jsx` -- the overview funnel visualization
3. Create `PipelineTicketList.jsx` -- the table with inline steppers
4. Create `PipelinePage.jsx` -- the top-level page composing funnel + list

**Dependency:** Phase 3 (hooks must exist).

### Phase 5: Integration (uiux-crm-designer)

1. Replace the status pipeline section in `TicketDetail.jsx` with `TicketPipelineStepper`
2. Add `/pipeline` route to `App.jsx`
3. Add Pipeline nav item to `Sidebar.jsx`
4. Update `TicketDetail.jsx` `handleSaveRootCause` to also set `diagnosed_at`
5. Update `TicketDetail.jsx` `handleLinkPR` to record a `fix_submitted` activity

**Dependency:** Phase 4.

### Phase 6: Testing (test-engineer)

1. Unit tests for `TicketPipelineStepper` -- all 6 stage combinations
2. Unit tests for `PipelineFunnel` -- empty state, partial data, full data
3. Hook tests for `useLifecyclePipeline` and `usePipelineFunnel`
4. Integration test: create ticket, advance through all stages, verify pipeline view updates

**Dependency:** Phase 5.

---

## 6. Files to Create/Modify

### New Files

| File | Description |
|---|---|
| `supabase/migrations/20260810000008_lifecycle_pipeline.sql` | Schema changes + views |
| `frontend/src/pages/PipelinePage.jsx` | Pipeline page |
| `frontend/src/hooks/useLifecycleData.js` | Data hooks for pipeline views |
| `frontend/src/components/pipeline/PipelineFunnel.jsx` | Funnel overview component |
| `frontend/src/components/pipeline/PipelineTicketList.jsx` | Pipeline ticket table |
| `frontend/src/components/tickets/TicketPipelineStepper.jsx` | Reusable 6-stage stepper |

### Modified Files

| File | Change |
|---|---|
| `frontend/src/App.jsx` | Add `/pipeline` route |
| `frontend/src/components/layout/Sidebar.jsx` | Add Pipeline nav item |
| `frontend/src/hooks/useTickets.js` | Update `useTicketDetail` select to include new fields |
| `frontend/src/hooks/useSidebarCounts.js` | Add `activeTickets` count |
| `frontend/src/components/tickets/TicketDetail.jsx` | Replace status stepper with `TicketPipelineStepper`; set `diagnosed_at` on root cause save |
| `frontend/src/store/AppContext.jsx` | Add `activeTickets` to `initialState.counts` |
| `supabase/functions/resolution-tracker/index.ts` | Set `pr_merged_at` on merge |
| `supabase/functions/diagnosis/index.ts` | Set `diagnosed_at` on diagnosis |
| `supabase/seed.sql` | Add `diagnosed_at` values for seed tickets |
