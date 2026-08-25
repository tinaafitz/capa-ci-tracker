/**
 * classify-failure -- pure classifier for CI failure taxonomy
 *
 * Exported from this module for use by ingest agents and the backfill script.
 * No database access; no side effects.
 */

// ============================================================
// Taxonomy
// ============================================================

export const FAILURE_TAXONOMY = [
  'product_test_failure',
  'infra_lease',
  'infra_auth',
  'infra_provision',
  'infra_teardown',
  'infra_timeout',
  'aborted',
  'flake',
  'unknown',
] as const;

export type FailureClass = (typeof FAILURE_TAXONOMY)[number];

export function isInfraClass(cls: FailureClass | string): boolean {
  return cls.startsWith('infra_') || cls === 'aborted';
}

// ============================================================
// Input / Output
// ============================================================

export interface ClassifyInput {
  status: string;
  jobName: string;
  description?: string;
  reason?: string;
  testsPassed?: boolean | null;
  failCount: number;
}

export interface ClassifyResult {
  failure_class: FailureClass;
  failure_reason: string | null;
  is_infra: 0 | 1;
}

// ============================================================
// Signature regexes
// ============================================================

/**
 * HIGH-CONFIDENCE: Prow harness step-graph reason strings.
 *
 * These are structured colon-delimited tokens produced by the Prow entrypoint
 * binary — they NEVER appear in test assertion output, so they are safe to
 * match even when failCount > 0.
 *
 * Matches forms like:
 *   executing_graph:step_failed:utilizing_lease:releasing_lease
 *   executing_graph:step_failed:ipi-conf:provision
 *   executing_graph:step_failed:gather-must-gather
 */
const RE_PROW_HARNESS =
  /executing_graph:step_failed(?::[\w-]+)*/i;

// Sub-classifiers for the harness reason
const RE_HARNESS_LEASE    = /utilizing[_-]?lease|releasing[_-]?lease/i;
const RE_HARNESS_TEARDOWN = /deprovision|teardown|gather/i;
const RE_HARNESS_PROVISION = /ipi-conf|provision|install/i;

/**
 * BROAD regexes — only applied when failCount === 0 (no test failures
 * recorded) so we never mislabel a product test failure that happens to
 * contain infra-sounding words in its error message.
 */
const RE_LEASE =
  /releasing[_\s-]?lease|utilizing[_\s-]?lease|boskos|quota-slice|lease-proxy/i;

const RE_AUTH =
  /\b401 Unauthorized\b|\b403 Forbidden\b|\bunauthorized\b|\bforbidden\b/i;

const RE_TEARDOWN =
  /deprovision|teardown|gather/i;

const RE_PROVISION =
  /ipi-conf|provision|install/i;

const RE_TIMEOUT =
  /timed? ?out|context deadline exceeded/i;

// ============================================================
// Classifier
// ============================================================

export function classifyFailure(input: ClassifyInput): ClassifyResult {
  const { status, testsPassed, failCount } = input;
  const text = (input.reason ?? '') + ' ' + (input.description ?? '');

  // Rule 1 — aborted: always infra regardless of test counts
  if (status === 'aborted') {
    return { failure_class: 'aborted', failure_reason: null, is_infra: 1 };
  }

  if (status !== 'failure' && status !== 'unstable') {
    return { failure_class: 'unknown', failure_reason: null, is_infra: 0 };
  }

  // Rule 2 — Prow harness step-graph reason (HIGH CONFIDENCE).
  // The structured `executing_graph:step_failed:...` token is exclusively
  // produced by the Prow entrypoint; it cannot appear in test output.
  // Safe to match even when failCount > 0.
  if (RE_PROW_HARNESS.test(text)) {
    return classifyHarnessReason(text);
  }

  // Rule 3 — tests known to have passed but overall job failed → infra post-step.
  // (testsPassed===true means finished.json reported passed=true but the job
  // still ended in failure — a post-test infra step broke.)
  if (testsPassed === true) {
    return classifyInfraText(text);
  }

  // Rule 4 — real test failures: failCount > 0 with no high-confidence harness
  // signal → product failure regardless of infra-sounding words in the error.
  if (failCount > 0) {
    return { failure_class: 'product_test_failure', failure_reason: null, is_infra: 0 };
  }

  // Rule 5 — failCount === 0, no harness signal, tests not known passed:
  // apply broad infra-word regexes. These are safe here because there are
  // no recorded test failures that could produce false-positive infra words.
  if (RE_LEASE.test(text))    return infraResult('infra_lease',    text, RE_LEASE);
  if (RE_AUTH.test(text))     return infraResult('infra_auth',     text, RE_AUTH);
  if (RE_TIMEOUT.test(text))  return infraResult('infra_timeout',  text, RE_TIMEOUT);

  // Rule 6 — fallback
  return { failure_class: 'unknown', failure_reason: null, is_infra: 0 };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Classify a build whose text contains a Prow step-graph harness reason.
 * Sub-classifies by the step kind embedded in the reason tokens.
 */
function classifyHarnessReason(text: string): ClassifyResult {
  if (RE_HARNESS_LEASE.test(text))     return infraResult('infra_lease',     text, RE_PROW_HARNESS);
  if (RE_HARNESS_TEARDOWN.test(text))  return infraResult('infra_teardown',  text, RE_PROW_HARNESS);
  if (RE_HARNESS_PROVISION.test(text)) return infraResult('infra_provision', text, RE_PROW_HARNESS);
  // Generic harness step failure with no sub-type → teardown (safest default)
  return infraResult('infra_teardown', text, RE_PROW_HARNESS);
}

/**
 * Classify infra sub-type when we know tests passed (Rule 3 path).
 * Broad regexes are safe here because testsPassed===true means there were
 * no product test failures.
 * Falls back to infra_teardown when no sub-signature matches.
 */
function classifyInfraText(text: string): ClassifyResult {
  if (RE_LEASE.test(text))    return infraResult('infra_lease',    text, RE_LEASE);
  if (RE_AUTH.test(text))     return infraResult('infra_auth',     text, RE_AUTH);
  if (RE_TIMEOUT.test(text))  return infraResult('infra_timeout',  text, RE_TIMEOUT);
  // No specific infra sub-signature — generic post-test infra step failure
  return { failure_class: 'infra_teardown', failure_reason: trimReason(text), is_infra: 1 };
}

function infraResult(cls: FailureClass, text: string, re: RegExp): ClassifyResult {
  const match = text.match(re);
  const failure_reason = match ? trimReason(match[0]) : trimReason(text);
  return { failure_class: cls, failure_reason, is_infra: 1 };
}

function trimReason(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Cap at 500 chars to stay well within the TEXT column
  return trimmed.length > 500 ? trimmed.substring(0, 500) : trimmed;
}
