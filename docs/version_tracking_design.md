# Component Version Tracking -- Design Document

> **Status:** Proposed
> **Depends on:** `builds` table, `ingest-jenkins`, `ingest-prow` Edge Functions

---

## Problem

When OCP 4.22 nightlies picked up CAPI v1.13+, the team found out through CI failure. Version tracking lets the system detect "this build uses a CAPI version we have never seen before" and surface that fact *before* or *alongside* the failure.

---

## Design

### Schema

One new table. No changes to existing tables -- version data is extracted from builds at ingestion time and stored separately, keeping `builds` unchanged.

```sql
CREATE TABLE component_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id        UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  component       TEXT        NOT NULL,  -- 'capi', 'ocp', 'capa', 'rosa_hcp'
  version         TEXT        NOT NULL,  -- '1.13.0', '4.22.0-nightly-2026-08-06'
  version_major   INT,                   -- 1, 4
  version_minor   INT,                   -- 13, 22
  first_seen      BOOLEAN     NOT NULL DEFAULT false,  -- set by trigger
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cv_build_component_uq UNIQUE (build_id, component)
);

CREATE INDEX idx_cv_component_version ON component_versions (component, version);
CREATE INDEX idx_cv_first_seen ON component_versions (first_seen) WHERE first_seen;
CREATE INDEX idx_cv_build_id ON component_versions (build_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON component_versions TO anon, authenticated, service_role;
```

RLS policy follows existing pattern (all authenticated, service_role bypasses).

One new view correlating version changes with build outcomes:

```sql
CREATE OR REPLACE VIEW v_version_timeline AS
SELECT
  cv.component,
  cv.version,
  cv.version_major,
  cv.version_minor,
  cv.first_seen,
  cv.created_at,
  b.id           AS build_id,
  b.job_name,
  b.source,
  b.status       AS build_status,
  b.started_at   AS build_started_at,
  b.fail_count,
  b.total_count
FROM component_versions cv
JOIN builds b ON cv.build_id = b.id
ORDER BY cv.created_at DESC;
```

### `first_seen` trigger

When a new row is inserted into `component_versions`, check whether this `(component, version)` pair has been seen before. If not, set `first_seen = true` and fire `pg_notify` so the notify agent can alert Slack.

```sql
CREATE OR REPLACE FUNCTION check_version_first_seen()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM component_versions
    WHERE component = NEW.component
      AND version = NEW.version
      AND id <> NEW.id
  ) THEN
    NEW.first_seen = true;
    PERFORM pg_notify('version_change', json_build_object(
      'component', NEW.component,
      'version',   NEW.version,
      'build_id',  NEW.build_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cv_first_seen
  BEFORE INSERT ON component_versions
  FOR EACH ROW
  EXECUTE FUNCTION check_version_first_seen();
```

### Data Flow: Where versions come from

Version extraction happens inside the existing ingestion Edge Functions. No new Edge Function needed.

**Jenkins** -- versions come from build parameters:

| Component | Source | Example |
|-----------|--------|---------|
| OCP | `parameters.OCP_VERSION` | `4.22.0-nightly-2026-08-06` |
| CAPI | `parameters.CAPI_VERSION` or parsed from test output | `1.13.0` |
| CAPA | `parameters.CAPA_VERSION` | `2.7.0` |
| ROSA HCP | `parameters.ROSA_HCP_VERSION` | `4.17.3` |

**Prow** -- versions come from job name + annotations:

| Component | Source | Example |
|-----------|--------|---------|
| OCP | Parsed from job name (`release-4.17`) | `4.17` |
| CAPI | `metadata.labels["ci.openshift.io/capi-version"]` or parsed from logs (future) | `1.13.0` |

**What if version info is unavailable?** Skip the insert for that component. The `component_versions` table is additive -- missing data just means fewer rows, not broken data. OCP version is almost always available (from `ocp_version` column on builds). CAPI version is the hardest to get and the most valuable -- it may require a dedicated extraction step from build logs in a later phase.

### Ingestion changes (pseudocode)

After the existing `builds` upsert in `ingest-jenkins`:

```typescript
// After successful build upsert, extract and insert versions
const versions: Array<{component: string, version: string}> = [];

if (ocpVersion) {
  versions.push({ component: 'ocp', version: ocpVersion });
}
if (parameters.CAPI_VERSION) {
  versions.push({ component: 'capi', version: parameters.CAPI_VERSION });
}
if (parameters.CAPA_VERSION) {
  versions.push({ component: 'capa', version: parameters.CAPA_VERSION });
}

for (const v of versions) {
  const parsed = parseVersion(v.version); // extract major/minor
  await supabase.from('component_versions').upsert({
    build_id: upsertedBuild.id,
    component: v.component,
    version: v.version,
    version_major: parsed.major,
    version_minor: parsed.minor,
  }, { onConflict: 'build_id,component' });
}
```

### Notification

The existing `notify` Edge Function already listens for `pg_notify` events via the `new_activity` channel. The `version_change` channel follows the same pattern. When the notify agent receives a `version_change` event, it posts a Slack message:

> **New component version detected**
> `capi` version `1.13.0` first seen in build `capi_tests #348` (OCP 4.22)
> Previous version: `1.12.2` (last seen 2026-08-05)
> Migration guide: https://cluster-api.sigs.k8s.io/developer/providers/migrations

The "previous version" is a simple query: `SELECT version FROM component_versions WHERE component = 'capi' AND first_seen AND created_at < :this_created_at ORDER BY created_at DESC LIMIT 1`.

### Migration guide links

Static map stored in the notify Edge Function (or a shared config). Not a database table -- this is a handful of entries maintained by the team.

```typescript
const MIGRATION_GUIDES: Record<string, string> = {
  'capi': 'https://cluster-api.sigs.k8s.io/developer/providers/migrations',
  'ocp':  'https://docs.openshift.com/container-platform/latest/release_notes/',
  'capa': 'https://github.com/kubernetes-sigs/cluster-api-provider-aws/releases',
};
```

### Frontend

**Build Detail view** -- add a "Component Versions" section showing the versions detected for that build. Highlight any `first_seen = true` with a "NEW" badge.

**Builds List view** -- add a filter chip for version changes: "Show builds with new versions" (`WHERE EXISTS (SELECT 1 FROM component_versions cv WHERE cv.build_id = b.id AND cv.first_seen)`).

**Ticket Detail view** -- when a ticket's originating build has `first_seen` versions, show a callout: "This failure coincides with first use of CAPI 1.13.0. [Migration guide]".

**No new page needed.** Version info is contextual -- it decorates existing views, not a standalone screen.

### Correlation logic

The `v_version_timeline` view makes correlation queryable:

```sql
-- "Did builds start failing when CAPI went from v1.12 to v1.13?"
SELECT
  version,
  count(*) FILTER (WHERE build_status = 'failure') AS failures,
  count(*) FILTER (WHERE build_status = 'success') AS successes,
  min(build_started_at) AS first_build,
  max(build_started_at) AS last_build
FROM v_version_timeline
WHERE component = 'capi'
GROUP BY version
ORDER BY min(build_started_at);
```

This is a query for human use (via the frontend or SQL console), not an automated agent. The system surfaces the data; the engineer draws the conclusion.

---

## Phasing

**MVP (Phase 1):**
- `component_versions` table + trigger + view
- Extract OCP version in ingestion (already available from `builds.ocp_version`)
- Extract CAPI/CAPA versions from Jenkins `parameters` (if present)
- `first_seen` badge on Build Detail
- Slack notification on `version_change`

**Phase 2:**
- Parse CAPI version from Prow build logs (requires fetching GCS artifacts)
- Version correlation chart on Builds page (failure rate by component version)
- Ticket Detail callout linking version change to failure

**Phase 3:**
- Automated "version change + failure" correlation in diagnosis agent
- Add `version_change` as a `root_cause_category` value
- Pre-emptive ticket creation when a version change is detected in a *passing* build (warning: "CAPI updated, watch for regressions")

---

## Risks

1. **CAPI version may not be in build parameters.** Jenkins jobs may not expose it. Mitigation: Phase 2 adds log parsing. Phase 1 works with whatever is available.
2. **False "first seen" on initial load.** When the system first starts, every version will be `first_seen`. Mitigation: seed `component_versions` with known historical versions, or suppress `first_seen` notifications for the first 24 hours after deployment.
3. **Noise from nightly OCP version churn.** Every nightly has a unique version string like `4.22.0-nightly-2026-08-06`. Mitigation: normalize to `major.minor` for comparison; store the full string but group by `version_major.version_minor`.
4. **Concurrent inserts of the same version.** Two builds ingested simultaneously could both think they are "first seen". Mitigation: the `BEFORE INSERT` trigger checks existence atomically within the same transaction. One will see the other's row and set `first_seen = false`. If both run truly concurrently, worst case is two Slack notifications -- acceptable for a 4-6 person team.
