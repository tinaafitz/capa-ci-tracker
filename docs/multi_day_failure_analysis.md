# Multi-Day Failure Analysis -- Technical Design

Automated detection and analysis of multi-day failure streaks where the root cause changes between builds, like the Aug 7-12 incident (v1beta2 -> OCM 403 -> image pull failure).

## Problem Statement

The current system treats each failed build independently. Triage computes an error_signature per build and either links it to an existing ticket or creates a new one. This misses a critical pattern: **multi-phase failures** where a job fails for N consecutive days with different root causes, and fixes for earlier phases are masked by new failures.

The Aug 7-12 incident required manual analysis across 6 days of builds, GCS logs, and upstream commit history. This design automates that analysis.

## Design Principles

1. **Build on what exists.** The `builds` table already has the timeline. The `error_signature` column already detects when failures change. Streaks are a query over existing data, not a new data source.
2. **GCS log fetching is the high-value addition.** Prow `test_failures` today only contains the job description string. Real diagnosis requires the full `build-log.txt` from GCS artifacts.
3. **Claude API is for log analysis, not pattern matching.** Structured regex handles known patterns. Claude handles the 40% of failures that don't match any known pattern -- extracting root cause from 50KB+ build logs.
4. **Correlation, not causation.** Upstream commit correlation surfaces "what changed" but does not claim to identify the breaking commit. That's the engineer's job.

---

## 1. Schema Changes

### 1.1 New table: `failure_streaks`

Represents a contiguous run of failed builds for a specific job. Created and updated by the streak-analyzer CronJob.

```sql
CREATE TABLE failure_streaks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        TEXT        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('jenkins', 'prow')),
  started_at      TIMESTAMPTZ NOT NULL,      -- started_at of first failing build
  ended_at        TIMESTAMPTZ,               -- started_at of first passing build after streak (NULL = ongoing)
  streak_length   INT         NOT NULL DEFAULT 1,
  phase_count     INT         NOT NULL DEFAULT 1,  -- number of distinct error signatures
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'resolved', 'partial_fix')),
  phases          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- phases structure:
  -- [
  --   {
  --     "phase_number": 1,
  --     "error_signature": "e2e.capa...::abc123",
  --     "matched_pattern": "capi_not_installed",
  --     "first_build_id": "uuid",
  --     "last_build_id": "uuid",
  --     "first_seen": "2026-08-07T04:00:00Z",
  --     "last_seen": "2026-08-07T04:00:00Z",
  --     "build_count": 1,
  --     "ticket_id": "uuid",
  --     "fix_pr_url": "https://github.com/.../pull/127",
  --     "fix_verified": true,
  --     "summary": "CAPI v1beta2 apiGroup validation error"
  --   },
  --   { "phase_number": 2, ... }
  -- ]
  upstream_commits JSONB      DEFAULT '[]'::jsonb,
  -- upstream_commits structure:
  -- [
  --   {
  --     "repo": "stolostron/cluster-api-installer",
  --     "commits": [
  --       {"sha": "abc123", "message": "...", "author": "...", "date": "..."}
  --     ],
  --     "compare_url": "https://github.com/.../compare/abc...def"
  --   }
  -- ]
  analysis_summary TEXT,           -- Claude-generated natural language summary
  analyzed_at     TIMESTAMPTZ,     -- when last analyzed
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT streak_dates_valid CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX idx_streaks_job_name   ON failure_streaks (job_name);
CREATE INDEX idx_streaks_status     ON failure_streaks (status) WHERE status = 'active';
CREATE INDEX idx_streaks_started_at ON failure_streaks (started_at DESC);
CREATE INDEX idx_streaks_source_job ON failure_streaks (source, job_name);

CREATE TRIGGER trg_streaks_updated_at
  BEFORE UPDATE ON failure_streaks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

**Why a separate table instead of a column on `builds`?** A streak spans multiple builds and multiple tickets. It's a first-class entity with its own lifecycle (active -> partial_fix -> resolved). Storing it as a JSONB column on builds would require denormalizing across rows.

### 1.2 New table: `build_logs`

Stores fetched GCS build logs. Separate from `builds` to keep the builds table lean (logs can be 50-200KB each).

```sql
CREATE TABLE build_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id        UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  log_url         TEXT        NOT NULL,
  log_text        TEXT,                     -- full log, truncated to last 100KB
  log_size_bytes  INT,
  error_extract   TEXT,                     -- relevant error section (last 5KB or regex-extracted)
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT build_logs_build_uq UNIQUE (build_id)
);

CREATE INDEX idx_build_logs_build_id ON build_logs (build_id);
```

**Retention:** `log_text` nullified after 30 days (keep `error_extract`). Added to the existing `retention-cleanup.ts` CronJob.

### 1.3 New table: `streak_builds` (join table)

Links builds to their streak, preserving the order and per-build error signature.

```sql
CREATE TABLE streak_builds (
  streak_id       UUID        NOT NULL REFERENCES failure_streaks (id) ON DELETE CASCADE,
  build_id        UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  position        INT         NOT NULL,     -- 1-indexed position in streak
  error_signature TEXT,
  phase_number    INT,                      -- which phase this build belongs to

  PRIMARY KEY (streak_id, build_id)
);

CREATE INDEX idx_streak_builds_build ON streak_builds (build_id);
```

### 1.4 New columns on `support_tickets`

```sql
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS streak_id UUID REFERENCES failure_streaks (id) ON DELETE SET NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS signature_cleared_in_build_id UUID REFERENCES builds (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_streak_id ON support_tickets (streak_id) WHERE streak_id IS NOT NULL;
```

- `streak_id`: Links a ticket to the failure streak it belongs to. Multiple tickets can share a streak (one per phase).
- `signature_cleared_in_build_id`: The first build where this ticket's specific error_signature was absent, even if the build still failed overall. This is the "PR #128's fix is working even though the build failed for a different reason" insight.

### 1.5 New column on `builds`

```sql
ALTER TABLE builds ADD COLUMN IF NOT EXISTS log_fetched BOOLEAN NOT NULL DEFAULT false;
```

Tracks whether we've already fetched the GCS log for this build (avoids redundant fetches).

### 1.6 New view: `v_failure_timeline`

Powers the frontend failure timeline visualization.

```sql
CREATE OR REPLACE VIEW v_failure_timeline AS
SELECT
  b.id AS build_id,
  b.source,
  b.external_id,
  b.job_name,
  b.job_url,
  b.status::text AS status,
  b.started_at,
  b.finished_at,
  b.fail_count,
  b.total_count,
  b.ocp_version,
  sb.streak_id,
  sb.position AS streak_position,
  sb.phase_number,
  sb.error_signature,
  fs.streak_length,
  fs.phase_count,
  fs.status AS streak_status,
  st.id AS ticket_id,
  st.ticket_number,
  st.title AS ticket_title,
  st.status::text AS ticket_status,
  st.fix_pr_url,
  st.fix_pr_number
FROM builds b
LEFT JOIN streak_builds sb ON sb.build_id = b.id
LEFT JOIN failure_streaks fs ON sb.streak_id = fs.id
LEFT JOIN support_tickets st ON st.error_signature = sb.error_signature
  AND st.status NOT IN ('verified')
WHERE b.started_at > now() - INTERVAL '30 days'
ORDER BY b.job_name, b.started_at DESC;
```

### 1.7 Updated activity_type ENUM

```sql
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_detected';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_phase_change';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'signature_cleared';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'streak_resolved';
```

---

## 2. New CronJob: `streak-analyzer.ts`

Runs every 15 minutes (same cadence as resolution-tracker). Four phases, each independent and idempotent.

### 2.1 Phase 1: Detect and update streaks

```
Input: builds table (ordered by job_name, started_at)
Output: failure_streaks, streak_builds rows
```

**Algorithm:**

```
For each distinct job_name in builds:
  1. Query last 30 days of builds, ordered by started_at ASC
  2. Walk the timeline, grouping consecutive failures into streaks:
     - A streak starts when a build fails after a success (or is the first build)
     - A streak ends when a build succeeds
     - Minimum streak length to track: 2 (single failures handled by existing triage)
  3. For each streak:
     a. Check if a failure_streaks row exists for this (job_name, started_at)
     b. If not, INSERT it
     c. Compute phases by grouping builds where the error_signature changes:
        - Build 1: sig_A -> Phase 1
        - Build 2: sig_A -> Phase 1 (same)
        - Build 3: sig_B -> Phase 2 (new phase!)
        - Build 4: sig_B -> Phase 2 (same)
     d. UPDATE phases JSONB, phase_count, streak_length
     e. UPSERT streak_builds join rows
  4. For active streaks where a new passing build exists: set ended_at, status='resolved'
```

**Why walk the timeline instead of using a window function?** Window functions would work for simple streaks, but phase detection requires comparing error_signatures across consecutive builds in a streak. The walk is O(N) where N is builds in the last 30 days per job (~30-60 rows). Not a performance concern.

**Race condition with ingestion:** The streak analyzer reads builds that ingestion writes. Since they run on different CronJob schedules (ingest at */5, streak at */15), the worst case is a 5-minute delay in streak detection. The analyzer is idempotent -- running it twice produces the same result.

### 2.2 Phase 2: Fetch GCS build logs

```
Input: builds with status='failure' AND log_fetched=false AND source='prow'
Output: build_logs rows, builds.log_fetched=true
```

**Algorithm:**

```
For each unfetched failed Prow build:
  1. Construct GCS URL:
     https://storage.googleapis.com/test-platform-results/logs/{job_name}/{build_id}/build-log.txt
  2. Fetch with 30-second timeout, accept partial content
  3. If log > 100KB, keep only the last 100KB (errors are at the end)
  4. Extract error section: find the LAST occurrence of "FAIL" or "ERROR" or "error:"
     and take 5KB around it. Store as error_extract.
  5. INSERT into build_logs
  6. UPDATE builds SET log_fetched = true
```

**Jenkins note:** Jenkins builds are behind VPN, so log fetching only works for Prow. Jenkins test_failures already come from the structured testReport API, which is richer than raw logs. If we self-host on OpenShift (behind VPN), Jenkins log fetching becomes possible too -- but that's Phase 2.

**Failure mode:** GCS returns 404 for builds older than ~90 days. If the fetch fails, mark `log_fetched = true` anyway (with NULL log_text) to avoid retrying forever. Log the 404 in agent_runs.

### 2.3 Phase 3: Upstream commit correlation

```
Input: active failure_streaks
Output: failure_streaks.upstream_commits JSONB updated
```

**Algorithm:**

```
For each active streak that hasn't been analyzed in the last 6 hours:
  1. Find the last passing build before the streak started (for this job_name)
  2. Get its finished_at timestamp as the "baseline" time
  3. For each watched repo:
     - stolostron/rosa-hcp-e2e-test
     - stolostron/cluster-api-installer
     - openshift-online/rosa-e2e (main branch)
  4. Query GitHub commits API:
     GET /repos/{owner}/{repo}/commits?since={baseline}&until={streak_started_at}&per_page=30
  5. Store the commit list in upstream_commits JSONB
  6. Generate a compare URL: https://github.com/{owner}/{repo}/compare/{first_sha}...{last_sha}
```

**Watched repos are configurable** via `WATCHED_REPOS` env var (comma-separated `owner/repo` list). Default: the 3 above.

**GitHub API rate limit:** With GITHUB_PAT, the limit is 5000 req/hour. At 3 repos * ~10 active streaks * 1 call each = 30 calls per run. Well within budget.

### 2.4 Phase 4: Signature-cleared detection (enhanced fix verification)

This is the key insight from the Aug 12 analysis: PR #128's OCM role fix was working, but the build still failed because of the image pull issue. The current resolution-tracker only verifies against *passing* builds. This phase checks *failing* builds too.

```
Input: tickets with status IN ('fix_in_progress', 'resolved') AND error_signature IS NOT NULL
Output: support_tickets.signature_cleared_in_build_id updated, activity logged
```

**Algorithm:**

```
For each eligible ticket:
  1. Find builds that ran AFTER the ticket's fix PR was merged (pr_merged_at)
     or, if not yet merged, after the ticket was created
  2. Among those builds (including failures), check if any do NOT contain
     the ticket's error_signature in their test_failures
  3. If found and signature_cleared_in_build_id is NULL:
     a. SET signature_cleared_in_build_id = that build's id
     b. INSERT activity: 'signature_cleared'
     c. If the ticket is in a streak with multiple phases, update the
        phase's fix_verified=true in the streak's phases JSONB
```

**Concrete example with Aug 7-12 incident:**

| Date | Build | Error Signature | Ticket | Phase |
|------|-------|----------------|--------|-------|
| Aug 7 | #1 | v1beta2_apiGroup_hash | CAPA-10 | 1 |
| Aug 8 | #2 | ocm_403_hash | CAPA-11 | 2 |
| Aug 9 | #3 | ocm_403_hash | CAPA-11 | 2 |
| Aug 10 | #4 | ocm_403_hash | CAPA-11 | 2 |
| Aug 11 | #5 | ocm_403_hash | CAPA-11 | 2 |
| Aug 12 | #6 | image_pull_hash | CAPA-12 | 3 |

When build #2 arrives (Aug 8):
- Streak analyzer sees builds #1 and #2 are consecutive failures for the same job
- Error signature changed: v1beta2 -> ocm_403. Creates streak with 2 phases.
- CAPA-10's error_signature is absent from build #2. But PR #127 hasn't merged yet, so no signature_cleared action.

When build #6 arrives (Aug 12):
- PR #127 merged on Aug 8, PR #128 merged on Aug 12
- Phase 4 checks: Is CAPA-10's signature absent from builds after PR #127 merge? Yes (builds #2-6 all lack v1beta2 error). CAPA-10 gets signature_cleared_in_build_id = build #2.
- Phase 4 checks: Is CAPA-11's ocm_403 signature absent from build #6? Yes. CAPA-11 gets signature_cleared_in_build_id = build #6.

---

## 3. Claude API Integration

### 3.1 Where it adds value

| Task | Structured analysis | Claude API |
|------|-------------------|------------|
| Error signature computation | SHA-256 of normalized message | Not needed |
| Known pattern matching | 12 regex patterns | Not needed |
| GCS log root cause extraction | Regex for FAIL/ERROR blocks | **Yes** -- for the 40% that don't match known patterns |
| Multi-phase summary | Template-based | **Yes** -- natural language streak summary |
| Upstream commit relevance | List commits | **Yes** -- correlate commit messages with error text |

### 3.2 Log analysis prompt (when no known pattern matches)

Called from Phase 2 of streak-analyzer, only for builds where `diagnoseFailures()` returns null.

```
System: You are a CI failure analyst for the CAPA/ROSA HCP OpenShift team.
Analyze this build log extract and identify:
1. The root cause of the failure (one sentence)
2. The error category (one of: aws_infrastructure, auth_credentials, capi_setup,
   upstream_breakage, rosa_lifecycle, infrastructure_timeout, aws_iam, image_registry,
   test_code, unknown)
3. Whether this looks like a transient/flaky issue or a persistent problem
4. Any upstream component or repo that likely introduced the breakage

Build log (last 5KB):
{error_extract}

Test failures from structured data:
{test_failures JSON}

Job: {job_name}
OCP version: {ocp_version}
Date: {started_at}

Respond in JSON: {"root_cause": "...", "category": "...", "transient": bool, "upstream_component": "..." | null}
```

**Cost estimate:** Claude Haiku at ~$0.25/MTok input, ~$1.25/MTok output. 5KB input + 200 token output = ~$0.002 per call. At 5-10 unmatched failures/week = $0.01-0.02/week. Negligible.

**Implementation:** Use `@anthropic-ai/sdk` npm package. Call conditionally: only when `diagnoseFailures()` returns null AND the build has a fetched log in `build_logs`.

### 3.3 Streak summary prompt

Called once per streak when phase_count > 1 (multi-phase streaks are the interesting ones).

```
System: Summarize this CI failure streak for the CAPA/ROSA HCP team.

Streak: {job_name} failed {streak_length} consecutive builds from {started_at} to {ended_at}.

Phases:
{phases JSON with error messages from each phase}

Upstream commits during this period:
{upstream_commits JSON}

Fix PRs:
{list of fix_pr_urls with merge dates}

Write 2-3 sentences explaining what happened, why fixes for earlier phases
were masked by later failures, and which fixes have been verified vs still pending.
```

Stored in `failure_streaks.analysis_summary`. Displayed on the frontend streak detail view.

---

## 4. Data Flow

```
CronJob/ingest-prow (*/5)
  |
  +--> INSERT builds (status='failure')
  +--> triageBuild() -> ticket created/linked
  |
  v
CronJob/streak-analyzer (*/15, offset by 7 min from ingest)
  |
  +-- Phase 1: Detect streaks
  |     Query builds by job_name, walk timeline
  |     UPSERT failure_streaks + streak_builds
  |     If phase_count changed -> activity 'streak_phase_change'
  |     If streak_length >= 2 and new -> activity 'streak_detected'
  |     Link tickets to streak via streak_id
  |
  +-- Phase 2: Fetch GCS logs
  |     For unfetched failed Prow builds:
  |       GET storage.googleapis.com/.../build-log.txt
  |       INSERT build_logs (log_text, error_extract)
  |       If no known pattern match -> call Claude API for analysis
  |       UPDATE ticket root_cause from Claude response
  |
  +-- Phase 3: Upstream commit correlation
  |     For active streaks not analyzed in 6h:
  |       GET github.com/repos/.../commits?since=...&until=...
  |       UPDATE failure_streaks.upstream_commits
  |
  +-- Phase 4: Signature-cleared detection
        For fix_in_progress/resolved tickets:
          Check if error_signature absent from builds after PR merge
          UPDATE support_tickets.signature_cleared_in_build_id
          INSERT activity 'signature_cleared'
          UPDATE streak phases[].fix_verified

CronJob/resolution-tracker (*/15)
  |
  +-- Phase 1: PR merge check (unchanged)
  +-- Phase 2: Full-build verification (unchanged)
  +-- Phase 3 (NEW): Update streak status
        When all phases in a streak have fix_verified=true -> streak status='resolved'
        When some phases verified -> streak status='partial_fix'
```

**Why a separate CronJob instead of adding to ingest.ts?** The streak analyzer does expensive work (GCS fetches, GitHub API calls, optional Claude API calls). Running it inline with ingestion would extend the 5-minute CronJob beyond its interval. A separate 15-minute CronJob with 7-minute offset ensures it runs after ingestion has committed new builds.

---

## 5. OpenShift Deployment Addition

One new CronJob:

```yaml
# In the capa-ci-tracker namespace, alongside existing CronJobs
CronJob/streak-analyzer:
  schedule: "7-59/15 * * * *"    # Every 15min, offset 7min from ingest
  image: same jobs image
  command: ["node", "--import", "tsx", "jobs/streak-analyzer.ts"]
  env:
    - DATABASE_URL (from Secret/db-credentials)
    - GITHUB_PAT (from Secret/api-tokens)
    - ANTHROPIC_API_KEY (from Secret/api-tokens, new key)
    - WATCHED_REPOS (from ConfigMap/app-config, default: "stolostron/rosa-hcp-e2e-test,stolostron/cluster-api-installer,openshift-online/rosa-e2e")
    - SLACK_WEBHOOK_URL (from Secret/api-tokens)
```

Add `ANTHROPIC_API_KEY` to `Secret/api-tokens`. Add `WATCHED_REPOS` to `ConfigMap/app-config`.

---

## 6. Frontend: Failure Timeline View

### 6.1 New page: `/streaks` (or section on existing Pipeline page)

**Option chosen: Add to Pipeline page as a second tab.** The Pipeline page already shows the ticket lifecycle funnel. Adding a "Failure Streaks" tab keeps related views together without adding a new nav item.

### 6.2 Failure Timeline component

A horizontal timeline showing builds for a selected job over the last 14-30 days:

```
Job: periodic-ci-...-capa-e2e
                                                     
Aug 5  Aug 6  Aug 7  Aug 8  Aug 9  Aug 10 Aug 11 Aug 12 Aug 13
  [P]    [P]   [F1]   [F2]   [F2]   [F2]   [F2]   [F3]   [P]
               |--- Phase 1 ---|--- Phase 2 ----------|-- P3 -|
               v1beta2          OCM 403                 img pull
               PR #127 merged   PR #128 merged          PR #746
               [verified]       [verified]              [open]
```

- `[P]` = green circle (pass), `[F]` = red circle (fail), subscript = phase number
- Phase bands below the timeline, color-coded by severity
- Phase annotation: matched pattern, linked ticket, fix PR, verification status
- Hover on a build circle shows: build ID, error_extract, error_signature, timestamp

### 6.3 Data source

```js
// useStreaks.js hook
const { data: streaks } = useRealtimeTable('failure_streaks', {
  filters: { status: 'active' }, // or 'all' for history
  select: '*',
  order: { column: 'started_at', ascending: false },
  limit: 20,
})

// useFailureTimeline.js hook (for the timeline view of a specific job)
const { data: timeline } = useRealtimeTable('v_failure_timeline', {
  filters: { job_name: selectedJob },
  order: { column: 'started_at', ascending: false },
  limit: 60, // ~2 months of daily builds
})
```

### 6.4 Streak detail panel

Clicking a streak opens a detail panel (reuse the TicketDetail sheet pattern):

- **Header:** Job name, streak duration, phase count
- **Phase timeline:** Visual step indicator showing each phase with:
  - Error signature (abbreviated)
  - Matched pattern or Claude analysis summary
  - Linked ticket with status badge
  - Fix PR with merge status
  - "Signature cleared" indicator (green checkmark if the specific error stopped appearing)
- **Upstream commits:** Collapsible list of commits from watched repos during the streak window, with GitHub links
- **Analysis summary:** Claude-generated narrative (if available)
- **Raw build list:** Table of all builds in the streak with links to Prow/Jenkins

---

## 7. Changes to Existing Code

### 7.1 `jobs/ingest.ts` -- Minor changes

Add `log_fetched` column to the builds upsert (default false, no behavior change):

```typescript
// In the INSERT INTO builds ... VALUES clause, add log_fetched
// No functional change -- the column defaults to false
```

### 7.2 `jobs/resolution-tracker.ts` -- Phase 3 addition

Add streak status update logic after the existing Phase 1 (PR merge) and Phase 2 (verification) complete:

```typescript
// Phase 3: Update streak status based on phase verification
async function updateStreakStatuses(): Promise<{ updated: number }> {
  const result = { updated: 0 };

  const streakRes = await query(
    `SELECT id, phases FROM failure_streaks WHERE status = 'active'`
  );

  for (const streak of streakRes.rows) {
    const phases = streak.phases as Array<{ fix_verified?: boolean }>;
    const allVerified = phases.length > 0 && phases.every(p => p.fix_verified);
    const someVerified = phases.some(p => p.fix_verified);

    const newStatus = allVerified ? 'resolved' : someVerified ? 'partial_fix' : 'active';
    if (newStatus !== 'active') {
      await query(
        `UPDATE failure_streaks SET status = $2 WHERE id = $1`,
        [streak.id, newStatus]
      );
      result.updated++;
    }
  }

  return result;
}
```

### 7.3 `jobs/retention-cleanup.ts` -- Add build_logs cleanup

```typescript
// Nullify log_text after 30 days (keep error_extract)
await query(`UPDATE build_logs SET log_text = NULL WHERE fetched_at < now() - INTERVAL '30 days' AND log_text IS NOT NULL`);
// Delete failure_streaks older than 180 days
await query(`DELETE FROM failure_streaks WHERE created_at < now() - INTERVAL '180 days'`);
```

---

## 8. Risks and Trade-offs

### 8.1 GCS log availability

Prow GCS artifacts are retained for ~90 days. The streak analyzer should fetch logs promptly (within the first run after ingestion). If a build is ingested but the CronJob is down for >90 days, the log is lost. **Mitigation:** The error_extract in build_logs is retained indefinitely; only the full log_text is subject to 30-day retention.

### 8.2 Error signature stability

The phase detection algorithm assumes error_signature changes indicate a new root cause. But error_signature is computed from the *first* test failure's normalized error message. If the same root cause produces slightly different error messages across runs (e.g., different resource names), it would appear as a spurious phase change. **Mitigation:** The normalization already strips UUIDs, timestamps, hex addresses, and line numbers. Monitor for false phase changes in the first 2 weeks and tune normalization if needed.

### 8.3 Claude API dependency

The Claude API call is optional and non-blocking. If the API is down or the key is invalid, the streak analyzer logs the error and continues. Streak detection, log fetching, and commit correlation all work without it. The analysis_summary field simply remains NULL. **Mitigation:** The `ANTHROPIC_API_KEY` env var is optional. If unset, skip Claude calls entirely.

### 8.4 Multiple jobs with overlapping streaks

The design tracks streaks per job_name independently. If two different jobs fail for the same root cause, they produce separate streaks. This is intentional -- the jobs may have different failure signatures and different fix timelines. Cross-job correlation is a future enhancement.

### 8.5 Streak detection latency

With ingestion at */5 and streak analysis at */15 (offset 7), a new failure streak is detected at most 22 minutes after the build completes. For nightly jobs that run once per day, this latency is irrelevant.

---

## 9. Implementation Plan

### Phase A: Schema + Streak Detection (2-3 hours)

1. Write migration `20260810000009_failure_streaks.sql` with all new tables, columns, views, and enum values
2. Write `jobs/streak-analyzer.ts` with Phase 1 only (detect streaks, compute phases)
3. Add streak detection to seed data with the Aug 7-12 example
4. Test: `supabase db reset`, verify streak created with 3 phases

### Phase B: GCS Log Fetching (1-2 hours)

1. Add Phase 2 to streak-analyzer (GCS fetch, error extraction)
2. Test with a real Prow build ID against public GCS
3. Add `log_fetched` column handling to ingest.ts upsert

### Phase C: Signature-Cleared Detection (1-2 hours)

1. Add Phase 4 to streak-analyzer
2. Modify resolution-tracker Phase 3 for streak status updates
3. Test with seed data: PR #127 merged, verify CAPA-10 gets signature_cleared

### Phase D: Upstream Commit Correlation (1 hour)

1. Add Phase 3 to streak-analyzer (GitHub commits API)
2. Test with real repos and date ranges

### Phase E: Claude API Integration (1 hour)

1. Add `@anthropic-ai/sdk` to jobs/package.json
2. Add conditional Claude call in Phase 2 (when no known pattern matches)
3. Add streak summary generation for multi-phase streaks
4. Test with real unmatched failure logs

### Phase F: Frontend (3-4 hours)

1. Add `useStreaks.js` and `useFailureTimeline.js` hooks
2. Add "Failure Streaks" tab to PipelinePage
3. Build `FailureTimeline` component (horizontal timeline with phase bands)
4. Build `StreakDetail` panel (phases, upstream commits, analysis summary)
5. Add streak indicators to the existing TicketDetail view (link to parent streak)

### Phase G: Deployment (30 min)

1. Add `ANTHROPIC_API_KEY` to Secret/api-tokens
2. Add `WATCHED_REPOS` to ConfigMap/app-config
3. Add CronJob/streak-analyzer to namespace
4. Run migration on Postgres

**Total estimated effort: 10-14 hours across 2-3 days.**

Dependencies: Phase B, C, D can run in parallel after Phase A. Phase E depends on Phase B. Phase F depends on Phase A but can start in parallel with B-E for the timeline component.
