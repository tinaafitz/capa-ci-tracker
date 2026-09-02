-- Seed Data for CAPA CI Tracker
-- Reflects real CI builds spanning Aug 31 - Sep 2, 2026:
--   * Jenkins capi_tests #336 (Aug 31) FAILED at the Configure MCE Environment
--     stage (OCM_CLIENT_ID/OCM_CLIENT_SECRET build params empty -> rosa-creds-secret
--     creation failed; downstream feature/provision/teardown stages SKIPPED).
--   * Prow capa-e2e (Aug 31)  -- SUCCESS
--   * Jenkins capi_tests #330 (Sep 2) -- SUCCESS
--   * Prow capa-e2e (Sep 2)   -- SUCCESS
-- One pipeline ticket is created for the #336 failure (infra/auth config), sitting
-- at the first stage (status='new'). seed-runner.ts rebases every timestamp column
-- so the newest event lands ~2h ago (see SEED_LATEST there).

-- ============================================================
-- Builds (4 total: 1 failure + 3 success across Aug 31 - Sep 2)
-- ============================================================

INSERT OR IGNORE INTO builds (id, source, external_id, job_name, job_url, status,
  pass_count, fail_count, skip_count, total_count, duration_ms,
  started_at, finished_at, ocp_version, parameters, test_failures,
  failure_class, failure_reason, is_infra, log_fetched, created_at, updated_at)
VALUES

-- Build A -- Jenkins capi_tests #336 (FAILURE, Aug 31) -- Configure stage failed
('b0000831-0000-0000-0000-000000000336', 'jenkins', '336', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/336/',
 'failure', 0, 1, 9, 10, 95000,
 '2026-08-31T17:22:46Z', '2026-08-31T17:24:21Z', NULL,
 '{"OCP_HUB_API_URL":"https://api.ci-2171-post-push.dev09.red-chesterfield.com:6443","MCE_NAMESPACE":"multicluster-engine","OCM_CLIENT_ID":"","TEST_GIT_BRANCH":"release-2.17"}',
 '[{"name":"10-configure-mce-environment: Configure CAPI/CAPA environment (disable Hypershift, enable CAPI/CAPA, create credentials)","classname":"configure-capa-environment","message":"Ansible task ''Create rosa-creds-secret variables'' failed: ''OCM_CLIENT_ID'' is undefined (OCM_CLIENT_ID/OCM_CLIENT_SECRET build params empty). Cascading: Restore HyperShift (41-disable-capi-enable-hypershift) also failed: ''OCP_HUB_CLUSTER_PASSWORD'' is undefined."}]',
 'infra_auth', 'Configure MCE Environment failed: OCM_CLIENT_ID undefined (rosa-creds-secret creation)', 1, 0,
 '2026-08-31T17:24:21Z', '2026-08-31T17:24:21Z'),

-- Build B -- Prow capa-e2e (SUCCESS, Aug 31)
('b0000831-0000-0000-0000-000000000002', 'prow', '2094334776428204032',
 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2094334776428204032',
 'success', 1, 0, 0, 1, 5400000,
 '2026-08-31T08:00:46Z', '2026-08-31T09:30:46Z', NULL,
 '{"prow_job_type":"periodic"}', '[]',
 NULL, NULL, 0, 0,
 '2026-08-31T09:30:46Z', '2026-08-31T09:30:46Z'),

-- Build C -- Jenkins capi_tests #330 (SUCCESS, Sep 2)
('b0000902-0000-0000-0000-000000000002', 'jenkins', '330', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/330/',
 'success', 42, 0, 3, 45, 2160000,
 '2026-09-02T07:49:56Z', '2026-09-02T08:25:56Z', '4.19.0-nightly-2026-08-20',
 '{"OCP_VERSION":"4.19.0-nightly-2026-08-20","CLOUD_PROVIDER":"aws"}', '[]',
 NULL, NULL, 0, 0,
 '2026-09-02T08:25:56Z', '2026-09-02T08:25:56Z'),

-- Build D -- Prow capa-e2e (SUCCESS, Sep 2) -- newest event (SEED_LATEST anchor)
('b0000902-0000-0000-0000-000000000001', 'prow', '2095059539010260992',
 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2095059539010260992',
 'success', 1, 0, 0, 1, 5898000,
 '2026-09-02T08:00:45Z', '2026-09-02T09:39:03Z', NULL,
 '{"prow_job_type":"periodic"}', '[]',
 NULL, NULL, 0, 0,
 '2026-09-02T09:39:03Z', '2026-09-02T09:39:03Z');

-- ============================================================
-- Support Tickets (ONE ticket, for Build A / #336 infra-config failure)
-- Sits at the first pipeline stage (status='new'). resolved_at/verified_at
-- and diagnosed_at are intentionally left NULL. root_cause/category mirror
-- how the triage + diagnosis agents classify an OCM credential failure.
-- ============================================================

INSERT OR IGNORE INTO support_tickets (id, ticket_number, title, description, status,
  severity, assignee, build_id, error_signature, root_cause, root_cause_category,
  matched_pattern, failure_class, labels, created_at, updated_at)
VALUES
('70000831-0000-0000-0000-000000000336', 1,
 '[Infra] Configure MCE Environment: OCM_CLIENT_ID undefined -- rosa-creds-secret',
 '**CI Infrastructure Failure -- NOT a CAPA regression**' || char(10) || char(10) ||
 '**Class:** infra_auth' || char(10) ||
 '**Reason:** Configure MCE Environment stage failed because the OCM_CLIENT_ID/OCM_CLIENT_SECRET build parameters were empty, so the Ansible task that creates the rosa-creds-secret could not resolve its variables. The subsequent HyperShift restore step also failed on an undefined OCP_HUB_CLUSTER_PASSWORD. Feature, provision, and teardown stages were skipped.' || char(10) || char(10) ||
 '**Job:** capi_tests' || char(10) || '**Build:** #336' || char(10) ||
 '**Hub Cluster:** ci-2171-post-push.dev09 (MCE 5.0 RC)',
 'new', 'infrastructure', NULL,
 'b0000831-0000-0000-0000-000000000336',
 'infra::infra_auth::ddb59efff6a4b8f1',
 'Missing OCM_CLIENT_ID/OCM_CLIENT_SECRET credentials caused rosa-creds-secret creation to fail during Configure CAPI/CAPA environment.',
 'auth_credentials', 'ocm_auth_failure', 'infra_auth',
 '["jenkins","infra"]',
 '2026-08-31T17:24:21Z', '2026-08-31T17:24:21Z');

-- ============================================================
-- Tasks (default checklist for the #336 ticket, matching triage DEFAULT_TASKS)
-- ============================================================

INSERT OR IGNORE INTO tasks (id, ticket_id, title, status, sort_order, created_at) VALUES
  ('7a000831-0000-0000-0000-000000000001', '70000831-0000-0000-0000-000000000336',
   'Investigate logs', 'open', 1, '2026-08-31T17:24:21Z'),
  ('7a000831-0000-0000-0000-000000000002', '70000831-0000-0000-0000-000000000336',
   'Identify root cause', 'open', 2, '2026-08-31T17:24:21Z'),
  ('7a000831-0000-0000-0000-000000000003', '70000831-0000-0000-0000-000000000336',
   'Submit fix PR', 'open', 3, '2026-08-31T17:24:21Z'),
  ('7a000831-0000-0000-0000-000000000004', '70000831-0000-0000-0000-000000000336',
   'Verify in next nightly', 'open', 4, '2026-08-31T17:24:21Z');

-- ============================================================
-- Activities
--   * one build_completed per build (mirrors ingest-prow / ingest-jenkins)
--   * one ticket_created for the #336 ticket (mirrors triage agent)
-- ============================================================

INSERT OR IGNORE INTO activities (id, activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES

-- Build A (#336 failure)
('ac000831-0000-0000-0000-000000000001', 'build_completed',
 'Build #336 failure',
 'Jenkins job capi_tests build #336 completed with status: failure. 1 test failure.',
 'b0000831-0000-0000-0000-000000000336', NULL, 'ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":336,"pass_count":0,"fail_count":1}',
 '2026-08-31T17:24:21Z'),

-- Ticket created for #336
('ac000831-0000-0000-0000-000000000002', 'ticket_created',
 'Ticket #1 created: [Infra] Configure MCE Environment: OCM_CLIENT_ID undefined -- rosa-creds-secret',
 'Auto-created by triage agent. Severity: infrastructure. Error signature: infra::infra_auth::ddb59efff6a4b8f1',
 'b0000831-0000-0000-0000-000000000336', '70000831-0000-0000-0000-000000000336', 'triage-agent',
 '{"error_signature":"infra::infra_auth::ddb59efff6a4b8f1","severity":"infrastructure","failure_class":"infra_auth"}',
 '2026-08-31T17:24:21Z'),

-- Build B (Prow success, Aug 31)
('ac000831-0000-0000-0000-000000000003', 'build_completed',
 'Prow job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e success',
 'Prow periodic job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e completed with status: success.',
 'b0000831-0000-0000-0000-000000000002', NULL, 'ingest-prow',
 '{"source":"prow","job_name":"periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e","build_id":"2094334776428204032","prow_state":"success"}',
 '2026-08-31T09:30:46Z'),

-- Build C (Jenkins #330 success, Sep 2)
('ac000902-0000-0000-0000-000000000002', 'build_completed',
 'Build #330 success',
 'Jenkins job capi_tests build #330 completed with status: success. 0 test failures.',
 'b0000902-0000-0000-0000-000000000002', NULL, 'ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":330,"pass_count":42,"fail_count":0}',
 '2026-09-02T08:25:56Z'),

-- Build D (Prow success, Sep 2)
('ac000902-0000-0000-0000-000000000001', 'build_completed',
 'Prow job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e success',
 'Prow periodic job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e completed with status: success.',
 'b0000902-0000-0000-0000-000000000001', NULL, 'ingest-prow',
 '{"source":"prow","job_name":"periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e","build_id":"2095059539010260992","prow_state":"success"}',
 '2026-09-02T09:39:03Z');

-- ============================================================
-- SOP Mappings (reference data -- preserved as-is; do NOT create tickets)
-- ============================================================

INSERT OR IGNORE INTO sop_mappings (id, pattern_type, sop_url, sop_title, sop_section, summary, source_repo, last_verified, created_at, updated_at) VALUES
  ('e0000001-0000-0000-0000-000000000001', 'rosacontrolplane_stuck_deletion',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure', 'Troubleshooting on the Management Cluster',
   'Check hostedcluster deletionTimestamp, then capi-provider and control-plane-operator pods for errors.',
   'openshift/ops-sop', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000002', 'cloudformation_deletion_failure',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure', 'Known issues - OCPBUGS-23362',
   'CloudFormation stack deletion blocked by leaked EC2 instances. Run osdctl cluster cleanup-leaked-ec2.',
   'openshift/ops-sop', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000003', 'ec2_instance_leak',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure', 'Known issues - OCPBUGS-23362',
   'Leaked EC2 instances prevent security group deletion. Use osdctl cluster cleanup-leaked-ec2.',
   'openshift/ops-sop', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000004', 'webhook_blocking_deletion',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure', 'Known issues - OHSS-41054',
   'Customer webhooks blocking klusterlet removal during uninstall. Remove via breakglass access.',
   'openshift/ops-sop', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000005', 'oadp_backup_pause',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure', 'Known issues - OCPBUGS-77530',
   'OADP backup pause race condition leaves objects paused, blocking deletion.',
   'openshift/ops-sop', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000006', 'ocm_role_missing',
   'https://access.redhat.com/articles/7137057', 'OCM Role Configuration', NULL,
   'Organization not authorized to access target AWS account. Use OCM API to link the ocm-role.',
   NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000007', 'iam_permission_error',
   'https://access.redhat.com/articles/7137057', 'OCM Role Configuration', NULL,
   'IAM permission denied when accessing AWS resources. Verify IAM role trust policy.',
   NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000008', 'capi_not_installed',
   'https://cluster-api.sigs.k8s.io/developer/providers/migrations/v1.10-to-v1.11',
   'CAPI v1.10 to v1.11 Migration Guide', NULL,
   'CAPI v1beta2 API changes: apiGroup required, namespace removed from refs.',
   'kubernetes-sigs/cluster-api', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000009', 'rosa_network_timeout',
   'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html',
   'CloudFormation Troubleshooting', 'Stack creation timeout',
   'CloudFormation stack creation stalling during subnet creation. Check AWS API rate limits and retry.',
   NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('e0000001-0000-0000-0000-000000000010', 'build_farm_failure',
   'https://docs.ci.openshift.org/docs/architecture/network/',
   'CI Cluster Network Architecture', NULL,
   'Prow build farm connectivity failure. Check #forum-testplatform and build farm status page.',
   'openshift/ci-docs', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z');
