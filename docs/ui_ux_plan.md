# CAPA CI Tracker -- UI/UX Plan

## 1. UX Overview

- **Hub-and-spoke with persistent shell.** A fixed sidebar provides top-level navigation across three tabs (Activity, Tickets, Builds). The main content area uses a list-detail split: lists on the left, detail panels on the right. This avoids full-page transitions and keeps context visible at all times.
- **Triage-first information hierarchy.** Every list view defaults to showing "what needs attention now" -- open tickets sorted by severity, failed builds first, recent activity at the top. Engineers should never need to configure filters to start their morning triage.
- **Keyboard-first, mouse-optional.** Global command palette (Cmd+K) for jumping to any ticket, build, or action. Arrow keys navigate lists, Enter opens detail, Escape closes panels. Tab key cycles between list and detail pane. All status transitions available via keyboard shortcuts shown in tooltips.
- **Inline workflow, not page-per-step.** Status transitions, diagnosis notes, PR linking, and task checklists all happen inline within the ticket detail view. No modals for routine work -- only confirmation dialogs for destructive actions.
- **Dense but scannable.** Compact rows with badges for status/severity, monospace for build IDs and test names. No whitespace-heavy cards in list views. The information density matches what engineers expect from terminal/IDE workflows.

---

## 2. Screen Inventory

| Screen | Purpose | Primary Component |
|---|---|---|
| **Activity Feed** | Global timeline of all events across builds and tickets. Default landing page for morning check-in. | Virtualized list with filterable event cards |
| **Ticket List** | Filterable, sortable table of all support tickets. Surfaces open items by severity. | DataTable with column sorting, faceted filters |
| **Ticket Detail** | Full diagnosis and resolution workspace. Status pipeline, failure logs, notes, tasks, linked builds/PRs. | Split layout: header + tabbed content area |
| **Build List** | Build history from Jenkins/Prow with pass/fail/skip trend chart. | Stacked bar chart + DataTable |
| **Build Detail** | Single build result: test results breakdown, linked tickets, failure details. | Card layout with test results table |
| **Command Palette** | Quick jump to any ticket, build, or action. | Command (cmdk) overlay |

---

## 3. Navigation & Layout (ASCII)

### App Shell

```
+----------------------------------------------------------+
| CAPA CI Tracker                          [Cmd+K] [?] [U] |
+------+---------------------------------------------------+
|      |                                                   |
|  A   |            Main Content Area                      |
|  c   |                                                   |
|  t   |   (varies by selected tab -- see below)           |
|  i   |                                                   |
|  v   |                                                   |
|  i   |                                                   |
|  t   |                                                   |
|  y   |                                                   |
|      |                                                   |
|------|                                                   |
|  T   |                                                   |
|  i   |                                                   |
|  c   |                                                   |
|  k   |                                                   |
|  e   |                                                   |
|  t   |                                                   |
|  s   |                                                   |
|------|                                                   |
|  B   |                                                   |
|  u   |                                                   |
|  i   |                                                   |
|  l   |                                                   |
|  d   |                                                   |
|  s   |                                                   |
|      |                                                   |
+------+---------------------------------------------------+
```

### Screen Flow

```
                    +------------------+
                    | Command Palette  |
                    | (Cmd+K overlay)  |
                    +--------+---------+
                             |
            jumps to any ticket/build
                             |
     +-----------+-----------+-----------+
     |           |                       |
     v           v                       v
+---------+ +---------+           +-----------+
| Activity| | Tickets |           |  Builds   |
|  Feed   | |  List   |           |   List    |
+---------+ +----+----+           +-----+-----+
                 |                      |
            click row              click row
                 |                      |
                 v                      v
          +------------+         +------------+
          |  Ticket    |         |   Build    |
          |  Detail    |<------->|   Detail   |
          | (Sheet)    | linked  |  (Sheet)   |
          +------------+         +------------+
```

### Navigation Notes

- Sidebar is a narrow icon+label rail (collapsed: icons only, expanded: icons + labels). Always visible.
- Active tab highlighted in sidebar. Badge counts show: open tickets count, failed builds count.
- Ticket Detail and Build Detail open as a right-side Sheet (slide-over panel) from their respective list views, preserving list context.
- Cross-links between tickets and builds navigate between detail views (ticket links to originating build; build links to generated tickets).

---

## 4. Key Screens -- ASCII Wireframes

### 4a. Activity Feed

```
+------+-----------------------------------------------------------+
| [A]  | Activity                                                  |
| [T]  |----------------------------------------------------------|
| [B]  | Filters: [All Events v] [Last 24h v] [All Tickets v]     |
|      |----------------------------------------------------------|
|      |                                                           |
|      | TODAY                                                     |
|      | +-------------------------------------------------------+ |
|      | | * Build #1847 FAILED         10:32 AM   [FAILED]      | |
|      | |   jenkins/nightly-4.17  3 tests failed                | |
|      | |   -> Auto-created ticket CAPA-312                     | |
|      | +-------------------------------------------------------+ |
|      | | * CAPA-310 status changed     9:15 AM                 | |
|      | |   investigating -> root_caused                        | |
|      | |   by @mhernandez                                      | |
|      | +-------------------------------------------------------+ |
|      | | * CAPA-308 comment added      8:47 AM                 | |
|      | |   "Root cause is upstream change in CAPI v1.8.2..."   | |
|      | |   by @jchen                                           | |
|      | +-------------------------------------------------------+ |
|      | | * CAPA-311 PR linked          8:30 AM                 | |
|      | |   openshift/capa#4521 "Fix VPC endpoint resolution"   | |
|      | |   by @asingh                                          | |
|      | +-------------------------------------------------------+ |
|      | | * Build #1846 PASSED          6:00 AM   [PASSED]      | |
|      | |   prow/periodic-4.16  47/47 passed                    | |
|      | +-------------------------------------------------------+ |
|      |                                                           |
|      | YESTERDAY                                                 |
|      | +-------------------------------------------------------+ |
|      | | * CAPA-309 VERIFIED           11:45 PM                | |
|      | |   Fix confirmed in Build #1845                        | |
|      | +-------------------------------------------------------+ |
|      | | ...                                                   | |
|      | +-------------------------------------------------------+ |
|      |                                                           |
+------+-----------------------------------------------------------+
```

**Components:** Sidebar (NavigationMenu), ScrollArea with virtualized list, Badge for status, Select dropdowns for filters, Card-like rows with timestamp alignment.

---

### 4b. Ticket List

```
+------+-----------------------------------------------------------+
| [A]  | Tickets                                    [+ New Ticket] |
| [T*] |----------------------------------------------------------|
| [B]  | Filters:                                                  |
|      | [Status: Open v] [Severity: All v] [Assignee: All v]     |
|      | [Search tickets...                               ] [Q]   |
|      |----------------------------------------------------------|
|      |                                                           |
|      | ID       | Title              | Severity  | Status       |
|      |          |                    |           |              |
|      | CAPA-312 | VPC endpoint       | [NIGHTLY  | [NEW]        |
|      |          | resolution failure |  BLOCKER] |              |
|      |          | in 4.17 nightly    |           | Assignee: -- |
|      |          |                    |           | 2h ago       |
|      |----------|--------------------|-----------|-----------   |
|      | CAPA-311 | EBS volume attach  | [TEST     | [FIX IN      |
|      |          | timeout in         |  REGRESS] |  PROGRESS]   |
|      |          | TestMachinePool    |           |              |
|      |          |                    |           | @asingh      |
|      |          |                    |           | 1d ago       |
|      |----------|--------------------|-----------|-----------   |
|      | CAPA-310 | Flaky SG cleanup   | [FLAKY]   | [ROOT        |
|      |          | in TestCluster     |           |  CAUSED]     |
|      |          | Lifecycle          |           |              |
|      |          |                    |           | @mhernandez  |
|      |          |                    |           | 2d ago       |
|      |----------|--------------------|-----------|-----------   |
|      | CAPA-309 | IAM role creation  | [INFRA]   | [VERIFIED]   |
|      |          | race condition     |           |              |
|      |          |                    |           | @jchen       |
|      |          |                    |           | 5d ago       |
|      |----------|--------------------|-----------|-----------   |
|      |                                                           |
|      | Showing 4 of 23 tickets          [< 1 2 3 ... 6 >]       |
|      |                                                           |
+------+-----------------------------------------------------------+
```

**Components:** DataTable with sortable columns, Badge for severity (color-coded) and status, Input for search, Select for filters, Button for new ticket, Pagination.

---

### 4c. Ticket Detail (Sheet -- slides over from right)

This is the most important screen. It opens as a wide Sheet panel (70% width) overlaying the ticket list.

```
+------+------------------+----------------------------------------+
| [A]  | Tickets (dimmed) |  CAPA-312                        [X]  |
| [T*] |                  |----------------------------------------|
| [B]  |                  |  VPC endpoint resolution failure       |
|      |                  |  in 4.17 nightly                       |
|      |                  |                                        |
|      |                  |  Status Pipeline:                      |
|      |                  |  [NEW]-->[INVESTIGATING]-->[ROOT       |
|      |                  |   ***       ( )         CAUSED]-->     |
|      |                  |  [FIX IN PROGRESS]-->[RESOLVED]-->     |
|      |                  |       ( )               ( )            |
|      |                  |  [VERIFIED]                            |
|      |                  |       ( )                              |
|      |                  |                                        |
|      |                  |  [Advance Status: Start Investigating] |
|      |                  |                                        |
|      |                  |  +-- Metadata ------+-- Links -------+ |
|      |                  |  | Severity:        | Build:          | |
|      |                  |  |  [NIGHTLY BLOCKER]|  #1847 (FAILED)| |
|      |                  |  | Assignee:        | Fix PR:         | |
|      |                  |  |  [Unassigned v]  |  [Link PR...]   | |
|      |                  |  | OCP Version:     | Verify Build:   | |
|      |                  |  |  4.17            |  --              | |
|      |                  |  | Created:         | Error Pattern:  | |
|      |                  |  |  2h ago          |  [Select... v]  | |
|      |                  |  +------------------+-----------------+ |
|      |                  |                                        |
|      |                  |  Root Cause:                           |
|      |                  |  +----------------------------------+  |
|      |                  |  | (empty -- add root cause)        |  |
|      |                  |  +----------------------------------+  |
|      |                  |                                        |
|      |                  |  [Diagnosis] [Tasks] [Timeline] [Logs] |
|      |                  |  ====================================  |
|      |                  |                                        |
|      |                  |  Diagnosis Notes:                      |
|      |                  |  +----------------------------------+  |
|      |                  |  | + Add note...                    |  |
|      |                  |  +----------------------------------+  |
|      |                  |  | @mhernandez -- 30m ago           |  |
|      |                  |  | VPC endpoint for S3 not found    |  |
|      |                  |  | in us-east-1. Checking if this   |  |
|      |                  |  | is a resource quota issue or     |  |
|      |                  |  | a timing problem in the          |  |
|      |                  |  | reconciler.                      |  |
|      |                  |  +----------------------------------+  |
|      |                  |                                        |
|      |                  |  Tasks (1/4 complete):                 |
|      |                  |  [x] Investigate failure logs          |
|      |                  |  [ ] Identify root cause               |
|      |                  |  [ ] Submit fix PR                     |
|      |                  |  [ ] Verify in next nightly            |
|      |                  |                                        |
+------+------------------+----------------------------------------+
```

**Tabs within ticket detail:**

| Sub-tab | Content |
|---|---|
| **Diagnosis** | Notes thread (newest first), root cause textarea, error pattern selector |
| **Tasks** | Checklist of resolution steps, add custom task, reorder |
| **Timeline** | Activity history for this ticket only (status changes, comments, PR events) |
| **Logs** | Failure log output from the originating build, syntax-highlighted |

**Components:** Sheet (wide, right-side), Stepper/Progress for status pipeline, Badge for severity, Select for assignee/error pattern, Tabs for sub-sections, Textarea for notes, Checkbox for tasks, ScrollArea for logs, Button for status advance.

---

### 4d. Build List (Transactions Tab)

```
+------+-----------------------------------------------------------+
| [A]  | Builds                                                    |
| [T]  |----------------------------------------------------------|
| [B*] | Build Trend (last 30 builds)                              |
|      |                                                           |
|      |  50|  ___  ___  ___  ___  ___  ___  ___  ___  ___  ___   |
|      |    | |***||***||***||***||***||***||***||***||***||***|  |
|      |    | |***||***||***||***||***||***||***||***||***||***|  |
|      |  25| |***||***||///||***||***||***||///||***||***||***|  |
|      |    | |***||***||///||***||***||***||///||***||***||///|  |
|      |    | |***||***||///||***||***||***||///||***||***||///|  |
|      |   0| |___||___||___||___||___||___||___||___||___||___|  |
|      |     #1838      #1841      #1844      #1847              |
|      |                                                          |
|      |  Legend: [***] Pass  [///] Fail  [   ] Skip              |
|      |                                                          |
|      |----------------------------------------------------------|
|      | Filters: [All Jobs v] [All Statuses v] [Last 7 days v]  |
|      |----------------------------------------------------------|
|      |                                                           |
|      | Build   | Job               | Status  | Pass | Fail |Skip|
|      |---------|-------------------|---------|------|------|----|
|      | #1847   | jenkins/nightly   | [FAILED]| 44   |  3   |  0 |
|      |         | -4.17             |         |      |      |    |
|      |         | 10:32 AM today    |         |      |      |    |
|      |---------|-------------------|---------|------|------|----|
|      | #1846   | prow/periodic     | [PASSED]| 47   |  0   |  0 |
|      |         | -4.16             |         |      |      |    |
|      |         | 6:00 AM today     |         |      |      |    |
|      |---------|-------------------|---------|------|------|----|
|      | #1845   | jenkins/nightly   | [PASSED]| 46   |  0   |  1 |
|      |         | -4.17             |         |      |      |    |
|      |         | Yesterday 10:30PM |         |      |      |    |
|      |---------|-------------------|---------|------|------|----|
|      | #1844   | prow/periodic     | [FAILED]| 42   |  4   |  1 |
|      |         | -4.16             |         |      |      |    |
|      |         | Yesterday 6:00PM  |         |      |      |    |
|      |---------|-------------------|---------|------|------|----|
|      |                                                           |
|      | Showing 4 of 156 builds         [< 1 2 3 ... 40 >]       |
|      |                                                           |
+------+-----------------------------------------------------------+
```

**Components:** Recharts BarChart (stacked), DataTable with sortable columns, Badge for status, Select for filters, Pagination.

---

## 5. Interaction & States

### Global Interactions

- **Cmd+K** opens the Command Palette. Search across tickets (by ID, title, error pattern), builds (by number, job name), and actions (create ticket, jump to activity). Results grouped by type.
- **Keyboard navigation**: Arrow Up/Down to move through list rows, Enter to open detail Sheet, Escape to close Sheet and return to list, Tab to cycle focus between sidebar/list/detail.
- **? key** opens a keyboard shortcuts cheat sheet dialog.

### Ticket States & Transitions

- **Status pipeline** is visualized as a horizontal stepper in the ticket detail header. Current status is highlighted and filled; future statuses are outlined. Clicking any forward status shows a confirmation.
- **Auto-advance rules**:
  - Linking a PR auto-advances from `root_caused` to `fix_in_progress` (with toast notification).
  - PR merge event auto-advances from `fix_in_progress` to `resolved`.
  - Next passing build that covers the same tests auto-advances from `resolved` to `verified`.
  - Each auto-advance shows an inline toast: "Status auto-advanced to [status] because [reason]".
- **Severity badges** use distinct visual weight: `nightly_blocker` is bold/prominent, `flaky` is subdued. Severity can be changed via dropdown in ticket detail metadata.

### Build States

- **PASSED** -- green badge, row has normal weight.
- **FAILED** -- red badge, row has semi-bold weight, failure count shown prominently.
- **RUNNING** -- blue badge with subtle pulse animation, duration counter ticking.
- **ABORTED** -- gray badge, muted row.

### Ticket List States

- **Empty state**: "No tickets match your filters. [Clear filters]" with illustration.
- **Loading state**: Skeleton rows (8 rows of shimmer placeholders).
- **Default sort**: Open tickets first, sorted by severity (nightly_blocker > test_regression > flaky > infrastructure > upstream_breakage), then by creation date (newest first).
- **Row hover**: Subtle background highlight. Row click opens detail Sheet.
- **Unassigned tickets**: Assignee column shows a dashed placeholder badge "[Assign]" that is directly clickable.

### Activity Feed States

- **Live updates**: New activities slide in at the top with a brief highlight animation. If the user has scrolled down, a floating pill appears: "3 new events [Jump to top]".
- **Grouped by day**: Activities are grouped under date headers (TODAY, YESTERDAY, Aug 8, etc.).
- **Linked navigation**: Clicking a ticket ID or build number in an activity event navigates to that entity's detail view.
- **Filter persistence**: Selected filters are saved to localStorage and restored on next visit.

### Ticket Detail Interactions

- **Notes thread**: Supports markdown in notes. New note input is a collapsible textarea at the top. Submitted notes appear immediately (optimistic update) with author avatar and timestamp.
- **Task checklist**: Checking a task shows a brief strikethrough animation. Tasks can be added inline with Enter key. Default tasks are auto-created from a template when a ticket is created.
- **Logs viewer**: Monospace font, syntax-highlighted for common log patterns (timestamps, ERROR/WARN levels, stack traces). Ctrl+F for in-log search. Line numbers shown.
- **PR linking**: Input accepts a GitHub PR URL or `org/repo#number` shorthand. After linking, displays PR title, status (open/merged/closed), and CI check status inline.

### Error & Edge Cases

- **Stale data**: If the backend is unreachable, a persistent banner appears at the top: "Connection lost. Retrying... Last updated 2m ago." Data remains visible but actions are disabled.
- **Concurrent edits**: If another user changes a ticket while you are viewing it, a non-blocking toast appears: "This ticket was updated by @jchen. [Refresh]".
- **Bulk operations**: In ticket list, checkbox column allows selecting multiple tickets. Bulk actions bar slides up from bottom: [Assign to...] [Change severity...] [Close].

### Responsive Behavior

- **Minimum supported width**: 1280px (desktop-only tool).
- **Sheet width**: Ticket detail Sheet is 65% of viewport width (min 800px). Build detail Sheet is 50%.
- **Sidebar collapse**: At widths below 1440px, sidebar auto-collapses to icon-only mode. Can be toggled manually via hamburger icon.

---

## Component Map (shadcn/ui)

| UI Region | shadcn/ui Component |
|---|---|
| App sidebar | NavigationMenu (vertical) |
| Header bar | Custom header with Button, Avatar |
| Quick search | Command (cmdk) |
| Ticket/Build tables | DataTable (TanStack Table) |
| Filters | Select, Input |
| Status/severity labels | Badge (variant per type) |
| Ticket detail panel | Sheet (side="right", wide) |
| Status pipeline | Custom stepper using Badge + Separator |
| Sub-section switching | Tabs |
| Notes input | Textarea |
| Task items | Checkbox + Label |
| Pagination | Pagination |
| Trend chart | Recharts BarChart (stacked) |
| Log viewer | ScrollArea + custom monospace block |
| Notifications | Toast (sonner) |
| Confirmations | AlertDialog |
| Keyboard help | Dialog |
