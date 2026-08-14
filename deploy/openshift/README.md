# CAPA CI Tracker -- OpenShift Deployment

Kustomize manifests for deploying the CAPA CI Tracker to OpenShift.

## Prerequisites

- `oc` CLI installed and logged into the target cluster
- Cluster-admin or permission to create namespaces, PVCs, and Routes
- The container image `ghcr.io/tinaafitz/capa-ci-tracker:latest` has been built and pushed

## 1. Fill in secrets

Edit `secret-env.yaml` and replace all `REPLACE_ME` values with real credentials,
or generate the secret directly:

```bash
oc create secret generic capa-ci-tracker-env \
  --from-literal=JENKINS_BASE_URL=https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests \
  --from-literal=JENKINS_USER=your-username \
  --from-literal=JENKINS_API_TOKEN=your-token \
  --from-literal=GITHUB_TOKEN=ghp_xxxxx \
  --from-literal=SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx \
  --from-literal=JENKINS_SKIP_TLS=true \
  --dry-run=client -o yaml > deploy/openshift/secret-env.yaml
```

## 2. Image pull secret (if ghcr.io package is private)

If the container image is in a private GitHub Package, create a pull secret:

```bash
oc create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=tinaafitz \
  --docker-password=<github-pat> \
  -n capa-ci-tracker
```

If the image is public, the `imagePullSecrets` reference in the Deployment is
harmless -- Kubernetes ignores a missing pull secret when the image is
publicly accessible.

## 3. Deploy

```bash
oc apply -k deploy/openshift/
```

This creates:
- Namespace `capa-ci-tracker`
- ServiceAccount, PVC (1 Gi), ConfigMap, Secret
- Deployment (1 replica), Service (ClusterIP :3001), Route (TLS edge)

## 4. Verify

```bash
# Wait for the pod to become ready
oc rollout status deployment/capa-ci-tracker -n capa-ci-tracker

# Get the route URL
oc get route capa-ci-tracker -n capa-ci-tracker -o jsonpath='{.spec.host}'
```

## 5. Seed initial data (optional)

```bash
oc exec deploy/capa-ci-tracker -n capa-ci-tracker -- node server/dist/seed-runner.js
```

## 6. Upgrade

Push a new image to `ghcr.io/tinaafitz/capa-ci-tracker:latest`, then:

```bash
oc rollout restart deployment/capa-ci-tracker -n capa-ci-tracker
```

Or, if manifests changed:

```bash
oc apply -k deploy/openshift/
```

## Architecture notes

- **Replicas: 1** -- SQLite is single-writer; horizontal scaling is not possible.
  The Deployment uses `strategy: Recreate` to avoid two pods mounting the PVC
  simultaneously.
- **Storage** -- A 1 Gi PVC is mounted at `/data` for the SQLite database and
  its WAL/SHM files.
- **Health checks** -- Liveness and readiness probes hit `GET /api/builds` on
  port 3001.
- **Security** -- The container runs as non-root (OCP assigns an arbitrary UID).
  No special SCCs are required.
- **Jenkins VPN** -- Because this runs on OpenShift inside the Red Hat network,
  the pod has direct access to the VPN-only Jenkins instance. Set
  `JENKINS_SKIP_TLS=true` if Jenkins uses a self-signed certificate.
