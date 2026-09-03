/**
 * Unit tests for ticket-title composition and repair.
 *
 * Covers the doubling bug (Jenkins RHACM4K reports carry the same "KEY: summary"
 * in both className and name), idempotency, truncation, the false-positive
 * guard on periodic non-key titles, and the repair transform used on
 * already-stored rows (dedupe BEFORE strip — the ordering that a prior version
 * got wrong).
 */

import { describe, it, expect } from 'vitest';
import {
  composeTicketTitle,
  dedupeTitleSegments,
  stripRedundantKeyPrefix,
  truncateTitle,
  MAX_TITLE_LENGTH,
} from '../agents/ticket-title.js';

// The repair transform, mirrored from scripts/repair-ticket-titles.ts so the
// ordering contract is locked by a test (dedupe -> strip -> truncate).
function repairTitle(title: string): string {
  return truncateTitle(stripRedundantKeyPrefix(dedupeTitleSegments(title)));
}

describe('composeTicketTitle', () => {
  it('collapses the Jenkins double (same KEY: summary in className and name)', () => {
    const payload = 'RHACM4K-61815: Provisions a ROSA HCP cluster using CAPA';
    // className carries a prefix + the key; name is the key + summary.
    const className = 'CAPA Cluster Provisioning ' + payload;
    expect(composeTicketTitle(className, payload, 'fallback')).toBe(payload);
  });

  it('keeps distinct Prow-style className: name intact', () => {
    expect(
      composeTicketTitle('ProwJobExecution', 'prow-job-result', 'fallback'),
    ).toBe('ProwJobExecution: prow-job-result');
  });

  it('keeps a genuinely distinct className: name intact', () => {
    expect(
      composeTicketTitle('Cluster Suite', 'Should create a cluster', 'fallback'),
    ).toBe('Cluster Suite: Should create a cluster');
  });

  it('is idempotent — re-composing an already-composed title is a no-op', () => {
    const payload = 'RHACM4K-61815: Provisions a ROSA HCP cluster';
    const once = composeTicketTitle('CAPA Provisioning ' + payload, payload, 'fb');
    const twice = composeTicketTitle(once, once, 'fb');
    expect(twice).toBe(once);
  });

  it('falls back when both sides are empty', () => {
    expect(composeTicketTitle('', '', 'the fallback')).toBe('the fallback');
    expect(composeTicketTitle(null, null, 'the fallback')).toBe('the fallback');
  });

  it('uses the non-empty side when one is missing', () => {
    expect(composeTicketTitle('', 'just a name', 'fb')).toBe('just a name');
    expect(composeTicketTitle('just a class', '', 'fb')).toBe('just a class');
  });
});

describe('dedupeTitleSegments', () => {
  it('folds a keyed whole-string repeat to one copy', () => {
    expect(dedupeTitleSegments('RHACM4K-1: sum: RHACM4K-1: sum')).toBe(
      'RHACM4K-1: sum',
    );
  });

  it('does NOT fold a periodic non-key title (false-positive guard)', () => {
    expect(dedupeTitleSegments('a: b: a: b')).toBe('a: b: a: b');
  });

  it('drops adjacent duplicate segments', () => {
    expect(dedupeTitleSegments('RHACM4K-1: RHACM4K-1: summary')).toBe(
      'RHACM4K-1: summary',
    );
  });

  it('is idempotent', () => {
    const once = dedupeTitleSegments('RHACM4K-1: sum: RHACM4K-1: sum');
    expect(dedupeTitleSegments(once)).toBe(once);
  });
});

describe('truncateTitle', () => {
  it('never exceeds the max, ellipsis included', () => {
    const long = 'word '.repeat(60).trim();
    const out = truncateTitle(long, MAX_TITLE_LENGTH);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('hard-cuts a single over-long word', () => {
    const out = truncateTitle('x'.repeat(200), 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short input unchanged', () => {
    expect(truncateTitle('short title')).toBe('short title');
  });
});

describe('repairTitle (dedupe before strip)', () => {
  it('repairs a doubled title that carries a leading className prefix', () => {
    // The real stored shape: the WHOLE composed title (prefix + key + summary)
    // is repeated. Dedupe must run first so the symmetric halves match.
    const half = 'CAPA Cluster Provisioning RHACM4K-61815: Provisions a cluster';
    const doubled = `${half}: ${half}`;
    expect(repairTitle(doubled)).toBe('RHACM4K-61815: Provisions a cluster');
  });

  it('repairs the no-prefix doubled shape', () => {
    const half = 'RHACM4K-61815: Provisions a cluster';
    expect(repairTitle(`${half}: ${half}`)).toBe(half);
  });

  it('leaves an [Infra] title unchanged', () => {
    const infra = '[Infra] Configure MCE Environment: OCM_CLIENT_ID undefined -- rosa-creds-secret';
    expect(repairTitle(infra)).toBe(infra);
  });

  it('leaves a clean Prow title unchanged', () => {
    expect(repairTitle('ProwJobExecution: prow-job-result')).toBe(
      'ProwJobExecution: prow-job-result',
    );
  });

  it('is idempotent — repairing twice is a no-op', () => {
    const half = 'CAPA Cluster Provisioning RHACM4K-61815: Provisions a cluster';
    const once = repairTitle(`${half}: ${half}`);
    expect(repairTitle(once)).toBe(once);
  });
});
