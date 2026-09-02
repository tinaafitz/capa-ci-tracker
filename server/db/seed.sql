-- Seed Data for CAPA CI Tracker
-- Reflects ONLY today's real CI builds (2026-09-02). Both runs PASSED, so the
-- pipeline is legitimately empty: zero failure tickets, zero tasks, and only
-- build-level activities. seed-runner.ts rebases every timestamp column so the
-- newest event lands ~2h ago (see SEED_LATEST there).

-- ============================================================
-- Builds (2 total: today's real Prow + Jenkins runs, both success)
-- ============================================================

INSERT OR IGNORE INTO builds (id, source, external_id, job_name, job_url, status,
  pass_count, fail_count, skip_count, total_count, duration_ms,
  started_at, finished_at, ocp_version, parameters, test_failures, log_fetched, created_at, updated_at)
VALUES

-- Prow capa-e2e (success)
('b0000902-0000-0000-0000-000000000001', 'prow', '2095059539010260992',
 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2095059539010260992',
 'success', 1, 0, 0, 1, 5898000,
 '2026-09-02T08:00:45Z', '2026-09-02T09:39:03Z', NULL,
 '{"prow_job_type":"periodic"}', '[]', 0,
 '2026-09-02T09:39:03Z', '2026-09-02T09:39:03Z'),

-- Jenkins capi_tests (success)
('b0000902-0000-0000-0000-000000000002', 'jenkins', '330', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/330/',
 'success', 42, 0, 3, 45, 2160000,
 '2026-09-02T07:49:56Z', '2026-09-02T08:25:56Z', '4.19.0-nightly-2026-08-20',
 '{"OCP_VERSION":"4.19.0-nightly-2026-08-20","CLOUD_PROVIDER":"aws"}', '[]', 0,
 '2026-09-02T08:25:56Z', '2026-09-02T08:25:56Z');

-- ============================================================
-- Activities (build-level only, one build_completed per build)
-- Mirrors the ingest-prow / ingest-jenkins agent conventions
-- (activity_type='build_completed', title/description format, metadata shape).
-- No ticket_created / lifecycle activities: both builds passed.
-- ============================================================

INSERT OR IGNORE INTO activities (id, activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES

('ac000902-0000-0000-0000-000000000001', 'build_completed',
 'Prow job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e success',
 'Prow periodic job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e completed with status: success.',
 'b0000902-0000-0000-0000-000000000001', NULL, 'ingest-prow',
 '{"source":"prow","job_name":"periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e","build_id":"2095059539010260992","prow_state":"success"}',
 '2026-09-02T09:39:03Z'),

('ac000902-0000-0000-0000-000000000002', 'build_completed',
 'Build #330 success',
 'Jenkins job capi_tests build #330 completed with status: success. 0 test failures.',
 'b0000902-0000-0000-0000-000000000002', NULL, 'ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":330,"pass_count":42,"fail_count":0}',
 '2026-09-02T08:25:56Z');

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
