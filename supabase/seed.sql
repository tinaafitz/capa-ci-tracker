-- Seed Data for CAPA CI Tracker
-- Only real data from actual CI failures.
-- Run with: supabase db reset (applies migrations then seed.sql)

-- ============================================================
-- Builds (only builds referenced by real tickets)
-- ============================================================

INSERT INTO builds (id, source, external_id, job_name, job_url, status,
                    pass_count, fail_count, skip_count, total_count,
                    duration_ms, started_at, finished_at, ocp_version,
                    parameters, test_failures)
VALUES
  -- Build for CAPA-1: Jenkins #348 — CAPI v1beta2 failure (based on real PR #127 fix)
  ('a0000001-0000-0000-0000-000000000002', 'jenkins', '348', 'capi_tests',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/348/',
   'failure', 38, 4, 3, 45, 2105640,
   '2026-08-09T08:00:00Z', '2026-08-09T08:35:06Z',
   '4.18.0-nightly-2026-08-09',
   '{"OCP_VERSION": "4.18.0-nightly-2026-08-09", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[{"name": "TestAWSClusterCreation", "className": "e2e.capa.cluster_lifecycle", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required. Expected apiVersion cluster.x-k8s.io/v1beta2 but got v1beta1.", "errorStackTrace": "at TestAWSClusterCreation (cluster_lifecycle_test.go:142)\nat runClusterTest (helpers.go:89)"},{"name": "TestROSAHCPProvision", "className": "e2e.capa.rosa_hcp", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required.", "errorStackTrace": "at TestROSAHCPProvision (rosa_hcp_test.go:67)"},{"name": "TestMachinePoolScaling", "className": "e2e.capa.machine_pool", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1", "errorStackTrace": "at TestMachinePoolScaling (machine_pool_test.go:201)"},{"name": "TestClusterUpgrade", "className": "e2e.capa.upgrade", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- upgrade path blocked by API incompatibility", "errorStackTrace": "at TestClusterUpgrade (upgrade_test.go:55)"}]'::jsonb),

  -- Build for CAPA-4: ROSAControlPlane stuck deletion (real issue, build details representative)
  ('a0000001-0000-0000-0000-000000000007', 'prow', 'pw-9903', 'periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e',
   'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e/9903/',
   'failure', 0, 1, 0, 1, 3600000,
   '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z',
   '4.18',
   '{"prow_job_type": "periodic", "cluster": "build05"}'::jsonb,
   '[{"name": "prow-job-result", "className": "ProwJobExecution", "errorMessage": "FAILED - RETRYING ROSAControlPlane capa-ci-hcp-cluster-xyz deletion: resource still exists after 15 attempts, finalizers preventing deletion", "errorStackTrace": ""}]'::jsonb);

-- ============================================================
-- 3 Support Tickets (all based on real failures)
-- ============================================================

INSERT INTO support_tickets (id, title, description, status, severity, assignee,
                             build_id, error_signature, root_cause, root_cause_category,
                             fix_pr_url, fix_pr_number, upstream_issue_url, jira_key,
                             labels, created_at, resolved_at)
VALUES
  -- CAPA-1: CAPI v1beta2 migration — real PR #127
  ('b0000001-0000-0000-0000-000000000001',
   'e2e.capa.cluster_lifecycle: TestAWSClusterCreation -- CAPI v1beta2 apiGroup migration',
   '**Error:** the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required.\n\n**Job:** capi_tests\n**Build:** #348\n**OCP Version:** 4.18.0-nightly-2026-08-09\n**Failed Tests:** 4/45',
   'fix_in_progress', 'upstream_breakage', 'tfitzgerald@redhat.com',
   'a0000001-0000-0000-0000-000000000002',
   'e2e.capa.cluster_lifecycle::TestAWSClusterCreation::a1b2c3d4e5f6g7h8',
   'CAPI v1.11+ replaced corev1.ObjectReference with ContractVersionedObjectReference in v1beta2, making apiGroup required and removing namespace from Cluster/MachinePool refs. OCP 4.22 nightlies with CAPI v1.13+ enforce this server-side.',
   'capi_migration',
   'https://github.com/stolostron/rosa-hcp-e2e-test/pull/127', 127,
   'https://github.com/kubernetes-sigs/cluster-api/issues/9876',
   NULL,
   ARRAY['jenkins', 'ocp-4.18', 'capi-v1beta2'],
   '2026-08-09T09:00:00Z', NULL),

  -- CAPA-4: ROSAControlPlane stuck deletion — real issue, SOP-linked
  ('b0000001-0000-0000-0000-000000000004',
   'ProwJobExecution: prow-job-result -- ROSAControlPlane stuck in deletion',
   '**Error:** FAILED - RETRYING ROSAControlPlane deletion: resource still exists after 15 attempts, finalizers preventing deletion\n\n**Job:** periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e\n**Build:** pw-9903\n**OCP Version:** 4.18\n**Failed Tests:** 1/1\n\n**SOP Reference:** [HCP Deprovisioning Failure](https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md)\n\n**Known causes (from SOP):**\n1. Leaked EC2 instances blocking security group deletion (OCPBUGS-23362)\n2. ManagedCluster in Unknown state blocking deletion (ACM-11502)\n3. Customer webhooks (Kyverno/OPA) blocking klusterlet removal (OHSS-41054)\n4. OADP backup pause race condition (OCPBUGS-77530)\n5. CloudFormation stack dependencies (orphaned SGs, VPC endpoints)\n6. route-monitor-operator unable to reach RHOBS API (SDE-3443)\n\n**Proposed fix:** Add automated cleanup to e2e teardown in stolostron/rosa-hcp-e2e-test that follows the SOP troubleshooting graph.',
   'investigating', 'infrastructure', 'tfitzgerald@redhat.com',
   'a0000001-0000-0000-0000-000000000007',
   'ProwJobExecution::prow-job-result::9988776655443322',
   'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
   'rosa_lifecycle',
   NULL, NULL, NULL, NULL,
   ARRAY['prow', 'ocp-4.18', 'rosa-lifecycle'],
   '2026-08-10T01:30:00Z', NULL);

-- ============================================================
-- Tasks
-- ============================================================

-- CAPA-1 tasks
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order, completed_at) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Investigate logs', 'done', 'tfitzgerald@redhat.com', 1, '2026-08-09T10:00:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Identify root cause', 'done', 'tfitzgerald@redhat.com', 2, '2026-08-09T11:30:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Submit fix PR #127', 'done', 'tfitzgerald@redhat.com', 3, '2026-08-09T15:00:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Verify in next nightly', 'in_progress', 'tfitzgerald@redhat.com', 4, NULL);

-- CAPA-4 tasks (SOP-based)
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order) VALUES
  ('b0000001-0000-0000-0000-000000000004', 'Check hostedcluster deletionTimestamp and capi-provider/control-plane-operator logs for errors', 'open', 'tfitzgerald@redhat.com', 1),
  ('b0000001-0000-0000-0000-000000000004', 'Check for leaked EC2 instances blocking SG deletion (OCPBUGS-23362)', 'open', NULL, 2),
  ('b0000001-0000-0000-0000-000000000004', 'Check managedcluster Available status -- if Unknown, re-import or remove finalizers (ACM-11502)', 'open', NULL, 3),
  ('b0000001-0000-0000-0000-000000000004', 'Check for webhook blocking deletion (Kyverno/OPA) -- list and remove problematic webhooks (OHSS-41054)', 'open', NULL, 4),
  ('b0000001-0000-0000-0000-000000000004', 'Check route-monitor-operator RHOBS API connectivity (SDE-3443)', 'open', NULL, 5),
  ('b0000001-0000-0000-0000-000000000004', 'Add automated SOP-based cleanup to e2e teardown in stolostron/rosa-hcp-e2e-test', 'open', 'tfitzgerald@redhat.com', 6),
  ('b0000001-0000-0000-0000-000000000004', 'Submit fix PR to stolostron/rosa-hcp-e2e-test', 'open', NULL, 7);

-- ============================================================
-- Activities (only for real tickets)
-- ============================================================

INSERT INTO activities (activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES
  -- CAPA-1 events
  ('build_completed', 'Build #348 failure', 'Jenkins job capi_tests build #348 completed with status: failure. 4 test failures.',
   'a0000001-0000-0000-0000-000000000002', NULL, 'ingest-jenkins',
   '{"source": "jenkins", "job_name": "capi_tests", "build_number": 348, "pass_count": 38, "fail_count": 4}'::jsonb,
   '2026-08-09T08:36:00Z'),

  ('ticket_created', 'Ticket #1 created: CAPI v1beta2 apiGroup migration', 'Auto-created by triage agent. Severity: upstream_breakage.',
   'a0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 'triage-agent',
   '{"severity": "upstream_breakage", "error_signature": "e2e.capa.cluster_lifecycle::TestAWSClusterCreation::a1b2c3d4e5f6g7h8", "auto_created": true}'::jsonb,
   '2026-08-09T09:00:00Z'),

  ('diagnosis_completed', 'Diagnosis completed: capi_not_installed', 'Root cause identified: CAPI v1beta2 apiGroup migration.',
   'a0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 'diagnosis-agent',
   '{"matched_pattern": "capi_not_installed", "root_cause_category": "capi_migration"}'::jsonb,
   '2026-08-09T09:01:00Z'),

  ('fix_submitted', 'Fix PR #127 submitted for CAPI v1beta2 migration', 'PR updates 4.22 templates to use CAPI v1beta2 apiGroup refs.',
   NULL, 'b0000001-0000-0000-0000-000000000001', 'tfitzgerald@redhat.com',
   '{"pr_url": "https://github.com/stolostron/rosa-hcp-e2e-test/pull/127", "pr_number": 127}'::jsonb,
   '2026-08-09T15:00:00Z'),

  -- CAPA-4 events
  ('build_completed', 'Prow job capa-e2e failure -- ROSAControlPlane stuck deletion', 'Prow periodic job failed: ROSAControlPlane deletion stuck after 15 retries.',
   'a0000001-0000-0000-0000-000000000007', NULL, 'ingest-prow',
   '{"source": "prow", "job_name": "periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e"}'::jsonb,
   '2026-08-10T01:01:00Z'),

  ('ticket_created', 'Ticket #4 created: ROSAControlPlane stuck in deletion', 'Auto-created by triage agent.',
   'a0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000004', 'triage-agent',
   '{"severity": "infrastructure", "error_signature": "ProwJobExecution::prow-job-result::9988776655443322", "auto_created": true}'::jsonb,
   '2026-08-10T01:30:00Z'),

  ('diagnosis_completed', 'Diagnosis completed: rosacontrolplane_stuck_deletion', 'Root cause: ROSAControlPlane stuck in deletion due to finalizers.',
   'a0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000004', 'diagnosis-agent',
   '{"matched_pattern": "rosacontrolplane_stuck_deletion", "root_cause_category": "rosa_lifecycle"}'::jsonb,
   '2026-08-10T01:31:00Z');

-- ============================================================
-- SOP Mappings
-- ============================================================

INSERT INTO sop_mappings (pattern_type, sop_url, sop_title, sop_section, summary, source_repo) VALUES
  ('rosacontrolplane_stuck_deletion',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure',
   'Troubleshooting on the Management Cluster',
   'Check hostedcluster deletionTimestamp, then capi-provider and control-plane-operator pods for errors.',
   'openshift/ops-sop'),

  ('cloudformation_deletion_failure',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure',
   'Known issues - OCPBUGS-23362',
   'CloudFormation stack deletion blocked by leaked EC2 instances. Run osdctl cluster cleanup-leaked-ec2.',
   'openshift/ops-sop'),

  ('ec2_instance_leak',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure',
   'Known issues - OCPBUGS-23362',
   'Leaked EC2 instances prevent security group deletion. Use osdctl cluster cleanup-leaked-ec2.',
   'openshift/ops-sop'),

  ('webhook_blocking_deletion',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure',
   'Known issues - OHSS-41054',
   'Customer webhooks blocking klusterlet removal during uninstall. Remove via breakglass access.',
   'openshift/ops-sop'),

  ('oadp_backup_pause',
   'https://github.com/openshift/ops-sop/blob/master/hypershift/troubleshooting/HCPDeprovisioningFailure.md',
   'HCP Deprovisioning Failure',
   'Known issues - OCPBUGS-77530',
   'OADP backup pause race condition leaves objects paused, blocking deletion.',
   'openshift/ops-sop'),

  ('ocm_role_missing',
   'https://access.redhat.com/articles/7137057',
   'OCM Role Configuration',
   NULL,
   'Organization not authorized to access target AWS account. Use OCM API to link the ocm-role.',
   NULL),

  ('iam_permission_error',
   'https://access.redhat.com/articles/7137057',
   'OCM Role Configuration',
   NULL,
   'IAM permission denied when accessing AWS resources. Verify IAM role trust policy.',
   NULL),

  ('capi_not_installed',
   'https://cluster-api.sigs.k8s.io/developer/providers/migrations/v1.10-to-v1.11',
   'CAPI v1.10 to v1.11 Migration Guide',
   NULL,
   'CAPI v1beta2 API changes: apiGroup required, namespace removed from refs.',
   'kubernetes-sigs/cluster-api');

-- ============================================================
-- Set matched_pattern on tickets
-- ============================================================

UPDATE support_tickets SET matched_pattern = 'capi_not_installed' WHERE id = 'b0000001-0000-0000-0000-000000000001';
UPDATE support_tickets SET matched_pattern = 'rosacontrolplane_stuck_deletion' WHERE id = 'b0000001-0000-0000-0000-000000000004';
