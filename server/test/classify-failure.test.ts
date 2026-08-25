/**
 * Unit tests for the classify-failure agent.
 *
 * Covers the major rule branches:
 *   - aborted status
 *   - lease/Boskos infra failure (401 Unauthorized + releasing lease)
 *   - plain product test failure
 *   - unknown / empty input
 */

import { describe, it, expect } from 'vitest';
import { classifyFailure, isInfraClass } from '../agents/classify-failure.js';

describe('classifyFailure', () => {
  // ---------------------------------------------------------------
  // No-data guard rationale
  //
  // When a Jenkins test report cannot be fetched, the ingest agent sees
  // failCount=0 / testsPassed=null / no reason. This test documents that the
  // classifier returns 'unknown' for that input -- which is WHY ingest-jenkins
  // must NOT feed these inputs when it already has a stored classification
  // (otherwise a transient fetch failure would downgrade a real
  // product_test_failure to 'unknown'). See the testReport==null guard in
  // ingest-jenkins.ts.
  // ---------------------------------------------------------------

  it('returns unknown when there is no failure data (report unavailable)', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capi_tests',
      reason: undefined,
      testsPassed: null,
      failCount: 0,
    });
    expect(result.failure_class).toBe('unknown');
    expect(result.is_infra).toBe(0);
  });

  // ---------------------------------------------------------------
  // Aborted
  // ---------------------------------------------------------------

  it('classifies aborted status as aborted (is_infra=1)', () => {
    const result = classifyFailure({
      status: 'aborted',
      jobName: 'some-job',
      failCount: 0,
    });
    expect(result.failure_class).toBe('aborted');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // Infra: lease / Boskos  (the real Prow example from the spec)
  // ---------------------------------------------------------------

  it('classifies releasing-lease 401 as infra_lease when tests passed', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
      description: 'executing_graph:step_failed:utilizing_lease:releasing_lease',
      reason:
        '401 Unauthorized ... releasing aws-3--us-east-1--quota-slice-335',
      testsPassed: true,
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_lease');
    expect(result.is_infra).toBe(1);
    expect(result.failure_reason).toBeTruthy();
  });

  it('classifies boskos in description as infra_lease', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-capa',
      description: 'boskos lease proxy returned 503',
      testsPassed: true,
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_lease');
    expect(result.is_infra).toBe(1);
  });

  it('classifies quota-slice mention as infra_lease', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      reason: 'quota-slice aws-3--us-east-1--quota-slice-335 not released',
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_lease');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // Infra: auth
  // ---------------------------------------------------------------

  it('classifies 401 Unauthorized (no lease keyword) as infra_auth', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      description: '401 Unauthorized while calling AWS STS',
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_auth');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // Infra: teardown (graph-step + deprovision)
  // ---------------------------------------------------------------

  it('classifies executing_graph+teardown as infra_teardown when tests passed', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      description: 'executing_graph:step_failed — deprovision cluster failed',
      testsPassed: true,
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_teardown');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // Infra: timeout
  // ---------------------------------------------------------------

  it('classifies context deadline exceeded as infra_timeout', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      reason: 'context deadline exceeded waiting for node pool',
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_timeout');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // Product test failure
  // ---------------------------------------------------------------

  it('classifies real test failures as product_test_failure', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'rosa-hcp-e2e',
      description: 'TestClusterLifecycle: expected cluster to be Ready, got Failed',
      failCount: 3,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });

  it('classifies as product_test_failure when testsPassed is false and failCount>0', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-nightly',
      failCount: 5,
      testsPassed: false,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });

  // ---------------------------------------------------------------
  // Unknown / empty
  // ---------------------------------------------------------------

  it('returns unknown for empty input with status failure and failCount=0', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'some-job',
      failCount: 0,
    });
    expect(result.failure_class).toBe('unknown');
    expect(result.is_infra).toBe(0);
  });

  it('returns unknown for success status', () => {
    const result = classifyFailure({
      status: 'success',
      jobName: 'some-job',
      failCount: 0,
    });
    expect(result.failure_class).toBe('unknown');
    expect(result.is_infra).toBe(0);
  });

  // ---------------------------------------------------------------
  // SAFETY: infra-sounding words in product test output must NOT
  // mislabel the build as infra when failCount > 0.
  // (These were the confirmed wrong outputs before the fix.)
  // ---------------------------------------------------------------

  it('does NOT classify as infra when "unauthorized" appears in test output (failCount=3)', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'rosa-hcp-e2e',
      reason: 'failed to create MachinePool: unauthorized to update CRD',
      failCount: 3,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });

  it('does NOT classify as infra_timeout when "context deadline exceeded" is in test output (failCount=2)', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      reason: 'context deadline exceeded waiting for cluster Ready',
      failCount: 2,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });

  it('does NOT classify as infra_auth when "403 Forbidden" appears in test output (failCount=1)', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      reason: '403 Forbidden from k8s API during test assertion',
      failCount: 1,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });

  // ---------------------------------------------------------------
  // Prow harness reason (executing_graph) → infra EVEN with failCount > 0
  // ---------------------------------------------------------------

  it('classifies executing_graph lease reason as infra_lease even when failCount=1', () => {
    // Real lease-401 Prow build: the harness reports executing_graph:step_failed:utilizing_lease
    // The Prow entrypoint may record failCount=1 even though tests passed — the
    // structured harness reason is the decisive high-confidence signal.
    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
      reason: 'executing_graph:step_failed:utilizing_lease:releasing_lease',
      description: 'Job failed.',
      failCount: 1,
    });
    expect(result.failure_class).toBe('infra_lease');
    expect(result.is_infra).toBe(1);
  });

  it('classifies executing_graph teardown step as infra_teardown', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'capa-e2e',
      reason: 'executing_graph:step_failed:deprovision',
      failCount: 0,
    });
    expect(result.failure_class).toBe('infra_teardown');
    expect(result.is_infra).toBe(1);
  });

  // ---------------------------------------------------------------
  // isInfraClass helper
  // ---------------------------------------------------------------

  it('isInfraClass returns true for infra_ prefixed classes', () => {
    expect(isInfraClass('infra_lease')).toBe(true);
    expect(isInfraClass('infra_auth')).toBe(true);
    expect(isInfraClass('infra_teardown')).toBe(true);
    expect(isInfraClass('aborted')).toBe(true);
  });

  it('isInfraClass returns false for product and unknown classes', () => {
    expect(isInfraClass('product_test_failure')).toBe(false);
    expect(isInfraClass('unknown')).toBe(false);
    expect(isInfraClass('flake')).toBe(false);
  });
});
