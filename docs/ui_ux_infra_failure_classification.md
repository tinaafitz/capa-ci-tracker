# UI/UX Plan: CI Infra/Harness Failure Classification

Feature branch: `feat/infra-failure-classification`
Date: 2026-08-25

---

## 1. UX Overview

- **Build-centric mental model.** The Builds page (TransactionsPage) is the primary surface for infra classification. Tickets are secondary — they inherit the same classification from their originating build.
- **Primary navigation** is left sidebar (Builds, Tickets, Activity, Pipeline). No new top-level routes are added for this feature.
- **Color semantics are load-bearing.** Red = product/test failure (real regression). Amber/yellow = infra failure (different owner, CI harness problem). Green = pass. Gray = neutral/pending. This palette is applied consistently across the infra badge, stat tile sub-count, and detail banner.
- **Never hide by default.** Infra failures are always visible; the "Hide infra failures" toggle is opt-in hiding. This ensures teams see the full picture and can choose to narrow to product failures when needed.
- **Information density over explanation.** The infra badge is compact (e.g. `infra:lease`) and inline in the table. Full detail (failure_class label + full failure_reason path) is deferred to the detail sheet/panel, which the user opens on demand.

---

## 2. Screen Inventory

| Screen | Route | Purpose |
|---|---|---|
| Builds List | `/builds` | Primary surface: paginated build table with infra badge column, hide toggle, stat tiles |
| Build Detail | Sheet overlay on Builds | Infra notice banner + failure_reason path when is_infra=1 |
| Tickets Kanban | `/tickets` (kanban view) | Board with infra badge on cards; hide toggle in header |
| Tickets List | `/tickets` (table view) | Table with inline infra badge on Title; hide toggle in header |

---

## 3. Navigation & Layout (ASCII)

```
[App Shell: Sidebar + Topbar]
 ├─ [Builds List]  ←── primary infra surface
 │    ├─ Filter bar: [All Jobs] [All Statuses] [DateRange] ... [Hide infra toggle]
 │    ├─ Stat tiles: [Total] [Pass Rate] [Failed · N infra] [Avg Duration]
 │    └─ Build row → [Build Detail Sheet]
 │         └─ Infra banner (failure_class + failure_reason) when is_infra=1
 │
 └─ [Tickets]  ←── secondary surface
      ├─ Header: [Kanban|Table toggle] ... [Hide infra toggle] [New Ticket]
      ├─ [Kanban] — infra badge on ticket cards
      └─ [Table]  — infra badge inline in Title cell
```

---

## 4. Key Screens – ASCII Wireframes

### 4a. Builds List — Filter Bar + Table

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Builds                                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Total: 142]   [Pass Rate: 71%]   [Failed: 41 · 8 infra]   [Avg: 47m]     │
│  Card            Card (green)      Card (red + amber sub)     Card          │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Trend Chart — 30d pass/fail bars]                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  [All Jobs ▾]  [All Statuses ▾]  [7d ▾]              [◯ Hide infra fails] │
├───────────────┬─────────────────┬────────┬────────┬──────────┬────┬────────┤
│ Build         │ Job             │ Source │ Status │ Class    │ Tests │ Started│
├───────────────┼─────────────────┼────────┼────────┼──────────┼────┼────────┤
│ #12345        │ periodic-ci-... │ prow   │ Failed │ infra:lease│ --/2/- │ 2h ago│
│               │                 │        │ (red)  │ (amber)  │        │       │
├───────────────┼─────────────────┼────────┼────────┼──────────┼────┼────────┤
│ #12344        │ periodic-ci-... │ prow   │ Failed │          │ 0/5/2  │ 3h ago│
│               │                 │        │ (red)  │          │        │       │
├───────────────┼─────────────────┼────────┼────────┼──────────┼────┼────────┤
│ #12343        │ periodic-ci-... │ prow   │ Passed │          │ 120/0/3│ 4h ago│
└───────────────┴─────────────────┴────────┴────────┴──────────┴────┴────────┘
```

Components: `BuildStatTiles` (Card), `BuildTrendChart`, `FilterSelect`, `DateRangeFilter`, toggle (custom), `Table`/`TableRow`/`TableCell`, `StatusBadge` (red for failed), `InfraBadge` (amber, outline, font-mono).

### 4b. Build Detail Sheet — Infra Banner

```
┌────────────────────────────────────────┐
│ Build #12345           [Failed]        │
│ periodic-ci-openshift-online-...       │
│ prow · 2h ago · 47m                    │
├────────────────────────────────────────┤
│ ┌──────────────────────────────────┐   │
│ │ [infra:lease]  CI infra failure  │   │  ← amber border, amber bg
│ │ This is a CI infrastructure or  │   │
│ │ harness failure, not a product  │   │
│ │ test failure.                   │   │
│ │ executing_graph:step_failed:    │   │  ← full failure_reason, mono
│ │ utilizing_lease:releasing_lease │   │
│ └──────────────────────────────────┘   │
│                                        │
│ Test Summary                           │
│  -- pass  2 fail  -- skip              │
│  [░░░░░░░░░░░░░░░░░░░░░] 0% (2 total)  │
│                                        │
│ Linked Ticket                          │
│ [CAPA-42  Boskos lease 401  Investing] │
│                                        │
│ Log Excerpt                            │
│  > executing_graph step_failed ...     │
└────────────────────────────────────────┘
```

Components: `Sheet`, `SheetHeader`, `SheetTitle`, `StatusBadge`, infra notice `div` (amber border/bg), `Label`, `Separator`, `Card`, `TicketStatusBadge`, `ScrollArea`.

### 4c. Tickets Kanban — Header + Card Badge

```
┌──────────────────────────────────────────────────────────────┐
│ Tickets  [⊞][≡]                      [◯ Hide infra] [+ New] │
├──────────────────────────────────────────────────────────────┤
│  New (3)     │ Investigating (5) │ Root Caused (2) │ ...     │
│ ┌──────────┐ │ ┌──────────────┐  │                 │         │
│ │CAPA-42   │ │ │ CAPA-38      │  │                 │         │
│ │Boskos    │ │ │ e2e test...  │  │                 │         │
│ │lease 401 │ │ │              │  │                 │         │
│ │[infra:   │ │ │ [Test Regr.] │  │                 │         │
│ │ lease]   │ │ │ @alice       │  │                 │         │
│ │[Infra]   │ │ └──────────────┘  │                 │         │
│ │@unassign │ │                   │                 │         │
│ └──────────┘ │                   │                 │         │
└──────────────────────────────────────────────────────────────┘
```

Components: `TicketKanban`, `KanbanColumn`, `TicketCard`, `SeverityBadge`, `Badge` (amber outline for infra), toggle (custom checkbox).

---

## 5. Interaction & States

- **Toggle semantics:** "Hide infra failures" is OFF by default on both Builds and Tickets pages. State is local (useState) — not persisted to URL or localStorage. Toggling immediately re-queries via `useBuilds`/`useTickets` by adding `is_infra = 0` to the filter object.
- **Filter key used:** `is_infra = 0` (exact equality via the PostgREST-compat `eq` operator). The filter key in the filter object is `is_infra` with value `0` (integer). This maps to `f.is_infra = 0` inside `buildBuildFilters` and the `useTickets` filters memo.
- **Infra badge label mapping:**
  - `infra_lease` → `infra:lease`
  - `infra_auth` → `infra:auth`
  - `infra_teardown` → `infra:teardown`
  - `infra_provision` → `infra:provision`
  - `infra_timeout` → `infra:timeout`
  - `aborted` → `infra:aborted`
  - `null`/unknown → `infra:infra` (fallback)
  - Logic: strip `infra_` prefix if present; otherwise use the class as-is.
- **Stat tile sub-count:** The Failed tile shows `N infra` in amber text below the main count (e.g. "41" with sub "8 infra"). This count is always computed from unfiltered data so toggling "Hide infra" on the table does not remove the sub-count from the tile.
- **Build detail banner:** Shown only when `is_infra === 1`. Renders at the top of the ScrollArea body before "Test Summary". Uses amber border + amber bg `div` (not a shadcn `Alert` — avoids adding a dependency). Contains: amber `infra:X` chip, one-line explainer sentence, and the raw `failure_reason` string in mono.
- **Tickets page:** `hideInfra` state is shared between kanban and table views (single toggle in the page header). Changing it immediately re-queries `useTickets`.
- **Empty state:** Existing `EmptyState` component is reused with no modification. If all builds are infra and toggle is ON, the table shows "No builds found" with "Clear filters" action (which does not reset `hideInfra` — user must un-toggle manually, keeping the filter's intentionality clear).
- **Loading states:** All loading/skeleton patterns are unchanged. The new infra badge and banner only render when real data is present (`is_infra` field is available from the API).
- **Error state:** The toggle has no independent error state. If the API returns an error, the existing `error` state from `useRealtimeTable` surfaces in the normal place.
- **No-permission:** Not applicable for this feature — infra classification is read-only metadata on builds and tickets.
