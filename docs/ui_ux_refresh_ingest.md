# UI/UX Plan — RefreshIngestButton Feature

## 1. UX Overview

- **Ingest-centric mental model.** The CI ingest pipeline is the root source of truth; every build row, ticket, and activity event flows from it. When ingest is on a once-daily schedule, users need an escape hatch to pull data on demand without waiting for the cron.
- **Primary navigation is sidebar + topbar (existing AppShell).** The Refresh button lives in the page header of both the Builds page and the Activity page — the two places where stale data is most visible.
- **Feedback without interruption.** Transient inline state (spinning icon, then "Updated" check) communicates success without covering content or requiring a dismissal. Power users do not want modal confirmations for routine actions.
- **Neutral affordance.** The Refresh button uses the `outline` variant — not `default` (primary action) or `destructive`. It is a utility control, not the page's primary CTA.
- **Graceful degradation.** Three non-success states (409 already running, disabled, network error) are handled distinctly with plain text labels and auto-reset so the button is never permanently broken.

---

## 2. Screen Inventory

| Screen | Purpose | Refresh button? |
|---|---|---|
| Activity (home) | Live event feed; landing page for most users | Yes — top-right of header row |
| Builds (Transactions) | Full build history table + KPI tiles | Yes — top-right of page header |
| Tickets | Ticket triage list | No — ticket data is derived; re-fetching builds is sufficient |

---

## 3. Navigation & Layout (ASCII)

```
[App Shell: Sidebar + Topbar]
 |
 +-- [Activity Page] --------------------------------+
 |    Header: "Activity"  [count]  [Refresh]         |
 |    Filters: type | date-range | actionable-only   |
 |    Triage summary banner                          |
 |    ActivityTimeline                               |
 |                                                   |
 +-- [Builds Page (Transactions)] ------------------+
 |    Header: "Builds"             [Refresh]         |
 |    BuildStatTiles (KPI row)                       |
 |    BuildTrendChart                                |
 |    BuildHistoryTable (filters inline in table)    |
 |    BuildDetail (Sheet, slides in on row click)    |
 |                                                   |
 +-- [Tickets Page] ---------------------------------+
      Header: "Tickets"
      TicketTable + filters
      TicketDetail (Sheet)
```

---

## 4. Key Screens — ASCII Wireframes

### Activity Page Header

```
+------------------------------------------------------------+
| Activity                          [12 events]  [Refresh]   |
+------------------------------------------------------------+
| [All Events v]  [Last 24h v]  [Actionable only (toggle)]  |
+------------------------------------------------------------+
| TRIAGE SUMMARY: 3 failed builds  |  5 open tickets  |  2 unassigned |
+------------------------------------------------------------+
| TODAY                                                       |
|  o  build_completed  e2e-rosa-hcp  failed  10:42 AM        |
|  o  ticket_created   CAPA-312     new     10:42 AM         |
| YESTERDAY                                                   |
|  o  fix_merged       PR #8841     ...     04:11 AM         |
+------------------------------------------------------------+
```

Components: Button (outline, sm), FilterSelect, DateRangeFilter, Button (ghost/toggle), Link badges, ActivityTimeline

---

### Builds Page Header

```
+------------------------------------------------------------+
| Builds                                         [Refresh]   |
+------------------------------------------------------------+
| [KPI tile: Total] [KPI tile: Pass Rate] [KPI tile: Failed] |
| [KPI tile: Infra Failed] [KPI tile: Avg Duration]          |
+------------------------------------------------------------+
| [Trend Chart — 30d bar chart]                              |
+------------------------------------------------------------+
| BUILD HISTORY                                               |
| [Job filter v] [Status v] [Date v]  [Hide infra toggle]    |
| +----------------------------------------------------------+|
| | # | Job | Status | Source | Started | Duration | Ticket ||
| |---|-----|--------|--------|---------|----------|--------||
| | 1 | ... | FAIL   | jenkins| ...     | 12m      | #312   ||
+------------------------------------------------------------+
```

Components: Button (outline, sm), BuildStatTiles (Card grid), BuildTrendChart (Recharts BarChart), BuildHistoryTable (Table + inline filters), Separator

---

### RefreshIngestButton — State Machine (inline component)

```
[idle]          outline, refresh-icon,  "Refresh"         clickable
    |
    v (click)
[loading]       disabled, spin-icon,    "Refreshing..."   not clickable
    |
    +-- HTTP 200 ok:true  --> [success]       check-icon, "Updated"       -> [idle] after 3s
    +-- HTTP 409          --> [alreadyRunning] "Already running..."        -> [idle] after 3s
    +-- HTTP 200 ok:false --> [disabled]       "Ingest disabled"           -> [idle] after 4s
    +-- network/500 err   --> [error]          error-icon, "Refresh failed" clickable (retry)
```

---

## 5. Interaction & States

- **Loading state:** Button is `disabled`; icon swaps to a CSS `animate-spin` circle; label reads "Refreshing…". Prevents double-submission.
- **Success (ok:true):** Icon swaps to a green check; label reads "Updated". Button stays `disabled` for 3 seconds (prevents rage-clicking immediately after a successful ingest), then auto-resets to idle. The `onRefreshed` callback fires immediately so the builds/activities table re-queries.
- **409 Already running:** Label reads "Already running…"; button is `disabled` for 3 seconds, then resets. No hard error — ingest is in progress, which is fine.
- **Disabled (ok:false):** Label reads "Ingest disabled". Stays muted for 4 seconds, then resets. Handles the `DISABLE_INGEST` env var case.
- **Network / 500 error:** Icon swaps to a destructive exclamation; label reads "Refresh failed". Button re-enables immediately so the user can retry.
- **Empty / loading page states:** The Refresh button is always rendered; it does not depend on data being present, so it works even when the table is in a loading or empty state.
- **Refetch trigger:** On success, `onRefreshed` calls `refetch` (the `fetchData` callback from `useRealtimeTable`, exposed as `refetch` through `useBuilds` and `useActivities`). This immediately re-queries the table with the current active filters. The 30-second polling interval continues unchanged — the on-demand call is additive.
- **API base URL:** Resolved from `import.meta.env.VITE_API_URL || '/api'` — the same constant used by `src/config/supabase.js`. Not hardcoded.
- **No new libraries:** No toast library added. Inline transient state is sufficient for a power-user tool.
- **Accessibility:** `aria-label="Trigger on-demand CI ingest"` on the button; `aria-hidden` on all decorative SVG icons.
