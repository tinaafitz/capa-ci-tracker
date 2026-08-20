-- Rich Demo Seed Data for CAPA CI Tracker
-- 20 builds, 10 tickets across all lifecycle stages, 2 streaks, 25+ activities, tasks per ticket

-- ============================================================
-- Builds (20 total: jenkins + prow, spread Aug 1-20 2026)
-- ============================================================

INSERT OR IGNORE INTO builds (id, source, external_id, job_name, job_url, status,
  pass_count, fail_count, skip_count, total_count, duration_ms,
  started_at, finished_at, ocp_version, parameters, test_failures, log_fetched, created_at, updated_at)
VALUES

-- Jenkins capi_tests builds
('b1000001-0000-0000-0000-000000000001', 'jenkins', '320', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/320/',
 'success', 42, 0, 3, 45, 2340000,
 '2026-08-01T04:00:00Z', '2026-08-01T04:39:00Z', '4.18.0-nightly-2026-08-01',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-01","CLOUD_PROVIDER":"aws"}', '[]', 0,
 '2026-08-01T04:39:00Z', '2026-08-01T04:39:00Z'),

('b1000001-0000-0000-0000-000000000002', 'jenkins', '321', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/321/',
 'failure', 38, 4, 3, 45, 2100000,
 '2026-08-03T04:00:00Z', '2026-08-03T04:35:00Z', '4.18.0-nightly-2026-08-03',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-03","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestROSAHCPProvision","className":"e2e.capa.rosa_hcp","errorMessage":"error: Organization not authorized to access AWS account 123456789. Ensure OCM role is linked via OCM API.","errorStackTrace":"at TestROSAHCPProvision (rosa_hcp_test.go:67)"},{"name":"TestROSAHCPDelete","className":"e2e.capa.rosa_hcp","errorMessage":"error: Organization not authorized","errorStackTrace":"at TestROSAHCPDelete (rosa_hcp_test.go:145)"}]',
 0, '2026-08-03T04:35:00Z', '2026-08-03T04:35:00Z'),

('b1000001-0000-0000-0000-000000000003', 'jenkins', '322', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/322/',
 'success', 42, 0, 3, 45, 2280000,
 '2026-08-05T04:00:00Z', '2026-08-05T04:38:00Z', '4.18.0-nightly-2026-08-05',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-05","CLOUD_PROVIDER":"aws"}', '[]', 0,
 '2026-08-05T04:38:00Z', '2026-08-05T04:38:00Z'),

('b1000001-0000-0000-0000-000000000004', 'jenkins', '323', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/323/',
 'unstable', 39, 2, 4, 45, 2200000,
 '2026-08-07T04:00:00Z', '2026-08-07T04:36:40Z', '4.18.0-nightly-2026-08-07',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-07","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestMachinePoolScaling","className":"e2e.capa.machine_pool","errorMessage":"assertion failed: expected 3 ready replicas, got 2 after 10m timeout","errorStackTrace":"at TestMachinePoolScaling (machine_pool_test.go:201)"},{"name":"TestROSANetworkCreation","className":"e2e.capa.rosa_network","errorMessage":"timeout waiting for ROSANetwork to reach Ready state after 15m","errorStackTrace":"at TestROSANetworkCreation (rosa_network_test.go:89)"}]',
 0, '2026-08-07T04:36:40Z', '2026-08-07T04:36:40Z'),

('b1000001-0000-0000-0000-000000000005', 'jenkins', '324', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/324/',
 'failure', 36, 5, 4, 45, 2580000,
 '2026-08-09T04:00:00Z', '2026-08-09T04:43:00Z', '4.18.0-nightly-2026-08-09',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-09","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestAWSClusterCreation","className":"e2e.capa.cluster_lifecycle","errorMessage":"error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required","errorStackTrace":"at TestAWSClusterCreation (cluster_lifecycle_test.go:142)"},{"name":"TestROSAHCPProvision","className":"e2e.capa.rosa_hcp","errorMessage":"error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1","errorStackTrace":"at TestROSAHCPProvision (rosa_hcp_test.go:67)"}]',
 0, '2026-08-09T04:43:00Z', '2026-08-09T04:43:00Z'),

('b1000001-0000-0000-0000-000000000006', 'jenkins', '325', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/325/',
 'failure', 35, 6, 4, 45, 2640000,
 '2026-08-11T04:00:00Z', '2026-08-11T04:44:00Z', '4.18.0-nightly-2026-08-11',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-11","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestAWSClusterCreation","className":"e2e.capa.cluster_lifecycle","errorMessage":"error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required","errorStackTrace":"at TestAWSClusterCreation (cluster_lifecycle_test.go:142)"}]',
 0, '2026-08-11T04:44:00Z', '2026-08-11T04:44:00Z'),

('b1000001-0000-0000-0000-000000000007', 'jenkins', '326', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/326/',
 'success', 42, 0, 3, 45, 2190000,
 '2026-08-13T04:00:00Z', '2026-08-13T04:36:30Z', '4.18.0-nightly-2026-08-13',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-13","CLOUD_PROVIDER":"aws"}', '[]', 0,
 '2026-08-13T04:36:30Z', '2026-08-13T04:36:30Z'),

-- Active streak: 4 consecutive failures starting Aug 15
('b1000001-0000-0000-0000-000000000008', 'jenkins', '327', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/327/',
 'failure', 33, 7, 5, 45, 2700000,
 '2026-08-15T04:00:00Z', '2026-08-15T04:45:00Z', '4.18.0-nightly-2026-08-15',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-15","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestROSAHCPDelete","className":"e2e.capa.rosa_hcp","errorMessage":"FAILED - RETRYING ROSAControlPlane capa-test-cluster deletion: resource still exists after 20 attempts, finalizers [capa.infrastructure.cluster.x-k8s.io/rosa-hcp] preventing deletion","errorStackTrace":"at TestROSAHCPDelete (rosa_hcp_test.go:145)"}]',
 0, '2026-08-15T04:45:00Z', '2026-08-15T04:45:00Z'),

('b1000001-0000-0000-0000-000000000009', 'jenkins', '328', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/328/',
 'failure', 33, 7, 5, 45, 2700000,
 '2026-08-17T04:00:00Z', '2026-08-17T04:45:00Z', '4.18.0-nightly-2026-08-17',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-17","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestROSAHCPDelete","className":"e2e.capa.rosa_hcp","errorMessage":"FAILED - RETRYING ROSAControlPlane capa-test-cluster deletion: resource still exists after 20 attempts, finalizers preventing deletion. CloudFormation stack DELETE_FAILED: orphaned security group sg-0abc123 blocking VPC deletion.","errorStackTrace":"at TestROSAHCPDelete (rosa_hcp_test.go:145)"}]',
 0, '2026-08-17T04:45:00Z', '2026-08-17T04:45:00Z'),

('b1000001-0000-0000-0000-000000000010', 'jenkins', '329', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/329/',
 'failure', 32, 8, 5, 45, 2820000,
 '2026-08-19T04:00:00Z', '2026-08-19T04:47:00Z', '4.18.0-nightly-2026-08-19',
 '{"OCP_VERSION":"4.18.0-nightly-2026-08-19","CLOUD_PROVIDER":"aws"}',
 '[{"name":"TestROSAHCPDelete","className":"e2e.capa.rosa_hcp","errorMessage":"FAILED - RETRYING ROSAControlPlane capa-test-cluster deletion: resource still exists, CloudFormation stack DELETE_FAILED","errorStackTrace":"at TestROSAHCPDelete (rosa_hcp_test.go:145)"}]',
 0, '2026-08-19T04:47:00Z', '2026-08-19T04:47:00Z'),

-- Prow capa-e2e builds (resolved streak Aug 8-12, then clean)
('b1000001-0000-0000-0000-000000000011', 'prow', 'pw-8801', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/8801/',
 'success', 1, 0, 0, 1, 5400000,
 '2026-08-02T04:00:00Z', '2026-08-02T05:30:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}', '[]', 0,
 '2026-08-02T05:30:00Z', '2026-08-02T05:30:00Z'),

('b1000001-0000-0000-0000-000000000012', 'prow', 'pw-8901', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/8901/',
 'failure', 0, 1, 0, 1, 4800000,
 '2026-08-08T04:00:00Z', '2026-08-08T05:20:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}',
 '[{"name":"prow-job-result","className":"ProwJobExecution","errorMessage":"Build farm connectivity error: unable to reach build05.ci.openshift.org after 3 retries. Network timeout.","errorStackTrace":""}]',
 0, '2026-08-08T05:20:00Z', '2026-08-08T05:20:00Z'),

('b1000001-0000-0000-0000-000000000013', 'prow', 'pw-8902', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/8902/',
 'failure', 0, 1, 0, 1, 4920000,
 '2026-08-10T04:00:00Z', '2026-08-10T05:22:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}',
 '[{"name":"prow-job-result","className":"ProwJobExecution","errorMessage":"Build farm connectivity error: unable to reach build05.ci.openshift.org after 3 retries.","errorStackTrace":""}]',
 0, '2026-08-10T05:22:00Z', '2026-08-10T05:22:00Z'),

('b1000001-0000-0000-0000-000000000014', 'prow', 'pw-8903', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/8903/',
 'failure', 0, 1, 0, 1, 4860000,
 '2026-08-12T04:00:00Z', '2026-08-12T05:21:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}',
 '[{"name":"prow-job-result","className":"ProwJobExecution","errorMessage":"Build farm connectivity error: unable to reach build05.ci.openshift.org","errorStackTrace":""}]',
 0, '2026-08-12T05:21:00Z', '2026-08-12T05:21:00Z'),

-- prow recovers after infra fix
('b1000001-0000-0000-0000-000000000015', 'prow', 'pw-9001', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/9001/',
 'success', 1, 0, 0, 1, 5520000,
 '2026-08-14T04:00:00Z', '2026-08-14T05:32:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}', '[]', 0,
 '2026-08-14T05:32:00Z', '2026-08-14T05:32:00Z'),

('b1000001-0000-0000-0000-000000000016', 'prow', 'pw-9101', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/9101/',
 'success', 1, 0, 0, 1, 5340000,
 '2026-08-16T04:00:00Z', '2026-08-16T05:29:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build05"}', '[]', 0,
 '2026-08-16T05:29:00Z', '2026-08-16T05:29:00Z'),

-- capa-e2e-full builds
('b1000001-0000-0000-0000-000000000017', 'prow', 'pw-full-101', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full/101/',
 'success', 1, 0, 0, 1, 8100000,
 '2026-08-04T04:00:00Z', '2026-08-04T06:15:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build06"}', '[]', 0,
 '2026-08-04T06:15:00Z', '2026-08-04T06:15:00Z'),

('b1000001-0000-0000-0000-000000000018', 'prow', 'pw-full-102', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full/102/',
 'failure', 0, 1, 0, 1, 7800000,
 '2026-08-06T04:00:00Z', '2026-08-06T06:10:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build06"}',
 '[{"name":"prow-job-result","className":"ProwJobExecution","errorMessage":"ROSANetwork timeout: waiting for ROSANetwork capa-full-test-network to reach Ready condition after 20 minutes. Status: CloudFormationStackStatus=CREATE_IN_PROGRESS.","errorStackTrace":""}]',
 0, '2026-08-06T06:10:00Z', '2026-08-06T06:10:00Z'),

('b1000001-0000-0000-0000-000000000019', 'prow', 'pw-full-103', 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full',
 'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full/103/',
 'success', 1, 0, 0, 1, 8220000,
 '2026-08-18T04:00:00Z', '2026-08-18T06:17:00Z', '4.18',
 '{"prow_job_type":"periodic","cluster":"build06"}', '[]', 0,
 '2026-08-18T06:17:00Z', '2026-08-18T06:17:00Z'),

-- success build for verified ticket
('b1000001-0000-0000-0000-000000000020', 'jenkins', '330', 'capi_tests',
 'https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests/330/',
 'success', 42, 0, 3, 45, 2160000,
 '2026-08-20T04:00:00Z', '2026-08-20T04:36:00Z', '4.19.0-nightly-2026-08-20',
 '{"OCP_VERSION":"4.19.0-nightly-2026-08-20","CLOUD_PROVIDER":"aws"}', '[]', 0,
 '2026-08-20T04:36:00Z', '2026-08-20T04:36:00Z');

-- ============================================================
-- Failure Streaks (2)
-- ============================================================

INSERT OR IGNORE INTO failure_streaks (id, job_name, source, status, started_at, ended_at,
  streak_length, phase_count, phases, analysis_summary, analyzed_at, created_at, updated_at)
VALUES
  ('fs-0000001-0000-0000-0000-000000000001',
   'capi_tests', 'jenkins', 'active',
   '2026-08-15T04:00:00Z', NULL,
   4, 1,
   '[{"phase":1,"error_signature":"ROSAControlPlane::stuck_deletion::cf_delete_failed","builds":["b1000001-0000-0000-0000-000000000008","b1000001-0000-0000-0000-000000000009","b1000001-0000-0000-0000-000000000010"]}]',
   'ROSAControlPlane stuck in deletion for 4 consecutive nightly runs. CloudFormation stack DELETE_FAILED due to orphaned security group blocking VPC cleanup. Active since Aug 15.',
   '2026-08-17T05:00:00Z',
   '2026-08-15T05:00:00Z', '2026-08-19T05:00:00Z'),

  ('fs-0000001-0000-0000-0000-000000000002',
   'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e', 'prow', 'resolved',
   '2026-08-08T04:00:00Z', '2026-08-14T05:32:00Z',
   3, 1,
   '[{"phase":1,"error_signature":"ProwJobExecution::build_farm_connectivity::build05_timeout","builds":["b1000001-0000-0000-0000-000000000012","b1000001-0000-0000-0000-000000000013","b1000001-0000-0000-0000-000000000014"]}]',
   'Prow build farm build05 had intermittent connectivity issues Aug 8-12. Resolved after build farm team restarted networking on Aug 13. First clean run Aug 14.',
   '2026-08-12T06:00:00Z',
   '2026-08-08T05:30:00Z', '2026-08-14T05:32:00Z');

-- Link streak builds
INSERT OR IGNORE INTO streak_builds (streak_id, build_id, position, error_signature, phase_number) VALUES
  ('fs-0000001-0000-0000-0000-000000000001', 'b1000001-0000-0000-0000-000000000008', 1, 'ROSAControlPlane::stuck_deletion::cf_delete_failed', 1),
  ('fs-0000001-0000-0000-0000-000000000001', 'b1000001-0000-0000-0000-000000000009', 2, 'ROSAControlPlane::stuck_deletion::cf_delete_failed', 1),
  ('fs-0000001-0000-0000-0000-000000000001', 'b1000001-0000-0000-0000-000000000010', 3, 'ROSAControlPlane::stuck_deletion::cf_delete_failed', 1),
  ('fs-0000001-0000-0000-0000-000000000002', 'b1000001-0000-0000-0000-000000000012', 1, 'ProwJobExecution::build_farm_connectivity::build05_timeout', 1),
  ('fs-0000001-0000-0000-0000-000000000002', 'b1000001-0000-0000-0000-000000000013', 2, 'ProwJobExecution::build_farm_connectivity::build05_timeout', 1),
  ('fs-0000001-0000-0000-0000-000000000002', 'b1000001-0000-0000-0000-000000000014', 3, 'ProwJobExecution::build_farm_connectivity::build05_timeout', 1);

-- ============================================================
-- Support Tickets (10 across all lifecycle stages)
-- ============================================================

INSERT OR IGNORE INTO support_tickets (id, ticket_number, title, description, status, severity, assignee,
  build_id, error_signature, root_cause, root_cause_category, matched_pattern,
  fix_pr_url, fix_pr_number, upstream_issue_url, jira_key, labels,
  diagnosed_at, pr_merged_at, created_at, updated_at, resolved_at, verified_at,
  verified_in_build_id, streak_id)
VALUES

-- 3 new tickets (no diagnosis)
('t1000001-0000-0000-0000-000000000001', 1,
 'e2e.capa.rosa_hcp: TestROSAHCPProvision -- Organization not authorized to access AWS account',
 '**Error:** error: Organization not authorized to access AWS account 123456789. Ensure OCM role is linked via OCM API before provisioning.

**Job:** capi_tests
**Build:** #321
**OCP Version:** 4.18.0-nightly-2026-08-03
**Failed Tests:** 2/45',
 'new', 'nightly_blocker', NULL,
 'b1000001-0000-0000-0000-000000000002',
 'e2e.capa.rosa_hcp::TestROSAHCPProvision::ocm_auth_failure::f1e2d3c4b5a6',
 NULL, NULL, NULL, NULL, NULL, NULL, NULL,
 '["jenkins","ocp-4.18","ocm-auth"]',
 NULL, NULL, '2026-08-03T05:00:00Z', '2026-08-03T05:00:00Z', NULL, NULL, NULL, NULL),

('t1000001-0000-0000-0000-000000000002', 2,
 'e2e.capa.machine_pool: TestMachinePoolScaling -- assertion failed: expected 3 ready replicas, got 2',
 '**Error:** assertion failed: expected 3 ready replicas, got 2 after 10m timeout.

**Job:** capi_tests
**Build:** #323
**OCP Version:** 4.18.0-nightly-2026-08-07
**Failed Tests:** 2/45',
 'new', 'test_regression', NULL,
 'b1000001-0000-0000-0000-000000000004',
 'e2e.capa.machine_pool::TestMachinePoolScaling::replica_count_mismatch::a2b3c4d5',
 NULL, NULL, NULL, NULL, NULL, NULL, NULL,
 '["jenkins","ocp-4.18","machine-pool"]',
 NULL, NULL, '2026-08-07T05:00:00Z', '2026-08-07T05:00:00Z', NULL, NULL, NULL, NULL),

('t1000001-0000-0000-0000-000000000003', 3,
 'ProwJobExecution: capa-e2e-full -- ROSANetwork timeout waiting for Ready condition',
 '**Error:** ROSANetwork capa-full-test-network timeout: waiting for Ready condition after 20 minutes. Status: CloudFormationStackStatus=CREATE_IN_PROGRESS.

**Job:** periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full
**Build:** pw-full-102
**OCP Version:** 4.18',
 'new', 'flaky', NULL,
 'b1000001-0000-0000-0000-000000000018',
 'ProwJobExecution::rosa_network_timeout::cf_create_in_progress::c3d4e5f6',
 NULL, NULL, NULL, NULL, NULL, NULL, NULL,
 '["prow","ocp-4.18","rosa-network","flaky"]',
 NULL, NULL, '2026-08-06T06:30:00Z', '2026-08-06T06:30:00Z', NULL, NULL, NULL, NULL),

-- 2 investigating tickets (diagnosed_at set)
('t1000001-0000-0000-0000-000000000004', 4,
 'ProwJobExecution: capa-e2e -- Prow build farm build05 connectivity failure (3-day streak)',
 '**Error:** Build farm connectivity error: unable to reach build05.ci.openshift.org after 3 retries. Network timeout.

**Job:** periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e
**Streak:** 3 consecutive failures (Aug 8-12)
**Builds:** pw-8901, pw-8902, pw-8903',
 'investigating', 'infrastructure', 'jsmith@redhat.com',
 'b1000001-0000-0000-0000-000000000012',
 'ProwJobExecution::build_farm_connectivity::build05_timeout::d4e5f6a7',
 'Prow build farm build05 had intermittent networking issues causing test runner timeouts. Contacted build farm team.',
 'infrastructure', 'build_farm_failure',
 NULL, NULL, NULL, NULL,
 '["prow","ocp-4.18","infrastructure","build-farm"]',
 '2026-08-08T06:00:00Z', NULL,
 '2026-08-08T05:45:00Z', '2026-08-08T06:00:00Z', NULL, NULL, NULL,
 'fs-0000001-0000-0000-0000-000000000002'),

('t1000001-0000-0000-0000-000000000005', 5,
 'e2e.capa.rosa_network: TestROSANetworkCreation -- intermittent timeout waiting for Ready state',
 '**Error:** timeout waiting for ROSANetwork to reach Ready state after 15m. Occurs on ~20% of runs.

**Job:** capi_tests
**Build:** #323
**Flakiness:** Intermittent, not 100% reproducible',
 'investigating', 'flaky', 'tfitzger@redhat.com',
 'b1000001-0000-0000-0000-000000000004',
 'e2e.capa.rosa_network::TestROSANetworkCreation::ready_timeout::e5f6a7b8',
 'ROSANetwork CloudFormation stack creation occasionally stalls due to AWS API rate limiting on subnet creation. Not consistently reproducible.',
 'aws_rate_limit', 'rosa_network_timeout',
 NULL, NULL, NULL, NULL,
 '["jenkins","ocp-4.18","rosa-network","flaky"]',
 '2026-08-08T07:00:00Z', NULL,
 '2026-08-07T05:30:00Z', '2026-08-08T07:00:00Z', NULL, NULL, NULL, NULL),

-- 1 root_caused ticket
('t1000001-0000-0000-0000-000000000006', 6,
 'e2e.capa.cluster_lifecycle: TestAWSClusterCreation -- CAPI v1beta2 apiGroup migration required',
 '**Error:** error: the server does not recognize apiGroup cluster.x-k8s.io/v1beta1 -- CAPI v1beta2 migration required. Expected apiVersion cluster.x-k8s.io/v1beta2 but got v1beta1.

**Job:** capi_tests
**Builds:** #324, #325
**OCP Version:** 4.18.0-nightly-2026-08-09/11
**Failed Tests:** 5/45, 6/45',
 'root_caused', 'upstream_breakage', 'tfitzger@redhat.com',
 'b1000001-0000-0000-0000-000000000005',
 'e2e.capa.cluster_lifecycle::TestAWSClusterCreation::capi_v1beta2_migration::f6a7b8c9',
 'CAPI v1.11+ replaced corev1.ObjectReference with ContractVersionedObjectReference in v1beta2, making apiGroup required and removing namespace from Cluster/MachinePool refs. OCP 4.22 nightlies with CAPI v1.13+ enforce this server-side. Test templates still use v1beta1 apiGroup.',
 'capi_migration', 'capi_not_installed',
 NULL, NULL, 'https://github.com/kubernetes-sigs/cluster-api/issues/9876', NULL,
 '["jenkins","ocp-4.18","capi-v1beta2","upstream-breakage"]',
 '2026-08-09T06:00:00Z', NULL,
 '2026-08-09T05:00:00Z', '2026-08-09T06:00:00Z', NULL, NULL, NULL, NULL),

-- 2 fix_in_progress tickets
('t1000001-0000-0000-0000-000000000007', 7,
 'e2e.capa.rosa_hcp: TestROSAHCPDelete -- ROSAControlPlane stuck in deletion (active streak, 4 days)',
 '**Error:** FAILED - RETRYING ROSAControlPlane capa-test-cluster deletion: resource still exists after 20 attempts, finalizers [capa.infrastructure.cluster.x-k8s.io/rosa-hcp] preventing deletion. CloudFormation stack DELETE_FAILED.

**Job:** capi_tests
**Streak:** 4 consecutive failures (Aug 15-19, active)
**Builds:** #327, #328, #329',
 'fix_in_progress', 'nightly_blocker', 'tfitzger@redhat.com',
 'b1000001-0000-0000-0000-000000000008',
 'e2e.capa.rosa_hcp::TestROSAHCPDelete::rosacontrolplane_stuck_deletion::a7b8c9d0',
 'ROSAControlPlane finalizer not removed because CloudFormation stack DELETE_FAILED due to orphaned security group blocking VPC deletion. Fix: improve e2e teardown to clean up orphaned SGs before retrying CF stack deletion.',
 'rosa_lifecycle', 'rosacontrolplane_stuck_deletion',
 'https://github.com/stolostron/rosa-hcp-e2e-test/pull/144', 144,
 NULL, NULL,
 '["jenkins","ocp-4.18","rosa-lifecycle","cloudformation","nightly-blocker"]',
 '2026-08-15T06:00:00Z', NULL,
 '2026-08-15T05:30:00Z', '2026-08-17T10:00:00Z', NULL, NULL, NULL,
 'fs-0000001-0000-0000-0000-000000000001'),

('t1000001-0000-0000-0000-000000000008', 8,
 'e2e.capa.cluster_lifecycle: TestAWSClusterCreation -- CAPI v1beta2 fix PR open',
 '**Error:** CAPI v1beta2 apiGroup migration. PR #142 open, awaiting review and nightly verification.

**Job:** capi_tests
**Related to:** CAPA-6 (same root cause, separate ticket for tracking PR)',
 'fix_in_progress', 'upstream_breakage', 'jsmith@redhat.com',
 'b1000001-0000-0000-0000-000000000006',
 'e2e.capa.cluster_lifecycle::TestAWSClusterCreation::capi_v1beta2_migration::b8c9d0e1',
 'Test templates use deprecated v1beta1 apiGroup. Update all 4.22 feature templates to v1beta2.',
 'capi_migration', 'capi_not_installed',
 'https://github.com/stolostron/rosa-hcp-e2e-test/pull/142', 142,
 'https://github.com/kubernetes-sigs/cluster-api/issues/9876', NULL,
 '["jenkins","ocp-4.18","capi-v1beta2","upstream-breakage"]',
 '2026-08-11T06:00:00Z', NULL,
 '2026-08-11T05:00:00Z', '2026-08-13T14:00:00Z', NULL, NULL, NULL, NULL),

-- 1 resolved ticket
('t1000001-0000-0000-0000-000000000009', 9,
 'ProwJobExecution: capa-e2e -- build05 connectivity resolved after build farm fix',
 '**Error:** Build farm connectivity error. Resolved after build farm team fixed networking on build05 (Aug 13).

**Job:** periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e
**Streak:** Resolved Aug 14 (first clean run after 3-day outage)',
 'resolved', 'infrastructure', 'jsmith@redhat.com',
 'b1000001-0000-0000-0000-000000000012',
 'ProwJobExecution::build_farm_connectivity::build05_timeout::c9d0e1f2',
 'Prow build farm build05 networking was degraded due to a failed NIC replacement. Build farm team resolved it Aug 13. No code change needed from our side.',
 'infrastructure', 'build_farm_failure',
 NULL, NULL, NULL, NULL,
 '["prow","ocp-4.18","infrastructure","build-farm","resolved"]',
 '2026-08-08T06:00:00Z', NULL,
 '2026-08-08T05:45:00Z', '2026-08-14T06:00:00Z', '2026-08-14T06:00:00Z', NULL, NULL,
 'fs-0000001-0000-0000-0000-000000000002'),

-- 1 verified ticket
('t1000001-0000-0000-0000-000000000010', 10,
 'e2e.capa.rosa_hcp: TestROSAHCPProvision -- OCM role fix verified in #330',
 '**Error:** Organization not authorized to access AWS account. Fix: add pre-flight OCM role check to e2e provisioning playbook.

**Fix PR:** #139 (merged Aug 15)
**Verified in:** jenkins #330 (Aug 20, all tests pass)',
 'verified', 'nightly_blocker', 'tfitzger@redhat.com',
 'b1000001-0000-0000-0000-000000000002',
 'e2e.capa.rosa_hcp::TestROSAHCPProvision::ocm_role_missing::d0e1f2a3',
 'OCM role not linked before provisioning attempt. Added pre-flight check to validate role linkage and fail fast with clear error rather than 42-minute timeout.',
 'auth_credentials', 'ocm_role_missing',
 'https://github.com/stolostron/rosa-hcp-e2e-test/pull/139', 139,
 NULL, 'RHACM-12345',
 '["jenkins","ocp-4.18","ocm-auth","verified"]',
 '2026-08-04T09:00:00Z', '2026-08-15T16:00:00Z',
 '2026-08-03T05:30:00Z', '2026-08-20T05:00:00Z', '2026-08-15T16:30:00Z', '2026-08-20T05:00:00Z',
 'b1000001-0000-0000-0000-000000000020', NULL);

-- ============================================================
-- Tasks
-- ============================================================

INSERT OR IGNORE INTO tasks (id, ticket_id, title, status, assignee, sort_order, created_at, completed_at) VALUES
-- CAPA-1 (new): 3 tasks, all open
('tk-000001-0000-0000-0000-000000000001', 't1000001-0000-0000-0000-000000000001', 'Reproduce OCM auth error in dev environment', 'open', NULL, 1, '2026-08-03T05:00:00Z', NULL),
('tk-000001-0000-0000-0000-000000000002', 't1000001-0000-0000-0000-000000000001', 'Check OCM org role linkage in staging account', 'open', NULL, 2, '2026-08-03T05:00:00Z', NULL),
('tk-000001-0000-0000-0000-000000000003', 't1000001-0000-0000-0000-000000000001', 'File ticket with OCM team if org config issue', 'open', NULL, 3, '2026-08-03T05:00:00Z', NULL),

-- CAPA-2 (new): 3 tasks, all open
('tk-000001-0000-0000-0000-000000000004', 't1000001-0000-0000-0000-000000000002', 'Check MachinePool controller logs for scaling errors', 'open', NULL, 1, '2026-08-07T05:00:00Z', NULL),
('tk-000001-0000-0000-0000-000000000005', 't1000001-0000-0000-0000-000000000002', 'Check AWS EC2 quota limits in test account', 'open', NULL, 2, '2026-08-07T05:00:00Z', NULL),
('tk-000001-0000-0000-0000-000000000006', 't1000001-0000-0000-0000-000000000002', 'Increase timeout or add retry logic to test', 'open', NULL, 3, '2026-08-07T05:00:00Z', NULL),

-- CAPA-3 (new): 3 tasks, all open
('tk-000001-0000-0000-0000-000000000007', 't1000001-0000-0000-0000-000000000003', 'Check CloudFormation stack creation logs in AWS console', 'open', NULL, 1, '2026-08-06T06:30:00Z', NULL),
('tk-000001-0000-0000-0000-000000000008', 't1000001-0000-0000-0000-000000000003', 'Check for AWS subnet creation rate limits', 'open', NULL, 2, '2026-08-06T06:30:00Z', NULL),
('tk-000001-0000-0000-0000-000000000009', 't1000001-0000-0000-0000-000000000003', 'Determine if intermittent or consistent failure', 'open', NULL, 3, '2026-08-06T06:30:00Z', NULL),

-- CAPA-4 (investigating): 4 tasks, 1 done
('tk-000001-0000-0000-0000-000000000010', 't1000001-0000-0000-0000-000000000004', 'Confirm build05 is the affected cluster', 'done', 'jsmith@redhat.com', 1, '2026-08-08T05:45:00Z', '2026-08-08T07:00:00Z'),
('tk-000001-0000-0000-0000-000000000011', 't1000001-0000-0000-0000-000000000004', 'Contact build farm team (Slack: #forum-testplatform)', 'in_progress', 'jsmith@redhat.com', 2, '2026-08-08T05:45:00Z', NULL),
('tk-000001-0000-0000-0000-000000000012', 't1000001-0000-0000-0000-000000000004', 'Monitor recovery after build farm fix', 'open', NULL, 3, '2026-08-08T05:45:00Z', NULL),
('tk-000001-0000-0000-0000-000000000013', 't1000001-0000-0000-0000-000000000004', 'Document in runbook: build farm connectivity check', 'open', NULL, 4, '2026-08-08T05:45:00Z', NULL),

-- CAPA-5 (investigating): 4 tasks, 2 done
('tk-000001-0000-0000-0000-000000000014', 't1000001-0000-0000-0000-000000000005', 'Confirm intermittency rate (check last 20 builds)', 'done', 'tfitzger@redhat.com', 1, '2026-08-07T05:30:00Z', '2026-08-08T08:00:00Z'),
('tk-000001-0000-0000-0000-000000000015', 't1000001-0000-0000-0000-000000000005', 'Check AWS CloudFormation subnet creation API limits', 'done', 'tfitzger@redhat.com', 2, '2026-08-07T05:30:00Z', '2026-08-08T09:00:00Z'),
('tk-000001-0000-0000-0000-000000000016', 't1000001-0000-0000-0000-000000000005', 'Add retry logic to ROSANetwork ready wait', 'in_progress', 'tfitzger@redhat.com', 3, '2026-08-07T05:30:00Z', NULL),
('tk-000001-0000-0000-0000-000000000017', 't1000001-0000-0000-0000-000000000005', 'Extend ROSANetwork readiness timeout from 15m to 25m', 'open', NULL, 4, '2026-08-07T05:30:00Z', NULL),

-- CAPA-6 (root_caused): 4 tasks, 3 done
('tk-000001-0000-0000-0000-000000000018', 't1000001-0000-0000-0000-000000000006', 'Confirm v1beta1 vs v1beta2 apiGroup difference', 'done', 'tfitzger@redhat.com', 1, '2026-08-09T05:00:00Z', '2026-08-09T06:30:00Z'),
('tk-000001-0000-0000-0000-000000000019', 't1000001-0000-0000-0000-000000000006', 'Identify all affected templates in codebase', 'done', 'tfitzger@redhat.com', 2, '2026-08-09T05:00:00Z', '2026-08-09T07:00:00Z'),
('tk-000001-0000-0000-0000-000000000020', 't1000001-0000-0000-0000-000000000006', 'File upstream issue on cluster-api repo', 'done', 'tfitzger@redhat.com', 3, '2026-08-09T05:00:00Z', '2026-08-09T08:00:00Z'),
('tk-000001-0000-0000-0000-000000000021', 't1000001-0000-0000-0000-000000000006', 'Draft PR to update templates to v1beta2', 'in_progress', 'tfitzger@redhat.com', 4, '2026-08-09T05:00:00Z', NULL),

-- CAPA-7 (fix_in_progress): 5 tasks, 3 done
('tk-000001-0000-0000-0000-000000000022', 't1000001-0000-0000-0000-000000000007', 'Identify root cause: ROSAControlPlane finalizer stuck', 'done', 'tfitzger@redhat.com', 1, '2026-08-15T05:30:00Z', '2026-08-15T08:00:00Z'),
('tk-000001-0000-0000-0000-000000000023', 't1000001-0000-0000-0000-000000000007', 'Confirm CloudFormation DELETE_FAILED due to orphaned SG', 'done', 'tfitzger@redhat.com', 2, '2026-08-15T05:30:00Z', '2026-08-15T10:00:00Z'),
('tk-000001-0000-0000-0000-000000000024', 't1000001-0000-0000-0000-000000000007', 'Write VPC cleanup logic in delete task (PR #144)', 'done', 'tfitzger@redhat.com', 3, '2026-08-15T05:30:00Z', '2026-08-17T18:00:00Z'),
('tk-000001-0000-0000-0000-000000000025', 't1000001-0000-0000-0000-000000000007', 'Get PR #144 reviewed and merged', 'in_progress', 'tfitzger@redhat.com', 4, '2026-08-17T18:00:00Z', NULL),
('tk-000001-0000-0000-0000-000000000026', 't1000001-0000-0000-0000-000000000007', 'Verify fix in next nightly (expect #330)', 'open', NULL, 5, '2026-08-17T18:00:00Z', NULL),

-- CAPA-8 (fix_in_progress): 4 tasks, 3 done
('tk-000001-0000-0000-0000-000000000027', 't1000001-0000-0000-0000-000000000008', 'Identify all v1beta1 apiGroup refs in templates', 'done', 'jsmith@redhat.com', 1, '2026-08-11T05:00:00Z', '2026-08-11T08:00:00Z'),
('tk-000001-0000-0000-0000-000000000028', 't1000001-0000-0000-0000-000000000008', 'Update 4.22 feature templates to v1beta2', 'done', 'jsmith@redhat.com', 2, '2026-08-11T05:00:00Z', '2026-08-12T14:00:00Z'),
('tk-000001-0000-0000-0000-000000000029', 't1000001-0000-0000-0000-000000000008', 'Submit PR #142', 'done', 'jsmith@redhat.com', 3, '2026-08-11T05:00:00Z', '2026-08-13T10:00:00Z'),
('tk-000001-0000-0000-0000-000000000030', 't1000001-0000-0000-0000-000000000008', 'Await merge and nightly verification', 'in_progress', 'jsmith@redhat.com', 4, '2026-08-13T10:00:00Z', NULL),

-- CAPA-9 (resolved): 4 tasks, all done
('tk-000001-0000-0000-0000-000000000031', 't1000001-0000-0000-0000-000000000009', 'Confirm build05 is affected cluster', 'done', 'jsmith@redhat.com', 1, '2026-08-08T05:45:00Z', '2026-08-08T07:00:00Z'),
('tk-000001-0000-0000-0000-000000000032', 't1000001-0000-0000-0000-000000000009', 'Escalate to build farm team', 'done', 'jsmith@redhat.com', 2, '2026-08-08T05:45:00Z', '2026-08-08T09:00:00Z'),
('tk-000001-0000-0000-0000-000000000033', 't1000001-0000-0000-0000-000000000009', 'Monitor recovery after build farm fix', 'done', 'jsmith@redhat.com', 3, '2026-08-08T05:45:00Z', '2026-08-14T06:00:00Z'),
('tk-000001-0000-0000-0000-000000000034', 't1000001-0000-0000-0000-000000000009', 'Update runbook with build farm escalation path', 'done', 'jsmith@redhat.com', 4, '2026-08-08T05:45:00Z', '2026-08-14T08:00:00Z'),

-- CAPA-10 (verified): 5 tasks, all done
('tk-000001-0000-0000-0000-000000000035', 't1000001-0000-0000-0000-000000000010', 'Identify OCM role pre-flight check is missing', 'done', 'tfitzger@redhat.com', 1, '2026-08-03T05:30:00Z', '2026-08-04T09:00:00Z'),
('tk-000001-0000-0000-0000-000000000036', 't1000001-0000-0000-0000-000000000010', 'Write pre-flight OCM role validation task', 'done', 'tfitzger@redhat.com', 2, '2026-08-03T05:30:00Z', '2026-08-05T14:00:00Z'),
('tk-000001-0000-0000-0000-000000000037', 't1000001-0000-0000-0000-000000000010', 'Submit PR #139', 'done', 'tfitzger@redhat.com', 3, '2026-08-03T05:30:00Z', '2026-08-10T11:00:00Z'),
('tk-000001-0000-0000-0000-000000000038', 't1000001-0000-0000-0000-000000000010', 'PR #139 merged', 'done', 'tfitzger@redhat.com', 4, '2026-08-03T05:30:00Z', '2026-08-15T16:00:00Z'),
('tk-000001-0000-0000-0000-000000000039', 't1000001-0000-0000-0000-000000000010', 'Verify fix in nightly #330', 'done', 'tfitzger@redhat.com', 5, '2026-08-03T05:30:00Z', '2026-08-20T05:00:00Z');

-- ============================================================
-- Activities (25 total)
-- ============================================================

INSERT OR IGNORE INTO activities (id, activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES

-- Build ingestion events
('ac-000001-0000-0000-0000-000000000001', 'build_completed', 'Jenkins capi_tests #321 failure', 'Jenkins job capi_tests build #321 completed with status: failure. 2 test failures.',
 'b1000001-0000-0000-0000-000000000002', NULL, '@ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":321,"fail_count":2}',
 '2026-08-03T04:36:00Z'),

('ac-000001-0000-0000-0000-000000000002', 'ticket_created', 'CAPA-1: OCM auth failure auto-triaged', 'Auto-created by triage agent. Severity: nightly_blocker.',
 'b1000001-0000-0000-0000-000000000002', 't1000001-0000-0000-0000-000000000001', '@triage-agent',
 '{"severity":"nightly_blocker","auto_created":true}',
 '2026-08-03T05:00:00Z'),

('ac-000001-0000-0000-0000-000000000003', 'build_completed', 'Jenkins capi_tests #323 unstable', 'Jenkins job capi_tests build #323 completed with status: unstable. 2 test failures.',
 'b1000001-0000-0000-0000-000000000004', NULL, '@ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":323,"fail_count":2}',
 '2026-08-07T04:37:00Z'),

('ac-000001-0000-0000-0000-000000000004', 'ticket_created', 'CAPA-2: MachinePool scaling auto-triaged', 'Auto-created by triage agent. Severity: test_regression.',
 'b1000001-0000-0000-0000-000000000004', 't1000001-0000-0000-0000-000000000002', '@triage-agent',
 '{"severity":"test_regression","auto_created":true}',
 '2026-08-07T05:00:00Z'),

('ac-000001-0000-0000-0000-000000000005', 'ticket_created', 'CAPA-5: ROSANetwork flaky timeout auto-triaged', 'Auto-created by triage agent. Severity: flaky.',
 'b1000001-0000-0000-0000-000000000004', 't1000001-0000-0000-0000-000000000005', '@triage-agent',
 '{"severity":"flaky","auto_created":true}',
 '2026-08-07T05:30:00Z'),

('ac-000001-0000-0000-0000-000000000006', 'build_completed', 'Prow capa-e2e pw-8901 failure', 'Prow periodic job capa-e2e completed with status: failure. Build farm connectivity error.',
 'b1000001-0000-0000-0000-000000000012', NULL, '@ingest-prow',
 '{"source":"prow","job_name":"periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e"}',
 '2026-08-08T05:21:00Z'),

('ac-000001-0000-0000-0000-000000000007', 'streak_detected', 'Failure streak detected: capa-e2e (1 failure)', 'Prow job periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e has failed 1 consecutive build.',
 'b1000001-0000-0000-0000-000000000012', 't1000001-0000-0000-0000-000000000004', '@triage-agent',
 '{"streak_id":"fs-0000001-0000-0000-0000-000000000002","streak_length":1}',
 '2026-08-08T05:30:00Z'),

('ac-000001-0000-0000-0000-000000000008', 'ticket_created', 'CAPA-4: Build farm connectivity failure auto-triaged', 'Auto-created by triage agent. Severity: infrastructure.',
 'b1000001-0000-0000-0000-000000000012', 't1000001-0000-0000-0000-000000000004', '@triage-agent',
 '{"severity":"infrastructure","auto_created":true}',
 '2026-08-08T05:45:00Z'),

('ac-000001-0000-0000-0000-000000000009', 'diagnosis_completed', 'CAPA-4: Diagnosed as build_farm_failure', 'Root cause: Prow build farm build05 networking degraded.',
 'b1000001-0000-0000-0000-000000000012', 't1000001-0000-0000-0000-000000000004', '@diagnosis-agent',
 '{"matched_pattern":"build_farm_failure","root_cause_category":"infrastructure"}',
 '2026-08-08T06:00:00Z'),

('ac-000001-0000-0000-0000-000000000010', 'diagnosis_completed', 'CAPA-5: Diagnosed as rosa_network_timeout', 'Root cause: AWS API rate limiting on subnet creation causing intermittent CloudFormation stall.',
 'b1000001-0000-0000-0000-000000000004', 't1000001-0000-0000-0000-000000000005', '@diagnosis-agent',
 '{"matched_pattern":"rosa_network_timeout","root_cause_category":"aws_rate_limit"}',
 '2026-08-08T07:00:00Z'),

('ac-000001-0000-0000-0000-000000000011', 'build_completed', 'Jenkins capi_tests #324 failure', 'Jenkins job capi_tests build #324 completed with status: failure. 5 test failures.',
 'b1000001-0000-0000-0000-000000000005', NULL, '@ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":324,"fail_count":5}',
 '2026-08-09T04:44:00Z'),

('ac-000001-0000-0000-0000-000000000012', 'ticket_created', 'CAPA-6: CAPI v1beta2 migration auto-triaged', 'Auto-created by triage agent. Severity: upstream_breakage.',
 'b1000001-0000-0000-0000-000000000005', 't1000001-0000-0000-0000-000000000006', '@triage-agent',
 '{"severity":"upstream_breakage","auto_created":true}',
 '2026-08-09T05:00:00Z'),

('ac-000001-0000-0000-0000-000000000013', 'diagnosis_completed', 'CAPA-6: Diagnosed as capi_not_installed (v1beta2 migration)', 'Root cause: CAPI v1beta2 apiGroup required in OCP 4.22+. Templates still use v1beta1.',
 'b1000001-0000-0000-0000-000000000005', 't1000001-0000-0000-0000-000000000006', '@diagnosis-agent',
 '{"matched_pattern":"capi_not_installed","root_cause_category":"capi_migration"}',
 '2026-08-09T06:00:00Z'),

('ac-000001-0000-0000-0000-000000000014', 'build_completed', 'Prow capa-e2e pw-8903 failure (streak day 3)', 'Prow capa-e2e failed for 3rd consecutive day. Build farm still degraded.',
 'b1000001-0000-0000-0000-000000000014', 't1000001-0000-0000-0000-000000000004', '@ingest-prow',
 '{"source":"prow","streak_length":3}',
 '2026-08-12T05:22:00Z'),

('ac-000001-0000-0000-0000-000000000015', 'streak_resolved', 'Streak resolved: capa-e2e build farm connectivity', 'Prow capa-e2e ran successfully after 3-day build farm outage. Build farm team resolved networking on Aug 13.',
 'b1000001-0000-0000-0000-000000000015', 't1000001-0000-0000-0000-000000000009', '@ingest-prow',
 '{"streak_id":"fs-0000001-0000-0000-0000-000000000002","resolution":"build_farm_fixed"}',
 '2026-08-14T05:33:00Z'),

('ac-000001-0000-0000-0000-000000000016', 'fix_submitted', 'CAPA-8: PR #142 submitted -- CAPI v1beta2 templates', 'PR updates all 4.22 feature templates to use CAPI v1beta2 apiGroup.',
 NULL, 't1000001-0000-0000-0000-000000000008', 'jsmith@redhat.com',
 '{"pr_url":"https://github.com/stolostron/rosa-hcp-e2e-test/pull/142","pr_number":142}',
 '2026-08-13T10:00:00Z'),

('ac-000001-0000-0000-0000-000000000017', 'build_completed', 'Jenkins capi_tests #327 failure (streak day 1)', 'Jenkins capi_tests #327 failed. ROSAControlPlane stuck in deletion. Streak started.',
 'b1000001-0000-0000-0000-000000000008', NULL, '@ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":327,"fail_count":7}',
 '2026-08-15T04:46:00Z'),

('ac-000001-0000-0000-0000-000000000018', 'streak_detected', 'Failure streak detected: capi_tests ROSAControlPlane deletion (Day 1)', 'Jenkins capi_tests has started a new failure streak. ROSAControlPlane stuck in deletion with CloudFormation DELETE_FAILED.',
 'b1000001-0000-0000-0000-000000000008', 't1000001-0000-0000-0000-000000000007', '@triage-agent',
 '{"streak_id":"fs-0000001-0000-0000-0000-000000000001","streak_length":1}',
 '2026-08-15T05:15:00Z'),

('ac-000001-0000-0000-0000-000000000019', 'ticket_created', 'CAPA-7: ROSAControlPlane stuck deletion auto-triaged (nightly blocker)', 'Auto-created by triage agent. Severity: nightly_blocker. Active streak.',
 'b1000001-0000-0000-0000-000000000008', 't1000001-0000-0000-0000-000000000007', '@triage-agent',
 '{"severity":"nightly_blocker","auto_created":true,"streak_id":"fs-0000001-0000-0000-0000-000000000001"}',
 '2026-08-15T05:30:00Z'),

('ac-000001-0000-0000-0000-000000000020', 'diagnosis_completed', 'CAPA-7: Diagnosed as rosacontrolplane_stuck_deletion', 'Root cause: CloudFormation DELETE_FAILED due to orphaned security group blocking VPC cleanup.',
 'b1000001-0000-0000-0000-000000000008', 't1000001-0000-0000-0000-000000000007', '@diagnosis-agent',
 '{"matched_pattern":"rosacontrolplane_stuck_deletion","root_cause_category":"rosa_lifecycle"}',
 '2026-08-15T06:00:00Z'),

('ac-000001-0000-0000-0000-000000000021', 'note_added', 'CAPA-7: CloudFormation cleanup identified as root fix', 'Need to add VPC dependency cleanup (SGs, ENIs, VPC endpoints) before retrying CF stack deletion in e2e teardown.',
 NULL, 't1000001-0000-0000-0000-000000000007', 'tfitzger@redhat.com',
 '{"note":"CloudFormation DELETE_FAILED recovery requires orphaned SG cleanup first"}',
 '2026-08-15T10:30:00Z'),

('ac-000001-0000-0000-0000-000000000022', 'fix_submitted', 'CAPA-7: PR #144 submitted -- harden VPC cleanup in delete task', 'PR adds SG/ENI/VPCE/IGW/NAT cleanup before CloudFormation retry. Also converts shell tasks to ansible.builtin.shell for ansible-core 2.19.',
 NULL, 't1000001-0000-0000-0000-000000000007', 'tfitzger@redhat.com',
 '{"pr_url":"https://github.com/stolostron/rosa-hcp-e2e-test/pull/144","pr_number":144}',
 '2026-08-17T18:00:00Z'),

('ac-000001-0000-0000-0000-000000000023', 'fix_merged', 'CAPA-10: PR #139 merged -- OCM role pre-flight check', 'PR #139 merged. Pre-flight OCM role validation added to provisioning playbook. Fail-fast with clear error instead of 42-minute timeout.',
 NULL, 't1000001-0000-0000-0000-000000000010', 'tfitzger@redhat.com',
 '{"pr_url":"https://github.com/stolostron/rosa-hcp-e2e-test/pull/139","pr_number":139}',
 '2026-08-15T16:00:00Z'),

('ac-000001-0000-0000-0000-000000000024', 'build_completed', 'Jenkins capi_tests #330 success -- OCM fix verified', 'Jenkins capi_tests #330 passed all tests. OCM role pre-flight check PR #139 verified.',
 'b1000001-0000-0000-0000-000000000020', 't1000001-0000-0000-0000-000000000010', '@ingest-jenkins',
 '{"source":"jenkins","job_name":"capi_tests","build_number":330,"pass_count":42,"fail_count":0}',
 '2026-08-20T04:37:00Z'),

('ac-000001-0000-0000-0000-000000000025', 'ticket_updated', 'CAPA-10: Ticket verified -- OCM role fix confirmed in #330', 'Ticket moved to verified status. OCM auth failure no longer occurring in #330.',
 'b1000001-0000-0000-0000-000000000020', 't1000001-0000-0000-0000-000000000010', '@ingest-jenkins',
 '{"previous_status":"resolved","new_status":"verified","verified_in_build":"b1000001-0000-0000-0000-000000000020"}',
 '2026-08-20T05:00:00Z');

-- ============================================================
-- Ticket CAPA-3 (ROSANetwork flaky, prow full) activities
-- ============================================================

INSERT OR IGNORE INTO activities (id, activity_type, title, description, build_id, ticket_id, actor, metadata, created_at) VALUES
('ac-000001-0000-0000-0000-000000000026', 'build_completed', 'Prow capa-e2e-full pw-full-102 failure', 'Prow capa-e2e-full completed with status: failure. ROSANetwork timeout.',
 'b1000001-0000-0000-0000-000000000018', NULL, '@ingest-prow',
 '{"source":"prow","job_name":"periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e-full"}',
 '2026-08-06T06:11:00Z'),

('ac-000001-0000-0000-0000-000000000027', 'ticket_created', 'CAPA-3: ROSANetwork flaky timeout auto-triaged', 'Auto-created by triage agent. Severity: flaky.',
 'b1000001-0000-0000-0000-000000000018', 't1000001-0000-0000-0000-000000000003', '@triage-agent',
 '{"severity":"flaky","auto_created":true}',
 '2026-08-06T06:30:00Z');

-- ============================================================
-- Update matched_pattern and diagnosed_at on tickets
-- ============================================================

UPDATE support_tickets SET matched_pattern = 'ocm_role_missing'               WHERE id = 't1000001-0000-0000-0000-000000000001';
UPDATE support_tickets SET matched_pattern = 'build_farm_failure'             WHERE id = 't1000001-0000-0000-0000-000000000004';
UPDATE support_tickets SET matched_pattern = 'rosa_network_timeout'           WHERE id = 't1000001-0000-0000-0000-000000000005';
UPDATE support_tickets SET matched_pattern = 'capi_not_installed'             WHERE id = 't1000001-0000-0000-0000-000000000006';
UPDATE support_tickets SET matched_pattern = 'rosacontrolplane_stuck_deletion' WHERE id = 't1000001-0000-0000-0000-000000000007';
UPDATE support_tickets SET matched_pattern = 'capi_not_installed'             WHERE id = 't1000001-0000-0000-0000-000000000008';
UPDATE support_tickets SET matched_pattern = 'build_farm_failure'             WHERE id = 't1000001-0000-0000-0000-000000000009';
UPDATE support_tickets SET matched_pattern = 'ocm_role_missing'               WHERE id = 't1000001-0000-0000-0000-000000000010';

-- ============================================================
-- SOP Mappings (preserved from original)
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
