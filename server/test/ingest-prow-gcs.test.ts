/**
 * Unit tests for the GCS artifact helpers in ingest-prow.
 *
 * These are pure-function tests — no network, no database.
 * Covers:
 *   - deriveGcsBase: URL parsing from Prow view URL and fallback construction
 *   - extractReasonFromBuildLog: regex extraction from sample build-log.txt text
 *   - Integration: given a real lease/401 build-log sample → classifyFailure → infra_lease
 */

import { describe, it, expect } from 'vitest';
import {
  deriveGcsBase,
  extractReasonFromBuildLog,
} from '../agents/ingest-prow.js';
import { classifyFailure } from '../agents/classify-failure.js';

// ---------------------------------------------------------------------------
// deriveGcsBase
// ---------------------------------------------------------------------------

describe('deriveGcsBase', () => {
  const BUCKET = 'https://storage.googleapis.com/test-platform-results/logs';

  it('parses a canonical Prow view URL', () => {
    const jobUrl =
      'https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2092160617925316608/';
    const base = deriveGcsBase(jobUrl, 'periodic-ci-capa', '2092160617925316608');
    expect(base).toBe(
      `${BUCKET}/periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e/2092160617925316608`,
    );
  });

  it('falls back to jobName + externalId when URL does not match', () => {
    const base = deriveGcsBase(null, 'periodic-ci-capa-e2e', 'build-123');
    expect(base).toBe(`${BUCKET}/periodic-ci-capa-e2e/build-123`);
  });

  it('falls back to jobName + externalId for an unrecognised URL', () => {
    const base = deriveGcsBase(
      'https://example.com/some-other-url',
      'capa-e2e',
      '999',
    );
    expect(base).toBe(`${BUCKET}/capa-e2e/999`);
  });
});

// ---------------------------------------------------------------------------
// extractReasonFromBuildLog
// ---------------------------------------------------------------------------

// Realistic build-log.txt excerpt for the Boskos lease-401 scenario
const LEASE_401_LOG = `
2024/01/15 04:52:11 Running step capa-e2e
2024/01/15 04:52:11 step capa-e2e succeeded
2024/01/15 04:52:12 Running step gather-must-gather
2024/01/15 04:52:14 step gather-must-gather succeeded
2024/01/15 04:52:15 Running step deprovision
2024/01/15 04:52:16 step deprovision succeeded
2024/01/15 04:52:17 Releasing lease for aws-3--us-east-1--quota-slice-335
2024/01/15 04:52:17 step release failed: status 401 Unauthorized for releasing aws-3--us-east-1--quota-slice-335
2024/01/15 04:52:17 * could not run steps: step release failed: 401 Unauthorized releasing quota-slice
2024/01/15 04:52:17 Reporting job state 'failed' with reason 'executing_graph:step_failed:utilizing_lease:releasing_lease'
`;

const STEP_FAILED_ONLY_LOG = `
2024/01/15 04:52:17 step ipi-conf failed: error creating VPC: operation timed out
`;

const COULD_NOT_RUN_LOG = `
2024/01/15 04:52:17 * could not run steps: install cluster: context deadline exceeded
`;

const NO_MATCH_LOG = `
2024/01/15 04:52:17 Something went wrong but no recognisable pattern here
`;

describe('extractReasonFromBuildLog', () => {
  it('prefers "Reporting job state" reason over other lines', () => {
    const reason = extractReasonFromBuildLog(LEASE_401_LOG);
    expect(reason).toBe(
      'executing_graph:step_failed:utilizing_lease:releasing_lease',
    );
  });

  it('falls back to "could not run steps" when no Reporting line', () => {
    const reason = extractReasonFromBuildLog(COULD_NOT_RUN_LOG);
    expect(reason).toBe('install cluster: context deadline exceeded');
  });

  it('falls back to "step ... failed" when no Reporting or could-not-run line', () => {
    const reason = extractReasonFromBuildLog(STEP_FAILED_ONLY_LOG);
    expect(reason).toContain('error creating VPC');
  });

  it('returns null when no pattern matches', () => {
    const reason = extractReasonFromBuildLog(NO_MATCH_LOG);
    expect(reason).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractReasonFromBuildLog('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: lease-401 build-log → classifyFailure → infra_lease
// ---------------------------------------------------------------------------

describe('lease-401 build-log → infra_lease (integration)', () => {
  it('classifies the real lease-401 Prow build as infra_lease', () => {
    // Simulate what ingest-prow does: extract reason then classify
    const reason = extractReasonFromBuildLog(LEASE_401_LOG);
    expect(reason).toBeTruthy();

    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-openshift-online-rosa-e2e-main_capa-e2e-capa-e2e',
      description: 'Job failed.',  // what the feed actually returns
      reason: reason!,             // what we extract from build-log.txt
      failCount: 0,
    });

    expect(result.failure_class).toBe('infra_lease');
    expect(result.is_infra).toBe(1);
    expect(result.failure_reason).toBeTruthy();
  });

  it('step-failed 401 line (no Reporting line) also → infra_auth or infra_lease', () => {
    // Even without the Reporting line, "step release failed: 401 Unauthorized"
    // should still classify as an infra class
    const singleLineLog = `step release failed: status 401 Unauthorized for releasing aws-3--us-east-1--quota-slice-335`;
    const reason = extractReasonFromBuildLog(singleLineLog);
    expect(reason).toBeTruthy();

    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-capa',
      reason: reason!,
      failCount: 0,
    });

    // quota-slice in the reason → infra_lease
    expect(result.is_infra).toBe(1);
    expect(['infra_lease', 'infra_auth']).toContain(result.failure_class);
  });

  it('product test failure with "Job failed." description stays product_test_failure', () => {
    const result = classifyFailure({
      status: 'failure',
      jobName: 'periodic-ci-capa',
      description: 'Job failed.',
      reason: 'Job failed.',
      failCount: 3,
    });
    expect(result.failure_class).toBe('product_test_failure');
    expect(result.is_infra).toBe(0);
  });
});
