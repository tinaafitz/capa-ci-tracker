/**
 * Unit tests for the ticket data-quality helpers: pulling the guest OCP version
 * out of the free-form EXTRA_FEATURE_VARS parameter, and pulling the salient
 * part out of an Ansible-driven error message.
 *
 * Both exist because capi_tests reports are hostile to naive extraction --
 * the version is not a first-class build parameter, and every failure message
 * opens with hundreds of characters of Ansible boilerplate.
 */

import { describe, it, expect } from 'vitest';
import { extractOcpVersion } from '../agents/ingest-jenkins.js';
import { extractSalientError } from '../agents/triage.js';
import { KNOWN_ISSUES } from '../agents/known-issues.js';
import { composeDiagnosedTitle } from '../agents/diagnosis.js';
import { MAX_TITLE_LENGTH } from '../agents/ticket-title.js';

describe('extractOcpVersion', () => {
  it('prefers a first-class parameter when present', () => {
    expect(extractOcpVersion({ OCP_VERSION: '4.22.9' })).toBe('4.22.9');
  });

  it('parses openshift_version out of EXTRA_FEATURE_VARS', () => {
    expect(
      extractOcpVersion({
        EXTRA_FEATURE_VARS: 'openshift_version=5.0.0-rc.0 channel_group=candidate',
      }),
    ).toBe('5.0.0-rc.0');
  });

  it('finds openshift_version when it is not the first var', () => {
    expect(
      extractOcpVersion({
        EXTRA_FEATURE_VARS: 'channel_group=candidate openshift_version=5.0.0-rc.0',
      }),
    ).toBe('5.0.0-rc.0');
  });

  it('does not match a different var that ends in openshift_version', () => {
    expect(
      extractOcpVersion({ EXTRA_FEATURE_VARS: 'hub_openshift_version=4.22.9' }),
    ).toBeNull();
  });

  it('returns null when no version is present anywhere', () => {
    expect(extractOcpVersion({ EXTRA_FEATURE_VARS: 'channel_group=candidate' })).toBeNull();
    expect(extractOcpVersion({})).toBeNull();
  });
});

describe('hub_login_failure pattern', () => {
  // The shape of a capi_tests #352 failure, where a dead hub was mislabelled
  // as an upstream CAPA breakage because no pattern claimed it. The cluster
  // hostname is a placeholder -- this repo is public, and the assertion turns
  // on the login banner, not on which hub happened to be down.
  const message =
    'TASK [Check for authentication failure (401 Unauthorized)] ***** ' +
    'fatal: [localhost]: FAILED! => {"msg": "❌ OPENSHIFT LOGIN FAILED ❌\\n\\n' +
    'Failed to login to OpenShift Hub cluster.\\n\\n' +
    'Cluster: https://api.example-hub.invalid:6443\\n' +
    'Error Details:\\nerror: Internal Server Error"}';

  it('wins over the broader infra patterns that would otherwise claim it', () => {
    const matched = KNOWN_ISSUES.find((issue) => issue.pattern.test(message));
    expect(matched?.id).toBe('hub_login_failure');
  });

  it('classifies the run as infrastructure, not a CAPA regression', () => {
    const matched = KNOWN_ISSUES.find((issue) => issue.id === 'hub_login_failure');
    expect(matched?.defaultSeverity).toBe('infrastructure');
    expect(matched?.label).toBe('hub-unavailable');
  });
});

describe('composeDiagnosedTitle', () => {
  it('names the ticket after the cause, not the test that noticed it', () => {
    expect(
      composeDiagnosedTitle(
        { shortTitle: 'Hub login failed', severity: 'infrastructure' },
        'capi_tests',
      ),
    ).toBe('[Infra] Hub login failed: capi_tests');
  });

  it('omits the [Infra] prefix for non-infrastructure causes', () => {
    expect(
      composeDiagnosedTitle(
        { shortTitle: 'CAPI/CAPA controllers not running', severity: 'upstream_breakage' },
        'capi_tests',
      ),
    ).toBe('CAPI/CAPA controllers not running: capi_tests');
  });

  it('truncates to the shared title cap', () => {
    const title = composeDiagnosedTitle(
      { shortTitle: 'x'.repeat(300), severity: 'infrastructure' },
      'capi_tests',
    );
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });
});

describe('known-issue shortTitles', () => {
  it('gives every environment-level pattern a title to rename tickets with', () => {
    const missing = KNOWN_ISSUES.filter((issue) => !issue.shortTitle).map((i) => i.id);
    expect(missing).toEqual([]);
  });
});

describe('extractSalientError', () => {
  it('skips Ansible boilerplate and starts at the failure', () => {
    const message =
      "[WARNING]: No inventory was parsed, only implicit localhost is available " +
      'TASK [Gathering Facts] ***** ok: [localhost] ' +
      'TASK [Attempt OCP login] ***** ' +
      'fatal: [localhost]: FAILED! => {"msg": "OPENSHIFT LOGIN FAILED"}';
    const out = extractSalientError(message);
    expect(out.startsWith('fatal:')).toBe(true);
    expect(out).not.toContain('No inventory was parsed');
  });

  it('turns literal \\n escapes into real newlines', () => {
    expect(extractSalientError('fatal: one\\ntwo')).toBe('fatal: one\ntwo');
  });

  it('falls back to a leading slice when no anchor is found', () => {
    expect(extractSalientError('something went sideways')).toBe(
      'something went sideways',
    );
  });

  it('caps the output length', () => {
    expect(extractSalientError('fatal: ' + 'x'.repeat(5000)).length).toBeLessThanOrEqual(
      700,
    );
  });

  it('handles empty and missing input', () => {
    expect(extractSalientError('')).toBe('No error message');
    expect(extractSalientError(null)).toBe('No error message');
    expect(extractSalientError(undefined)).toBe('No error message');
  });
});
