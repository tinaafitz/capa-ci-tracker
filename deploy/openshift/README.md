# OpenShift Deployment

Deploys the CAPA CI Tracker to an existing OpenShift 4.x cluster behind Red Hat VPN.
This replaces Supabase with self-hosted Postgres, PostgREST, and OCP OAuth.

## Prerequisites

- `oc` CLI authenticated to the target cluster
- `podman` or `docker` for building container images
- Access to the cluster's internal image registry
- VPN connected (required for Jenkins ingestion)

## Architecture

```
Browser --> Route (edge TLS) --> oauth-proxy:4180 --> nginx:8080 (static files)
                                                        |
                                                        +--> /api/* --> PostgREST:3000
                                                                            |
                                                                            v
CronJob/ingest-jenkins  --|                                          Postgres:5432
CronJob/ingest-prow     --|-----> direct pg connection ------------->     |
CronJob/resolution-tracker |                                             |
CronJob/retention-cleanup -|                                          PVC 20Gi
```

## Step 1: Update Secrets

Edit the Secret manifests with real values before deploying.

**`secret-db-credentials.yaml`:**
Generate a strong password and update both `POSTGRES_PASSWORD` and the password
portion of `PGRST_DB_URI`:

```bash
DB_PASSWORD=$(openssl rand -base64 24)
echo "POSTGRES_PASSWORD: $DB_PASSWORD"
echo "PGRST_DB_URI: postgresql://app_user:${DB_PASSWORD}@postgres:5432/capa_ci_tracker"
```

**`secret-api-tokens.yaml`:**
- `JENKINS_USER` / `JENKINS_API_TOKEN` -- Jenkins service account credentials
- `GITHUB_PAT` -- GitHub personal access token with `repo` scope
- `SLACK_WEBHOOK_URL` -- Slack incoming webhook URL for notifications

**`deployment-frontend.yaml`:**
Generate the oauth-proxy cookie secret:

```bash
openssl rand -base64 32
```

Replace the `--cookie-secret=CHANGEME_GENERATE_WITH_...` arg in the oauth-proxy container.

## Step 2: Update Placeholders

**`route-frontend.yaml`:**
Replace `CLUSTER_DOMAIN` with your cluster's apps domain (e.g., `ocp4.example.com`).

**`configmap-postgrest.yaml`:**
Replace `CLUSTER_DOMAIN` in `PGRST_OPENAPI_SERVER_PROXY_URI` to match the Route host.

**`configmap-app.yaml`:**
Review and update the `JENKINS_JOBS` and `PROW_JOBS` lists to match the jobs
your team needs to track.

## Step 3: Build Container Images

### Frontend image

```bash
cd frontend/
podman build -t capa-ci-tracker/frontend:latest .
```

The Dockerfile should be a multi-stage build: `node:22-alpine` for `npm run build`,
then copy `dist/` into `nginx:1.27-alpine`. The nginx config is mounted from the
`nginx-config` ConfigMap at runtime, so do not bake it into the image.

### Jobs image

```bash
cd jobs/
podman build -t capa-ci-tracker/jobs:latest .
```

Base: `node:22-alpine`. Install dependencies (`npm ci`), copy TypeScript source.
Entry point varies per CronJob via the `command` field in each manifest.

### Push to internal registry

```bash
# Log in to the cluster registry
oc registry login

# Tag and push
REGISTRY=$(oc registry info)
podman tag capa-ci-tracker/frontend:latest $REGISTRY/capa-ci-tracker/frontend:latest
podman tag capa-ci-tracker/jobs:latest $REGISTRY/capa-ci-tracker/jobs:latest
podman push $REGISTRY/capa-ci-tracker/frontend:latest
podman push $REGISTRY/capa-ci-tracker/jobs:latest
```

## Step 4: Deploy with Kustomize

```bash
# Preview what will be created
oc apply -k deploy/openshift/ --dry-run=client -o yaml | less

# Apply all resources in dependency order
oc apply -k deploy/openshift/
```

## Step 5: Run Database Migrations

Wait for the Postgres pod to be ready, then apply the migrations. Per the design
doc, apply migrations 001 (schema), 002 (triggers), 003 (views), and 007
(sop_mappings). Skip 004 (RLS), 005 (pg_cron), and 006 (retention cron) --
those are replaced by OCP-native equivalents.

```bash
# Wait for postgres to be ready
oc wait --for=condition=ready pod -l app.kubernetes.io/name=postgres --timeout=120s

# Apply migrations in order
POSTGRES_POD=$(oc get pod -l app.kubernetes.io/name=postgres -o jsonpath='{.items[0].metadata.name}')

oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker < supabase/migrations/20260810000001_initial_schema.sql
oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker < supabase/migrations/20260810000002_triggers.sql
oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker < supabase/migrations/20260810000003_views.sql
oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker < supabase/migrations/20260810000007_sop_mappings.sql
```

**Note:** Migration 001 contains Supabase-specific SQL (`GRANT ... TO anon,
authenticated, service_role` and `auth.check_redhat_domain()`). These statements
will fail on plain Postgres but the rest of the migration will succeed because
each statement runs independently in psql. The init SQL in the `postgres-init`
ConfigMap creates the correct PostgREST roles (`postgrest_anon`, `app_user`)
with the right grants via `ALTER DEFAULT PRIVILEGES`, so tables created by
the migrations automatically get the correct permissions.

If you prefer a clean run with no errors, create an OCP-specific copy of
migration 001 with the Supabase-specific lines removed.

## Step 6: Verify

```bash
# Check all pods are running
oc get pods

# Verify PostgREST can reach Postgres
oc exec deploy/postgrest -- wget -qO- http://localhost:3000/ | head

# Verify the frontend Route
curl -I https://capa-ci-tracker.apps.CLUSTER_DOMAIN/

# Check CronJob status after first scheduled run
oc get cronjobs
oc get jobs --sort-by=.metadata.creationTimestamp | tail -5

# View logs from the most recent ingest-jenkins job
oc logs job/$(oc get jobs -l app.kubernetes.io/name=ingest-jenkins --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
```

## Day 2 Operations

### Viewing CronJob logs

```bash
# Most recent run of a specific job
oc logs job/$(oc get jobs -l app.kubernetes.io/name=ingest-jenkins \
  --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')

# Stream logs from all jobs pods
oc logs -l app.kubernetes.io/component=jobs --tail=50
```

### Database backup

```bash
POSTGRES_POD=$(oc get pod -l app.kubernetes.io/name=postgres -o jsonpath='{.items[0].metadata.name}')
oc exec $POSTGRES_POD -- pg_dump -U app_user capa_ci_tracker > backup_$(date +%Y%m%d).sql
```

### Database restore

```bash
oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker < backup_20260812.sql
```

### Updating container images

```bash
# Rebuild and push
podman build -t $REGISTRY/capa-ci-tracker/frontend:latest frontend/
podman push $REGISTRY/capa-ci-tracker/frontend:latest

# Restart the deployment to pick up the new image
oc rollout restart deployment/frontend

# For jobs, the next CronJob run will pull the new image automatically
# (imagePullPolicy defaults to Always for :latest tags)
```

### Scaling

```bash
# Scale PostgREST or frontend replicas
oc scale deployment/postgrest --replicas=3
oc scale deployment/frontend --replicas=3
```

### Health check query

```bash
oc exec -i $POSTGRES_POD -- psql -U app_user -d capa_ci_tracker -c "
  SELECT source,
         max(created_at) AS last_ingested,
         now() - max(created_at) AS lag
  FROM builds
  GROUP BY source;
"
```

## Resource Summary

| Resource | File | Replicas | Image |
|---|---|---|---|
| Namespace | `namespace.yaml` | -- | -- |
| ServiceAccount | `serviceaccount-frontend.yaml` | -- | -- |
| Secret | `secret-db-credentials.yaml` | -- | -- |
| Secret | `secret-api-tokens.yaml` | -- | -- |
| ConfigMap | `configmap-postgres-init.yaml` | -- | -- |
| ConfigMap | `configmap-postgrest.yaml` | -- | -- |
| ConfigMap | `configmap-app.yaml` | -- | -- |
| ConfigMap | `configmap-nginx.yaml` | -- | -- |
| StatefulSet | `statefulset-postgres.yaml` | 1 | `postgres:16-alpine` |
| Service | `service-postgres.yaml` | -- | -- |
| Deployment | `deployment-postgrest.yaml` | 2 | `postgrest/postgrest:v12.2.3` |
| Service | `service-postgrest.yaml` | -- | -- |
| Deployment | `deployment-frontend.yaml` | 2 | `frontend:latest` + `ose-oauth-proxy:v4.14` |
| Service | `service-frontend.yaml` | -- | -- |
| CronJob | `cronjob-ingest-jenkins.yaml` | -- | `jobs:latest` |
| CronJob | `cronjob-ingest-prow.yaml` | -- | `jobs:latest` |
| CronJob | `cronjob-resolution-tracker.yaml` | -- | `jobs:latest` |
| CronJob | `cronjob-retention-cleanup.yaml` | -- | `jobs:latest` |
| Route | `route-frontend.yaml` | -- | -- |
