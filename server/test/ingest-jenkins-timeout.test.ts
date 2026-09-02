/**
 * Unit test for the per-job wall-clock guard in ingest-jenkins.ts.
 *
 * A job whose network fetch never resolves must NOT hang the run: the
 * Promise.race guard rejects after JENKINS_JOB_TIMEOUT_MS, the job is recorded
 * as errored, overallSuccess flips to false, and run() resolves. We use fake
 * timers so the test completes instantly and a tiny job timeout.
 *
 * global fetch is stubbed to a never-resolving promise so ingestJob's first
 * fetch (the builds list) stalls forever, standing in for a wedged TLS read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Tiny per-job timeout so the race trips quickly under fake timers (must be set
// before importing the module under test).
process.env.JENKINS_JOB_TIMEOUT_MS = '1000';
process.env.JENKINS_JOBS = 'capi_tests';
process.env.JENKINS_BASE_URL = 'https://jenkins.example';
process.env.JENKINS_USER = 'u';
process.env.JENKINS_API_TOKEN = 't';

// Stub the db so run()'s agent_runs bookkeeping is a no-op.
const stubStmt = { run: () => ({ changes: 0 }), get: () => undefined };
vi.mock('../db/connection.js', () => ({ db: { prepare: () => stubStmt } }));
vi.mock('../triggers.js', () => ({ afterBuildInsert: () => {} }));
vi.mock('../agents/classify-failure.js', () => ({
  classifyFailure: () => ({ failure_class: null, failure_reason: null, is_infra: 0 }),
}));

const { run } = await import('../agents/ingest-jenkins.js');

beforeEach(() => {
  // First (and only) network call never resolves — simulates a wedged read.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ingest-jenkins per-job timeout guard', () => {
  it('a never-resolving job does not hang the run; it times out and is recorded', async () => {
    vi.useFakeTimers();

    const promise = run();

    // Advance past JENKINS_JOB_TIMEOUT_MS so the race rejects.
    await vi.advanceTimersByTimeAsync(1001);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.results?.capi_tests).toBeDefined();
    expect(result.results?.capi_tests.errors.join(' ')).toMatch(/timed out/i);
  });
});
