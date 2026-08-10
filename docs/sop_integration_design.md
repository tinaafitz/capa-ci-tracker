# SOP Integration Design

> **Status:** Approved
> **Dependencies:** diagnosis Edge Function, support_tickets table, Ticket Detail UI

---

## Overview

When the diagnosis agent matches a CI failure to a known issue pattern, the tracker surfaces relevant Standard Operating Procedures (SOPs) and troubleshooting runbooks directly in the ticket detail view. This gives engineers immediate access to remediation steps without searching across GitHub repos, Confluence, or KB articles.

**Design principle:** Links-first, not content-first. SOPs live in external systems (GitHub, Red Hat KB, Confluence) that are the source of truth. The tracker stores references (URL + summary), not full content. This eliminates sync/staleness problems and is maintainable by a 4-person team.

---

## Schema

### New Table: `sop_mappings`

Maps known-issue pattern types (the 12+ patterns in the diagnosis Edge Function's `KNOWN_ISSUES` array) to SOP references. Many-to-many: one pattern can link to multiple SOPs, and one SOP can cover multiple patterns.

```sql
CREATE TABLE sop_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type    TEXT NOT NULL,           -- matches KNOWN_ISSUES[].type
  sop_url         TEXT NOT NULL,           -- canonical URL (GitHub permalink, KB article, etc.)
  sop_title       TEXT NOT NULL,           -- human-readable title
  sop_section     TEXT,                    -- anchor or section name within the SOP
  summary         TEXT,                    -- 1-2 sentence TL;DR surfaced in ticket detail
  source_repo     TEXT,                    -- e.g. 'openshift/ops-sop' for provenance tracking
  last_verified   TIMESTAMPTZ,            -- last time a human confirmed the link is valid
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sop_mappings_pattern_url_uq UNIQUE (pattern_type, sop_url)
);

CREATE INDEX idx_sop_mappings_pattern_type ON sop_mappings (pattern_type);
```

### Schema Change: `support_tickets`

Add `matched_pattern TEXT` column. The diagnosis agent already computes this value (`KNOWN_ISSUES[].type`) but currently only stores it in `activities.metadata`. Persisting it on the ticket enables a direct join to `sop_mappings` without traversing the activities table.

```sql
ALTER TABLE support_tickets ADD COLUMN matched_pattern TEXT;
CREATE INDEX idx_tickets_matched_pattern ON support_tickets (matched_pattern)
  WHERE matched_pattern IS NOT NULL;
```

### Join Path

```
support_tickets.matched_pattern --> sop_mappings.pattern_type
```

No foreign key constraint -- `pattern_type` is a soft reference. SOPs can exist for patterns not yet seen, and tickets can have patterns with no SOP yet. Both are valid states.

---

## Data Flow

### Write Path

1. **Initial seed:** Migration inserts ~15-20 rows mapping existing known-issue types to their SOPs.
2. **Ongoing maintenance:** Engineers add/edit rows through the Supabase table editor or a simple admin form in the UI. Low ceremony -- a new SOP mapping is one INSERT with 4-5 fields.
3. **Staleness monitoring:** `last_verified` column tracks when a human last confirmed the URL works. Optional: the resolution-tracker cron can do a daily HEAD request against URLs with `last_verified > 30 days` and flag 404s.

### Read Path

1. Diagnosis agent matches a failure to `KNOWN_ISSUES[].type` (existing behavior).
2. Diagnosis agent writes `matched_pattern` to `support_tickets` (new -- one line added to the update payload).
3. Frontend ticket detail queries `sop_mappings WHERE pattern_type = ticket.matched_pattern`.
4. Results rendered in the Diagnosis tab as SOP reference cards.

---

## Seed Data

Initial mappings based on the 12 known-issue patterns and real SOPs:

| pattern_type | sop_title | sop_url | sop_section |
|---|---|---|---|
| `rosacontrolplane_stuck_deletion` | HCP Deprovisioning Failure | `github.com/openshift/ops-sop/.../HCPDeprovisioningFailure.md` | ROSAControlPlane stuck deletion |
| `cloudformation_deletion_failure` | HCP Deprovisioning Failure | `github.com/openshift/ops-sop/.../HCPDeprovisioningFailure.md` | CloudFormation stack deletion |
| `vpc_deletion_failure` | HCP Deprovisioning Failure | `github.com/openshift/ops-sop/.../HCPDeprovisioningFailure.md` | VPC deletion dependencies |
| `rosanetwork_stuck_deletion` | HCP Deprovisioning Failure | `github.com/openshift/ops-sop/.../HCPDeprovisioningFailure.md` | ROSANetwork stuck deletion |
| `rosaroleconfig_stuck_deletion` | HCP Deprovisioning Failure | `github.com/openshift/ops-sop/.../HCPDeprovisioningFailure.md` | ROSARoleConfig stuck deletion |
| `iam_permission_error` | OCM Role Configuration Guide | `access.redhat.com/articles/7137057` | IAM permission requirements |
| `ocm_auth_failure` | OCM Authentication Troubleshooting | `access.redhat.com/articles/7137057` | OCM authentication |
| `capi_not_installed` | CAPI Installation Guide | `github.com/kubernetes-sigs/cluster-api/blob/main/docs/book/src/tasks/installation.md` | Verifying CAPI installation |

Remaining patterns (`api_rate_limit`, `resource_quota_exceeded`, `networking_configuration_error`, `repeated_timeouts`) have no established SOPs yet -- rows will be added as SOPs are written.

---

## Diagnosis Agent Change

In `supabase/functions/diagnosis/index.ts`, add `matched_pattern` to the ticket update payload:

```ts
// Current:
const updatePayload: Record<string, unknown> = {
  root_cause: diagnosisResult.root_cause,
  root_cause_category: diagnosisResult.root_cause_category,
};

// Updated:
const updatePayload: Record<string, unknown> = {
  root_cause: diagnosisResult.root_cause,
  root_cause_category: diagnosisResult.root_cause_category,
  matched_pattern: diagnosisResult.matched_pattern,  // <-- NEW
};
```

No other agent changes needed. The `matched_pattern` value already exists in the `DiagnosisResult` interface.

---

## Frontend

### Query

```ts
// New hook: useSopMappings.ts
function useSopMappings(matchedPattern: string | null) {
  const [sops, setSops] = useState([]);

  useEffect(() => {
    if (!matchedPattern) return;
    supabase
      .from('sop_mappings')
      .select('*')
      .eq('pattern_type', matchedPattern)
      .order('created_at')
      .then(({ data }) => setSops(data || []));
  }, [matchedPattern]);

  return sops;
}
```

No Realtime subscription needed -- SOP mappings change rarely (admin action, not automated).

### Placement

SOPs appear in the **Diagnosis tab** of the Ticket Detail sheet, between the auto-diagnosis result and the notes thread:

```
+------------------------------------------+
| Diagnosis                                |
|                                          |
| Pattern: rosacontrolplane_stuck_deletion |
| Root cause: ROSAControlPlane stuck in    |
|   deletion state due to finalizers...    |
|                                          |
| Related SOPs:                            |
| +--------------------------------------+ |
| | [book] HCP Deprovisioning Failure    | |
| |   ROSAControlPlane stuck deletion    | |
| |   "Check hostedcluster deletion-     | |
| |   Timestamp, verify operator logs"   | |
| |                    [Open in GitHub]  | |
| +--------------------------------------+ |
| | [book] Red Hat KB #7137057           | |
| |   IAM permission requirements        | |
| |                        [Open in KB]  | |
| +--------------------------------------+ |
|                                          |
| Notes:                                   |
| ...                                      |
+------------------------------------------+
```

Each SOP card: title (bold), section (muted), summary (2-line truncation), external link button. Compact, non-collapsible. Uses existing Card/Badge components from shadcn/ui.

If no SOPs exist for the matched pattern: render nothing (no empty state -- absence is not informative for patterns without SOPs yet).

---

## Implementation Phases

| Phase | Scope | Effort | Dependencies |
|---|---|---|---|
| 1. Migration | `sop_mappings` table + `matched_pattern` column + seed data + RLS + grants | 1 migration file | None |
| 2. Diagnosis agent | Add `matched_pattern` to ticket update payload | 1 line change | Phase 1 deployed |
| 3. Frontend | `useSopMappings` hook + `SopCards` component in Diagnosis tab | 2 small files | Phase 1 deployed |
| 4. Staleness check | Daily URL HEAD check in resolution-tracker | Optional, low priority | Phase 1 |

Total effort: half a day for phases 1-3. Phase 4 is future work.

---

## What This Design Explicitly Avoids

| Approach | Why Not |
|---|---|
| Full SOP content sync into Postgres | Creates stale-content maintenance burden. Source-of-truth is GitHub/KB. |
| GitHub webhook for auto-update | Mapping is URL-to-pattern, not content. URLs rarely change. Webhook infra cost > value. |
| AI/LLM-based SOP matching | 12-20 deterministic pattern mappings don't need fuzzy matching. Adds latency and unpredictability. |
| Confluence/wiki scraping | Manual URL entry takes 30 seconds. Scraper maintenance is not justified for <50 SOPs. |
| Full-text search across SOPs | Would require content ingestion + search index. Overkill at this scale. |

---

## Concrete Walk-Through

**Scenario:** CAPI v1beta2 migration breaks nightly (the example from the system prompt).

1. Jenkins nightly fails. `ingest-jenkins` picks it up, inserts build with `status='failure'`.
2. `triage` creates ticket CAPA-315 with `severity='nightly_blocker'`.
3. `diagnosis` matches `capi_not_installed` pattern (CAPI controllers not running due to version mismatch). Writes `matched_pattern='capi_not_installed'`, `root_cause='CAPI/CAPA controllers not installed or running'`, `root_cause_category='capi_setup'` to the ticket.
4. Engineer opens CAPA-315 in the UI. Ticket detail loads. Frontend queries `sop_mappings WHERE pattern_type = 'capi_not_installed'`.
5. One result: "CAPI Installation Guide" with link to upstream docs. Rendered in Diagnosis tab.
6. Engineer clicks through, follows the guide, confirms the issue is an upstream API change, submits fix PR.

**Scenario:** ROSAControlPlane stuck deletion.

1. Build fails with `FAILED - RETRYING...ROSAControlPlane...deletion` in error message.
2. Diagnosis matches `rosacontrolplane_stuck_deletion`. Writes to ticket.
3. Frontend finds 2 SOP mappings: HCP Deprovisioning Failure SOP (GitHub) and a related KB article.
4. Engineer follows the SOP: checks hostedcluster deletionTimestamp, checks operator logs, identifies a leaked EC2 instance blocking CloudFormation stack deletion.
