/**
 * Unit tests for runIngestOnce (scheduler.ts) — the shared on-demand ingest
 * runner behind POST /api/refresh-ingest.
 *
 * Covers the hardening + selective-source work:
 *   - a never-resolving agent must be bounded by the overall wall-clock timeout
 *     (INGEST_RUN_TIMEOUT_MS) and MUST reset the running guard so a subsequent
 *     call is not 409-locked
 *   - selective sources: {jenkins:true, prow:false} runs only Jenkins, and
 *     vice-versa
 *   - a busy source that was NOT requested does not block the requested one
 *
 * The Jenkins and Prow agent modules are mocked so we control resolution timing.
 * db/connection is mocked to a no-op since runIngestOnce itself never touches it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks --------------------------------------------------------------------

// Controllable agent implementations, swapped per-test.
let jenkinsImpl: () => Promise<{ success: boolean; message: string }>;
let prowImpl: () => Promise<{ success: boolean; message: string }>;

vi.mock('../agents/ingest-jenkins.js', () => ({
  run: () => jenkinsImpl(),
}));
vi.mock('../agents/ingest-prow.js', () => ({
  run: () => prowImpl(),
}));
// resolution-tracker is imported by scheduler.ts but unused here.
vi.mock('../agents/resolution-tracker.js', () => ({ run: async () => ({ success: true, message: '' }) }));
// runIngestOnce never uses db, but the module imports it at load time.
vi.mock('../db/connection.js', () => ({ db: {} }));

// Short overall timeout so the "never resolves" tests finish fast under fake
// timers (must be set before importing the module under test).
process.env.INGEST_RUN_TIMEOUT_MS = '5000';

const { runIngestOnce } = await import('../scheduler.js');

// --- Helpers ------------------------------------------------------------------

const ok = (msg = 'ok') => async () => ({ success: true, message: msg });
const never = () => () => new Promise<{ success: boolean; message: string }>(() => {});

beforeEach(() => {
  jenkinsImpl = ok('jenkins ok');
  prowImpl = ok('prow ok');
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests --------------------------------------------------------------------

describe('runIngestOnce — selective sources', () => {
  it('runs only Jenkins when {jenkins:true, prow:false}', async () => {
    const jenkinsSpy = vi.fn(ok('jenkins ok'));
    const prowSpy = vi.fn(ok('prow ok'));
    jenkinsImpl = jenkinsSpy;
    prowImpl = prowSpy;

    const result = await runIngestOnce({ jenkins: true, prow: false });

    expect(jenkinsSpy).toHaveBeenCalledTimes(1);
    expect(prowSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.sources).toEqual({ jenkins: true, prow: false });
    expect(result.jenkins).toBeDefined();
    expect(result.prow).toBeUndefined();
  });

  it('runs only Prow when {prow:true, jenkins:false}', async () => {
    const jenkinsSpy = vi.fn(ok('jenkins ok'));
    const prowSpy = vi.fn(ok('prow ok'));
    jenkinsImpl = jenkinsSpy;
    prowImpl = prowSpy;

    const result = await runIngestOnce({ jenkins: false, prow: true });

    expect(prowSpy).toHaveBeenCalledTimes(1);
    expect(jenkinsSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.sources).toEqual({ jenkins: false, prow: true });
    expect(result.prow).toBeDefined();
    expect(result.jenkins).toBeUndefined();
  });

  it('runs both by default (no arg) — preserves cron/no-arg callers', async () => {
    const jenkinsSpy = vi.fn(ok('jenkins ok'));
    const prowSpy = vi.fn(ok('prow ok'));
    jenkinsImpl = jenkinsSpy;
    prowImpl = prowSpy;

    const result = await runIngestOnce();

    expect(jenkinsSpy).toHaveBeenCalledTimes(1);
    expect(prowSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.sources).toEqual({ jenkins: true, prow: true });
  });
});

describe('runIngestOnce — overall wall-clock timeout', () => {
  it('a never-resolving jenkins ingest returns ok:false within the timeout and resets the guard', async () => {
    vi.useFakeTimers();
    jenkinsImpl = never();

    const promise = runIngestOnce({ jenkins: true, prow: false });

    // Advance past INGEST_RUN_TIMEOUT_MS so the synthesized failure resolves.
    await vi.advanceTimersByTimeAsync(5001);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.jenkins?.success).toBe(false);
    expect(result.jenkins?.message).toMatch(/timed out/i);

    // Guard must be released: a subsequent healthy call must NOT be 409-locked.
    vi.useRealTimers();
    jenkinsImpl = ok('jenkins recovered');
    const second = await runIngestOnce({ jenkins: true, prow: false });
    expect(second.reason).not.toBe('running');
    expect(second.ok).toBe(true);
  });

  it('a never-resolving prow ingest also times out cleanly and releases the guard', async () => {
    vi.useFakeTimers();
    prowImpl = never();

    const promise = runIngestOnce({ jenkins: false, prow: true });
    await vi.advanceTimersByTimeAsync(5001);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.prow?.success).toBe(false);
    expect(result.prow?.message).toMatch(/timed out/i);

    vi.useRealTimers();
    prowImpl = ok('prow recovered');
    const second = await runIngestOnce({ jenkins: false, prow: true });
    expect(second.reason).not.toBe('running');
    expect(second.ok).toBe(true);
  });
});

describe('runIngestOnce — concurrency guard scoping', () => {
  it('a busy OTHER source does not block the requested source', async () => {
    // Start a long-running jenkins ingest (never resolves) and leave it pending.
    jenkinsImpl = never();
    const pending = runIngestOnce({ jenkins: true, prow: false });

    // While jenkins is "running", a prow-only request must still proceed.
    prowImpl = ok('prow ok');
    const prowResult = await runIngestOnce({ jenkins: false, prow: true });
    expect(prowResult.reason).not.toBe('running');
    expect(prowResult.ok).toBe(true);

    // But a jenkins request while jenkins is running must 409.
    const jenkinsBusy = await runIngestOnce({ jenkins: true, prow: false });
    expect(jenkinsBusy.reason).toBe('running');

    // Let the hung jenkins run time out so the test process doesn't hang.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(5001);
    await pending;
    vi.useRealTimers();
  });

  it('returns disabled when DISABLE_INGEST=true', async () => {
    process.env.DISABLE_INGEST = 'true';
    const result = await runIngestOnce();
    expect(result.reason).toBe('disabled');
    expect(result.ok).toBe(false);
    delete process.env.DISABLE_INGEST;
  });
});
