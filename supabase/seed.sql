-- Seed Data for CAPA CI Tracker
-- Realistic sample data for local development and testing.
-- Run with: supabase db reset (applies migrations then seed.sql)

-- ============================================================
-- 10 Builds (mix of Jenkins/Prow, various statuses)
-- ============================================================

INSERT INTO builds (id, source, external_id, job_name, job_url, status,
                    pass_count, fail_count, skip_count, total_count,
                    duration_ms, started_at, finished_at, ocp_version,
                    parameters, test_failures)
VALUES
  -- Build 1: Jenkins success
  ('a0000001-0000-0000-0000-000000000001', 'jenkins', '347', 'capi_tests',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/347/',
   'success', 42, 0, 3, 45, 1847230,
   '2026-08-09T02:00:00Z', '2026-08-09T02:30:47Z',
   '4.17.0-nightly-2026-08-08',
   '{"OCP_VERSION": "4.17.0-nightly-2026-08-08", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[]'::jsonb),

  -- Build 2: Jenkins failure -- CAPI v1beta2 apiGroup migration
  ('a0000001-0000-0000-0000-000000000002', 'jenkins', '348', 'capi_tests',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/348/',
   'failure', 38, 4, 3, 45, 2105640,
   '2026-08-09T08:00:00Z', '2026-08-09T08:35:06Z',
   '4.18.0-nightly-2026-08-09',
   '{"OCP_VERSION": "4.18.0-nightly-2026-08-09", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[{"name": "TestAWSClusterCreation", "className": "e2e.capa.cluster_lifecycle", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required. Expected apiVersion cluster.x-k8s.io/v1beta2 but got v1beta1.", "errorStackTrace": "at TestAWSClusterCreation (cluster_lifecycle_test.go:142)\nat runClusterTest (helpers.go:89)"},{"name": "TestROSAHCPProvision", "className": "e2e.capa.rosa_hcp", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required.", "errorStackTrace": "at TestROSAHCPProvision (rosa_hcp_test.go:67)"},{"name": "TestMachinePoolScaling", "className": "e2e.capa.machine_pool", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1", "errorStackTrace": "at TestMachinePoolScaling (machine_pool_test.go:201)"},{"name": "TestClusterUpgrade", "className": "e2e.capa.upgrade", "errorMessage": "error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- upgrade path blocked by API incompatibility", "errorStackTrace": "at TestClusterUpgrade (upgrade_test.go:55)"}]'::jsonb),

  -- Build 3: Jenkins failure -- CloudFormation deletion
  ('a0000001-0000-0000-0000-000000000003', 'jenkins', '349', 'capa_nightly',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capa_nightly/349/',
   'failure', 40, 2, 3, 45, 3620100,
   '2026-08-09T22:00:00Z', '2026-08-09T23:00:20Z',
   '4.17.0-nightly-2026-08-09',
   '{"OCP_VERSION": "4.17.0-nightly-2026-08-09", "CLOUD_PROVIDER": "aws", "NIGHTLY": "true"}'::jsonb,
   '[{"name": "TestClusterCleanup", "className": "e2e.capa.cleanup", "errorMessage": "CloudFormation stack DELETE_FAILED: capa-ci-vpc-stack-abc123 -- DependencyViolation: resource sg-0a1b2c3d4e5f has a dependent object", "errorStackTrace": "at TestClusterCleanup (cleanup_test.go:88)\nat deleteCloudFormationStack (aws_helpers.go:234)"},{"name": "TestVPCDeletion", "className": "e2e.capa.cleanup", "errorMessage": "FAILED - RETRYING cloudformation stack deletion: stack capa-ci-vpc-stack-abc123 still in DELETE_FAILED state after 5 attempts", "errorStackTrace": "at TestVPCDeletion (cleanup_test.go:112)"}]'::jsonb),

  -- Build 4: Jenkins unstable
  ('a0000001-0000-0000-0000-000000000004', 'jenkins', '350', 'capi_tests',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/350/',
   'unstable', 43, 1, 1, 45, 1920000,
   '2026-08-10T02:00:00Z', '2026-08-10T02:32:00Z',
   '4.17.0-nightly-2026-08-10',
   '{"OCP_VERSION": "4.17.0-nightly-2026-08-10", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[{"name": "TestNodeAutoScaling", "className": "e2e.capa.autoscaling", "errorMessage": "timed out waiting for node group to scale from 2 to 4 nodes within 10m0s", "errorStackTrace": "at TestNodeAutoScaling (autoscaling_test.go:77)"}]'::jsonb),

  -- Build 5: Prow success
  ('a0000001-0000-0000-0000-000000000005', 'prow', 'pw-9901', 'periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e',
   'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e/9901/',
   'success', 1, 0, 0, 1, 2456000,
   '2026-08-09T06:00:00Z', '2026-08-09T06:40:56Z',
   '4.17',
   '{"prow_job_type": "periodic", "cluster": "build05"}'::jsonb,
   '[]'::jsonb),

  -- Build 6: Prow failure -- OCM role missing (real job 2086724753162244096)
  ('a0000001-0000-0000-0000-000000000006', 'prow', '2086724753162244096', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
   'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2086724753162244096/',
   'failure', 1, 1, 0, 3, 7200000,
   '2026-08-10T08:02:00Z', '2026-08-10T10:00:37Z',
   '4.17',
   '{"prow_job_type": "periodic", "cluster": "build05"}'::jsonb,
   '[{"name": "CAPAClusterProvisioning", "className": "ProwJobExecution", "errorMessage": "ROSAControlPlane not ready after 75 retries: OCM API 403 Forbidden -- Organization 1k3xcZVc0W8XpR5ZGK1Ub8LC98y is not authorized to access target AWS account. Run rosa create ocm-role first. See https://access.redhat.com/articles/7137057", "errorStackTrace": "step capa-e2e failed: pod capa-e2e-rosa-e2e-capa failed, container test exited with code 1"}]'::jsonb),

  -- Build 7: Prow failure -- ROSAControlPlane stuck deletion
  ('a0000001-0000-0000-0000-000000000007', 'prow', 'pw-9903', 'periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e',
   'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e/9903/',
   'failure', 0, 1, 0, 1, 3600000,
   '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z',
   '4.18',
   '{"prow_job_type": "periodic", "cluster": "build05"}'::jsonb,
   '[{"name": "prow-job-result", "className": "ProwJobExecution", "errorMessage": "FAILED - RETRYING ROSAControlPlane capa-ci-hcp-cluster-xyz deletion: resource still exists after 15 attempts, finalizers preventing deletion", "errorStackTrace": ""}]'::jsonb),

  -- Build 8: Jenkins success (older)
  ('a0000001-0000-0000-0000-000000000008', 'jenkins', '345', 'rosa_hcp_e2e',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/rosa_hcp_e2e/345/',
   'success', 28, 0, 2, 30, 2890000,
   '2026-08-07T14:00:00Z', '2026-08-07T14:48:10Z',
   '4.17.0-nightly-2026-08-07',
   '{"OCP_VERSION": "4.17.0-nightly-2026-08-07", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[]'::jsonb),

  -- Build 9: Jenkins aborted
  ('a0000001-0000-0000-0000-000000000009', 'jenkins', '346', 'capa_upgrade_tests',
   'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capa_upgrade_tests/346/',
   'aborted', 12, 0, 0, 12, 600000,
   '2026-08-08T10:00:00Z', '2026-08-08T10:10:00Z',
   '4.17.0-nightly-2026-08-08',
   '{"OCP_VERSION": "4.17.0-nightly-2026-08-08", "CLOUD_PROVIDER": "aws"}'::jsonb,
   '[]'::jsonb),

  -- Build 10: Prow pending
  ('a0000001-0000-0000-0000-000000000010', 'prow', 'pw-9904', 'periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e',
   'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e/9904/',
   'running', 0, 0, 0, 0, NULL,
   '2026-08-10T08:00:00Z', NULL,
   '4.17',
   '{"prow_job_type": "periodic", "cluster": "build05"}'::jsonb,
   '[]'::jsonb);

-- ============================================================
-- 5 Support Tickets at different lifecycle stages
-- ============================================================

INSERT INTO support_tickets (id, title, description, status, severity, assignee,
                             build_id, error_signature, root_cause, root_cause_category,
                             fix_pr_url, fix_pr_number, upstream_issue_url, jira_key,
                             labels, created_at, resolved_at)
VALUES
  -- Ticket 1: CAPI v1beta2 migration -- fix_in_progress, has PR
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

  -- Ticket 2: CloudFormation deletion failure -- resolved
  ('b0000001-0000-0000-0000-000000000002',
   'e2e.capa.cleanup: TestClusterCleanup -- CloudFormation stack DELETE_FAILED',
   '**Error:** CloudFormation stack DELETE_FAILED: capa-ci-vpc-stack-abc123\n\n**Job:** capa_nightly\n**Build:** #349\n**OCP Version:** 4.17.0-nightly-2026-08-09\n**Failed Tests:** 2/45',
   'resolved', 'infrastructure', 'jsmith@redhat.com',
   'a0000001-0000-0000-0000-000000000003',
   'e2e.capa.cleanup::TestClusterCleanup::f9e8d7c6b5a43210',
   'AWS CloudFormation stack deletion failure -- ROSA creates security groups outside CF that block VPC deletion',
   'aws_infrastructure',
   'https://github.com/stolostron/rosa-hcp-e2e-test/pull/285', 285,
   NULL, 'RHACM4K-12345',
   ARRAY['jenkins', 'ocp-4.17', 'cloudformation'],
   '2026-08-08T00:00:00Z', '2026-08-09T16:00:00Z'),

  -- Ticket 3: OCM role missing -- investigating (real job 2086724753162244096)
  ('b0000001-0000-0000-0000-000000000003',
   'ProwJobExecution: CAPAClusterProvisioning -- OCM role missing, 403 on cluster create',
   '**Error:** OCM API 403 Forbidden -- Organization not authorized to access target AWS account. ocm-role not created.\n\n**Job:** periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e\n**Build:** 2086724753162244096\n**OCP Version:** 4.17\n**Failed Tests:** 1/3 (Install passed, Provisioning failed after 42min, Deletion passed)\n\n**Cascade:** ROSANetwork stuck deletion, CloudFormation DELETE_FAILED (orphaned SGs/VPC endpoints), lease update 503s\n\n**Proposed fix:** Add pre-flight Ansible task in `create_rosa_hcp_cluster.yml` (before `provision_rosa_hcp_with_automation.yml` include) that:\n1. Queries OCM API to check if org has ocm-role linked to target AWS account\n2. If missing, creates via OCM API (or boto3 for IAM-side role)\n3. Fails fast with clear error if creation fails\n\n**Note:** Do NOT use rosa CLI -- use OCM API or boto3. Target repo: stolostron/rosa-hcp-e2e-test.',
   'investigating', 'infrastructure', 'tfitzgerald@redhat.com',
   'a0000001-0000-0000-0000-000000000006',
   'ProwJobExecution::CAPAClusterProvisioning::ocm403_org_not_authorized',
   'OCM organization lacks ocm-role for target AWS account. CI environment config issue -- rosa create ocm-role was not run.',
   'ocm_config',
   NULL, NULL, NULL, NULL,
   ARRAY['prow', 'ocp-4.17', 'ocm-role', 'rosa-hcp'],
   '2026-08-10T10:01:00Z', NULL),

  -- Ticket 4: ROSAControlPlane stuck -- new
  ('b0000001-0000-0000-0000-000000000004',
   'ProwJobExecution: prow-job-result -- ROSAControlPlane stuck in deletion',
   '**Error:** FAILED - RETRYING ROSAControlPlane deletion: resource still exists after 15 attempts\n\n**Job:** periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e\n**Build:** pw-9903\n**OCP Version:** 4.18\n**Failed Tests:** 1/1',
   'new', 'infrastructure', NULL,
   'a0000001-0000-0000-0000-000000000007',
   'ProwJobExecution::prow-job-result::9988776655443322',
   'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
   'rosa_lifecycle',
   NULL, NULL, NULL, NULL,
   ARRAY['prow', 'ocp-4.18', 'rosa-lifecycle'],
   '2026-08-10T01:30:00Z', NULL),

  -- Ticket 5: Flaky autoscaling test -- verified
  ('b0000001-0000-0000-0000-000000000005',
   'e2e.capa.autoscaling: TestNodeAutoScaling -- timeout waiting for node scale',
   '**Error:** timed out waiting for node group to scale from 2 to 4 nodes\n\n**Job:** capi_tests\n**Build:** #350\n**OCP Version:** 4.17.0-nightly-2026-08-10\n**Failed Tests:** 1/45',
   'verified', 'flaky', 'mchen@redhat.com',
   'a0000001-0000-0000-0000-000000000004',
   'e2e.capa.autoscaling::TestNodeAutoScaling::aabb112233445566',
   'Flaky timeout -- node autoscaler occasionally slow under load',
   'infrastructure_timeout',
   'https://github.com/stolostron/rosa-hcp-e2e-test/pull/283', 283,
   NULL, NULL,
   ARRAY['jenkins', 'ocp-4.17', 'flaky'],
   '2026-08-05T10:00:00Z', '2026-08-07T14:00:00Z');

-- Update verified_at for ticket 5 (verified ticket)
UPDATE support_tickets
SET verified_at = '2026-08-08T02:00:00Z',
    verified_in_build_id = 'a0000001-0000-0000-0000-000000000001'
WHERE id = 'b0000001-0000-0000-0000-000000000005';

-- ============================================================
-- Tasks (checklists for tickets)
-- ============================================================

-- Ticket 1 tasks (fix_in_progress -- 2 done, 2 in progress)
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order, completed_at) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Investigate logs', 'done', 'tfitzgerald@redhat.com', 1, '2026-08-09T10:00:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Identify root cause', 'done', 'tfitzgerald@redhat.com', 2, '2026-08-09T11:30:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Submit fix PR', 'done', 'tfitzgerald@redhat.com', 3, '2026-08-09T15:00:00Z'),
  ('b0000001-0000-0000-0000-000000000001', 'Verify in next nightly', 'in_progress', 'tfitzgerald@redhat.com', 4, NULL);

-- Ticket 2 tasks (resolved -- all done)
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order, completed_at) VALUES
  ('b0000001-0000-0000-0000-000000000002', 'Investigate logs', 'done', 'jsmith@redhat.com', 1, '2026-08-08T02:00:00Z'),
  ('b0000001-0000-0000-0000-000000000002', 'Identify root cause', 'done', 'jsmith@redhat.com', 2, '2026-08-08T05:00:00Z'),
  ('b0000001-0000-0000-0000-000000000002', 'Submit fix PR', 'done', 'jsmith@redhat.com', 3, '2026-08-09T10:00:00Z'),
  ('b0000001-0000-0000-0000-000000000002', 'Verify in next nightly', 'done', 'jsmith@redhat.com', 4, '2026-08-09T23:30:00Z');

-- Ticket 3 tasks (investigating -- root cause identified, fix scoped)
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order, completed_at) VALUES
  ('b0000001-0000-0000-0000-000000000003', 'Investigate build log for root cause', 'done', 'tfitzgerald@redhat.com', 1, '2026-08-10T10:30:00Z'),
  ('b0000001-0000-0000-0000-000000000003', 'Root cause: ocm-role missing for target AWS account (OCM 403)', 'done', 'tfitzgerald@redhat.com', 2, '2026-08-10T10:30:00Z'),
  ('b0000001-0000-0000-0000-000000000003', 'Add pre-flight Ansible task: OCM API check for ocm-role linked to target AWS account', 'open', 'tfitzgerald@redhat.com', 3, NULL),
  ('b0000001-0000-0000-0000-000000000003', 'If ocm-role missing, create via OCM API (or boto3 for IAM side) -- fail fast before cluster provisioning', 'open', 'tfitzgerald@redhat.com', 4, NULL),
  ('b0000001-0000-0000-0000-000000000003', 'Add task to create_rosa_hcp_cluster.yml before provision_rosa_hcp_with_automation.yml include', 'open', 'tfitzgerald@redhat.com', 5, NULL),
  ('b0000001-0000-0000-0000-000000000003', 'Submit fix PR to stolostron/rosa-hcp-e2e-test', 'open', 'tfitzgerald@redhat.com', 6, NULL),
  ('b0000001-0000-0000-0000-000000000003', 'Verify in next Prow periodic run (periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e)', 'open', NULL, 7, NULL);

-- Ticket 4 tasks (new -- all open)
INSERT INTO tasks (ticket_id, title, status, sort_order) VALUES
  ('b0000001-0000-0000-0000-000000000004', 'Investigate logs', 'open', 1),
  ('b0000001-0000-0000-0000-000000000004', 'Identify root cause', 'open', 2),
  ('b0000001-0000-0000-0000-000000000004', 'Submit fix PR', 'open', 3),
  ('b0000001-0000-0000-0000-000000000004', 'Verify in next nightly', 'open', 4);

-- Ticket 5 tasks (verified -- all done)
INSERT INTO tasks (ticket_id, title, status, assignee, sort_order, completed_at) VALUES
  ('b0000001-0000-0000-0000-000000000005', 'Investigate logs', 'done', 'mchen@redhat.com', 1, '2026-08-05T12:00:00Z'),
  ('b0000001-0000-0000-0000-000000000005', 'Identify root cause', 'done', 'mchen@redhat.com', 2, '2026-08-05T14:00:00Z'),
  ('b0000001-0000-0000-0000-000000000005', 'Submit fix PR', 'done', 'mchen@redhat.com', 3, '2026-08-06T09:00:00Z'),
  ('b0000001-0000-0000-0000-000000000005', 'Verify in next nightly', 'done', 'mchen@redhat.com', 4, '2026-08-08T02:00:00Z');

-- ============================================================
-- Activities (20 events across the lifecycle)
-- ============================================================

INSERT INTO activities (activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES
  -- Build completions
  ('build_completed', 'Build #347 success', 'Jenkins job capi_tests build #347 completed with status: success. 0 test failures.',
   'a0000001-0000-0000-0000-000000000001', NULL, 'ingest-jenkins',
   '{"source": "jenkins", "job_name": "capi_tests", "build_number": 347, "pass_count": 42, "fail_count": 0}'::jsonb,
   '2026-08-09T02:31:00Z'),

  ('build_completed', 'Build #348 failure', 'Jenkins job capi_tests build #348 completed with status: failure. 4 test failures.',
   'a0000001-0000-0000-0000-000000000002', NULL, 'ingest-jenkins',
   '{"source": "jenkins", "job_name": "capi_tests", "build_number": 348, "pass_count": 38, "fail_count": 4}'::jsonb,
   '2026-08-09T08:36:00Z'),

  ('build_completed', 'Build #349 failure', 'Jenkins job capa_nightly build #349 completed with status: failure. 2 test failures.',
   'a0000001-0000-0000-0000-000000000003', NULL, 'ingest-jenkins',
   '{"source": "jenkins", "job_name": "capa_nightly", "build_number": 349, "pass_count": 40, "fail_count": 2}'::jsonb,
   '2026-08-09T23:01:00Z'),

  ('build_completed', 'Prow job periodic-ci-...capa-e2e success', 'Prow periodic job completed with status: success.',
   'a0000001-0000-0000-0000-000000000005', NULL, 'ingest-prow',
   '{"source": "prow", "job_name": "periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e"}'::jsonb,
   '2026-08-09T06:41:00Z'),

  ('build_completed', 'Prow job capa-e2e failure -- OCM role missing', 'Prow periodic job failed: ROSAControlPlane 403 -- Organization not authorized to access AWS account. ocm-role not created. 1/3 tests failed.',
   'a0000001-0000-0000-0000-000000000006', NULL, 'ingest-prow',
   '{"source": "prow", "job_name": "periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e", "pass_count": 2, "fail_count": 1}'::jsonb,
   '2026-08-10T10:01:00Z'),

  ('build_completed', 'Prow job periodic-ci-...capa-e2e failure', 'Prow periodic job completed with status: failure. ROSAControlPlane stuck.',
   'a0000001-0000-0000-0000-000000000007', NULL, 'ingest-prow',
   '{"source": "prow", "job_name": "periodic-ci-openshift-cluster-api-provider-aws-release-4.18-e2e-rosa-hcp-e2e-main_capa-e2e"}'::jsonb,
   '2026-08-10T01:01:00Z'),

  -- Ticket creation events
  ('ticket_created', 'Ticket #1 created: CAPI v1beta2 apiGroup migration', 'Auto-created by triage agent. Severity: upstream_breakage.',
   'a0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 'triage-agent',
   '{"severity": "upstream_breakage", "error_signature": "e2e.capa.cluster_lifecycle::TestAWSClusterCreation::a1b2c3d4e5f6g7h8", "auto_created": true}'::jsonb,
   '2026-08-09T09:00:00Z'),

  ('ticket_created', 'Ticket #2 created: CloudFormation stack DELETE_FAILED', 'Auto-created by triage agent. Severity: infrastructure.',
   'a0000001-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000002', 'triage-agent',
   '{"severity": "infrastructure", "error_signature": "e2e.capa.cleanup::TestClusterCleanup::f9e8d7c6b5a43210", "auto_created": true}'::jsonb,
   '2026-08-08T00:00:00Z'),

  ('ticket_created', 'Ticket #3 created: OCM role missing -- 403 on cluster create', 'Auto-created by triage agent. Severity: infrastructure. Provisioning failed after 42min timeout.',
   'a0000001-0000-0000-0000-000000000006', 'b0000001-0000-0000-0000-000000000003', 'triage-agent',
   '{"severity": "infrastructure", "error_signature": "ProwJobExecution::CAPAClusterProvisioning::ocm403_org_not_authorized", "auto_created": true}'::jsonb,
   '2026-08-10T10:01:30Z'),

  ('ticket_created', 'Ticket #4 created: ROSAControlPlane stuck in deletion', 'Auto-created by triage agent. Severity: infrastructure.',
   'a0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000004', 'triage-agent',
   '{"severity": "infrastructure", "error_signature": "ProwJobExecution::prow-job-result::9988776655443322", "auto_created": true}'::jsonb,
   '2026-08-10T01:30:00Z'),

  -- Diagnosis events
  ('diagnosis_completed', 'Diagnosis completed: capi_not_installed', 'Root cause identified: CAPI/CAPA controllers not installed or running. Category: capi_setup.',
   'a0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 'diagnosis-agent',
   '{"matched_pattern": "capi_not_installed", "root_cause": "CAPI v1beta2 apiGroup migration", "root_cause_category": "capi_migration"}'::jsonb,
   '2026-08-09T09:01:00Z'),

  ('diagnosis_completed', 'Diagnosis completed: cloudformation_deletion_failure', 'Root cause identified: AWS CloudFormation stack deletion failure.',
   'a0000001-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000002', 'diagnosis-agent',
   '{"matched_pattern": "cloudformation_deletion_failure", "root_cause_category": "aws_infrastructure"}'::jsonb,
   '2026-08-08T00:01:00Z'),

  ('diagnosis_completed', 'Diagnosis completed: ocm_role_missing', 'Root cause identified: OCM organization lacks ocm-role for target AWS account. Fix: add pre-flight check to verify/create ocm-role before cluster provisioning.',
   'a0000001-0000-0000-0000-000000000006', 'b0000001-0000-0000-0000-000000000003', 'diagnosis-agent',
   '{"matched_pattern": "ocm_role_missing", "root_cause_category": "ocm_config"}'::jsonb,
   '2026-08-10T10:02:00Z'),

  ('diagnosis_completed', 'Diagnosis completed: rosacontrolplane_stuck_deletion', 'Root cause identified: ROSAControlPlane stuck in deletion.',
   'a0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000004', 'diagnosis-agent',
   '{"matched_pattern": "rosacontrolplane_stuck_deletion", "root_cause_category": "rosa_lifecycle"}'::jsonb,
   '2026-08-10T01:31:00Z'),

  -- Status change and user actions
  ('note_added', 'Investigation note added', 'Root cause confirmed from build log: OCM org not authorized for target AWS account, ocm-role was never created. Fix is to add a pre-flight check in the provisioning playbook -- verify ocm-role exists early and create if missing, instead of waiting 42min for ROSAControlPlane timeout. Cascade failures (CF stuck deletion, orphaned SGs) are secondary to the role issue.',
   NULL, 'b0000001-0000-0000-0000-000000000003', 'tfitzgerald@redhat.com',
   '{}'::jsonb,
   '2026-08-10T10:30:00Z'),

  ('fix_submitted', 'Fix PR #127 submitted for CAPI v1beta2 migration', 'PR updates 4.22 templates to use CAPI v1beta2 apiGroup refs, removes namespace from ContractVersionedObjectReference fields.',
   NULL, 'b0000001-0000-0000-0000-000000000001', 'tfitzgerald@redhat.com',
   '{"pr_url": "https://github.com/stolostron/rosa-hcp-e2e-test/pull/127", "pr_number": 127}'::jsonb,
   '2026-08-09T15:00:00Z'),

  ('fix_merged', 'Fix PR #285 merged for CloudFormation deletion', 'PR adds pre-cleanup step to remove ROSA-created security groups before CF stack deletion.',
   NULL, 'b0000001-0000-0000-0000-000000000002', 'resolution-tracker',
   '{"pr_number": 285, "pr_url": "https://github.com/stolostron/rosa-hcp-e2e-test/pull/285", "merged_at": "2026-08-09T16:00:00Z"}'::jsonb,
   '2026-08-09T16:05:00Z'),

  -- Notification events
  ('notification_sent', 'Slack notification sent for: Ticket #1 created', 'Notification delivered to #capa-ci-alerts',
   NULL, 'b0000001-0000-0000-0000-000000000001', 'notify-agent',
   '{"channel": "#capa-ci-alerts", "ts": "1723194060.000100", "source_activity_type": "ticket_created"}'::jsonb,
   '2026-08-09T09:01:30Z'),

  ('notification_sent', 'Slack notification sent for: Fix PR #285 merged', 'Notification delivered to #capa-ci-alerts',
   NULL, 'b0000001-0000-0000-0000-000000000002', 'notify-agent',
   '{"channel": "#capa-ci-alerts", "ts": "1723219530.000200", "source_activity_type": "fix_merged"}'::jsonb,
   '2026-08-09T16:05:30Z');

-- ============================================================
-- Agent Runs (observability log)
-- ============================================================

INSERT INTO agent_runs (agent_name, trigger, input_payload, output_payload, success, error_message, duration_ms, created_at) VALUES
  ('ingest-jenkins', 'cron',
   '{"jobs": ["capi_tests", "capa_nightly", "rosa_hcp_e2e", "capa_upgrade_tests"]}'::jsonb,
   '{"capi_tests": {"ingested": 2, "skipped": 0, "errors": []}, "capa_nightly": {"ingested": 1, "skipped": 0, "errors": []}}'::jsonb,
   true, NULL, 4520, '2026-08-09T08:35:00Z'),

  ('ingest-prow', 'cron',
   '{"api_url": "https://prow.ci.openshift.org/prowjobs.js", "total_jobs_fetched": 45, "relevant_jobs": 3}'::jsonb,
   '{"ingested": 3, "skipped": 0, "errors": []}'::jsonb,
   true, NULL, 2100, '2026-08-09T12:32:00Z'),

  ('triage', 'pg_notify',
   '{"build_id": "a0000001-0000-0000-0000-000000000002"}'::jsonb,
   '{"action": "created", "ticketId": "b0000001-0000-0000-0000-000000000001", "ticketNumber": 1, "errorSignature": "e2e.capa.cluster_lifecycle::TestAWSClusterCreation::a1b2c3d4e5f6g7h8"}'::jsonb,
   true, NULL, 340, '2026-08-09T09:00:30Z'),

  ('diagnosis', 'triage-agent',
   '{"ticket_id": "b0000001-0000-0000-0000-000000000001", "build_id": "a0000001-0000-0000-0000-000000000002"}'::jsonb,
   '{"ticket_id": "b0000001-0000-0000-0000-000000000001", "diagnosis": {"matched_pattern": "capi_not_installed"}, "patterns_checked": 12}'::jsonb,
   true, NULL, 180, '2026-08-09T09:01:00Z'),

  ('resolution-tracker', 'cron',
   '{"tickets_found": 1}'::jsonb,
   '{"checked": 1, "resolved": 1, "errors": []}'::jsonb,
   true, NULL, 890, '2026-08-09T16:00:30Z'),

  ('notify', 'pg_notify',
   '{"activity_id": "some-activity-uuid"}'::jsonb,
   '{"channel": "#capa-ci-alerts", "ts": "1723194060.000100", "activity_type": "ticket_created"}'::jsonb,
   true, NULL, 450, '2026-08-09T09:01:30Z'),

  ('ingest-jenkins', 'cron',
   '{"jobs": ["capi_tests"]}'::jsonb,
   NULL,
   false, 'Jenkins API error: 503 Service Unavailable for https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/api/json', 15200, '2026-08-10T02:05:00Z');
