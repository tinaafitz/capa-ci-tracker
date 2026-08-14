/**
 * Integration tests for the triage agent's dedup logic.
 *
 * Uses an in-memory SQLite database to verify:
 * - Same error signature -> no duplicate ticket created (links to existing)
 * - Different error signature -> new ticket created
 * - Resolved ticket with same signature -> new ticket created (not deduped)
 * - Auto-severity classification
 * - Default task creation
 * - Activity insertion
 *
 * The triage module imports `db` from `../db/connection.js` and creates
 * prepared statements at module scope. We must initialize our test DB
 * before the triage module is imported, then swap it between tests.
 *
 * The diagnosis module is mocked to prevent side effects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';

// ---------------------------------------------------------------------------
// Module mocking
// ---------------------------------------------------------------------------

// Initialize testDb BEFORE import so module-level prepared statements work.
// We'll replace it with a fresh DB in beforeEach and re-import the module.
let testDb: ReturnType<typeof createTestDb> = createTestDb();

vi.mock('../db/connection.js', () => {
  return {
    get db() {
      return testDb;
    },
  };
});

// Mock the diagnosis agent so triage doesn't try to run it
vi.mock('../agents/diagnosis.js', () => {
  return {
    run: vi.fn().mockResolvedValue({ success: true, message: 'mocked' }),
  };
});

// Import the triage module after mocks -- this will create prepared statements
// against the initial testDb. But since triage.ts uses module-level db.prepare(),
// those prepared statements are bound to the initial testDb instance.
// We need a different approach: we'll keep using the SAME db instance
// but clear its data between tests.
const { run: runTriage } = await import('../agents/triage.js');

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const TEST_FAILURE = [
  {
    name: 'TestClusterLifecycle',
    className: 'e2e.cluster',
    errorMessage: 'resource not found: cluster abc-123 does not exist',
    errorStackTrace: 'at TestClusterLifecycle (cluster_test.go:45)',
  },
];

const DIFFERENT_FAILURE = [
  {
    name: 'TestNetworkPolicy',
    className: 'e2e.network',
    errorMessage: 'network policy xyz-789 was not applied within timeout',
    errorStackTrace: 'at TestNetworkPolicy (network_test.go:123)',
  },
];

function insertBuild(
  id: string,
  testFailures: unknown[] = TEST_FAILURE,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const defaults = {
    source: 'prow',
    external_id: id,
    job_name: 'e2e-rosa-hcp',
    status: 'failure',
    pass_count: 8,
    fail_count: 2,
    skip_count: 0,
    total_count: 10,
    test_failures: JSON.stringify(testFailures),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const data = { ...defaults, ...overrides };
  testDb.prepare(`
    INSERT INTO builds (id, source, external_id, job_name, status, pass_count, fail_count, skip_count, total_count, test_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.source, data.external_id, data.job_name, data.status,
    data.pass_count, data.fail_count, data.skip_count, data.total_count,
    data.test_failures, data.created_at, data.updated_at,
  );
}

function clearAllTables() {
  // Delete in dependency order (children first)
  testDb.exec('DELETE FROM streak_builds');
  testDb.exec('DELETE FROM tasks');
  testDb.exec('DELETE FROM activities');
  testDb.exec('DELETE FROM agent_runs');
  testDb.exec('DELETE FROM support_tickets');
  testDb.exec('DELETE FROM build_logs');
  testDb.exec('DELETE FROM builds');
  testDb.exec('DELETE FROM failure_streaks');
  testDb.exec('DELETE FROM sop_mappings');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triage agent dedup', () => {
  beforeEach(() => {
    // Clear all data but keep the same db instance (prepared statements are bound to it)
    clearAllTables();
  });

  it('creates a new ticket for a failing build', async () => {
    insertBuild('build-1');

    const result = await runTriage({ build_id: 'build-1' });

    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(result.ticketId).toBeDefined();
    expect(result.ticketNumber).toBeDefined();
    expect(result.errorSignature).toBeDefined();

    // Verify ticket exists in DB
    const tickets = testDb.prepare('SELECT * FROM support_tickets').all() as Record<string, unknown>[];
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe('new');
  });

  it('links to existing open ticket when same error signature appears again', async () => {
    insertBuild('build-1');
    insertBuild('build-2', TEST_FAILURE, { external_id: 'build-2' });

    // First build creates a ticket
    const first = await runTriage({ build_id: 'build-1' });
    expect(first.action).toBe('created');

    // Second build with same error signature should link, not create
    const second = await runTriage({ build_id: 'build-2' });
    expect(second.action).toBe('linked');
    expect(second.ticketId).toBe(first.ticketId);

    // Only one ticket should exist
    const tickets = testDb.prepare('SELECT * FROM support_tickets').all() as Record<string, unknown>[];
    expect(tickets).toHaveLength(1);

    // But there should be activities linking the second build
    const linkActivities = testDb.prepare(
      "SELECT * FROM activities WHERE activity_type = 'build_completed' AND build_id = 'build-2'"
    ).all() as Record<string, unknown>[];
    expect(linkActivities).toHaveLength(1);
  });

  it('creates a new ticket when error signature is different', async () => {
    insertBuild('build-1', TEST_FAILURE);
    insertBuild('build-2', DIFFERENT_FAILURE, { external_id: 'build-2' });

    const first = await runTriage({ build_id: 'build-1' });
    expect(first.action).toBe('created');

    const second = await runTriage({ build_id: 'build-2' });
    expect(second.action).toBe('created');
    expect(second.ticketId).not.toBe(first.ticketId);

    // Two separate tickets should exist
    const tickets = testDb.prepare('SELECT * FROM support_tickets').all() as Record<string, unknown>[];
    expect(tickets).toHaveLength(2);
  });

  it('creates a new ticket when matching ticket is resolved (new occurrence)', async () => {
    insertBuild('build-1');
    insertBuild('build-2', TEST_FAILURE, { external_id: 'build-2' });

    // First build creates a ticket
    const first = await runTriage({ build_id: 'build-1' });
    expect(first.action).toBe('created');

    // Manually resolve the ticket
    testDb.prepare("UPDATE support_tickets SET status = 'resolved' WHERE id = ?").run(first.ticketId);

    // Second build with same signature should create a new ticket
    const second = await runTriage({ build_id: 'build-2' });
    expect(second.action).toBe('created');
    expect(second.ticketId).not.toBe(first.ticketId);

    // Two tickets should exist
    const tickets = testDb.prepare('SELECT * FROM support_tickets').all() as Record<string, unknown>[];
    expect(tickets).toHaveLength(2);
  });

  it('creates a new ticket when matching ticket is verified', async () => {
    insertBuild('build-1');
    insertBuild('build-2', TEST_FAILURE, { external_id: 'build-2' });

    const first = await runTriage({ build_id: 'build-1' });
    testDb.prepare("UPDATE support_tickets SET status = 'verified' WHERE id = ?").run(first.ticketId);

    const second = await runTriage({ build_id: 'build-2' });
    expect(second.action).toBe('created');
    expect(second.ticketId).not.toBe(first.ticketId);
  });

  it('skips non-failure builds', async () => {
    insertBuild('build-success', TEST_FAILURE, { status: 'success' });

    const result = await runTriage({ build_id: 'build-success' });

    expect(result.success).toBe(true);
    expect(result.action).toBe('skipped');

    const tickets = testDb.prepare('SELECT * FROM support_tickets').all();
    expect(tickets).toHaveLength(0);
  });

  it('returns error when build does not exist', async () => {
    const result = await runTriage({ build_id: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Build not found');
  });

  it('returns error when build_id is empty', async () => {
    const result = await runTriage({ build_id: '' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('build_id is required');
  });

  // =================================================================
  // Default tasks creation
  // =================================================================

  describe('default tasks', () => {
    it('creates 4 default tasks for a new ticket', async () => {
      insertBuild('build-tasks');
      const result = await runTriage({ build_id: 'build-tasks' });

      const tasks = testDb.prepare(
        'SELECT * FROM tasks WHERE ticket_id = ? ORDER BY sort_order'
      ).all(result.ticketId!) as Record<string, unknown>[];

      expect(tasks).toHaveLength(4);
      expect(tasks[0].title).toBe('Investigate logs');
      expect(tasks[1].title).toBe('Identify root cause');
      expect(tasks[2].title).toBe('Submit fix PR');
      expect(tasks[3].title).toBe('Verify in next nightly');
      expect(tasks.every(t => t.status === 'open')).toBe(true);
    });
  });

  // =================================================================
  // Activity creation
  // =================================================================

  describe('activity creation', () => {
    it('inserts a ticket_created activity for new tickets', async () => {
      insertBuild('build-act');
      const result = await runTriage({ build_id: 'build-act' });

      const activities = testDb.prepare(
        "SELECT * FROM activities WHERE ticket_id = ? AND activity_type = 'ticket_created'"
      ).all(result.ticketId!) as Record<string, unknown>[];

      expect(activities).toHaveLength(1);
      expect(activities[0].actor).toBe('triage-agent');
      expect(activities[0].build_id).toBe('build-act');
    });

    it('inserts a build_completed activity for deduplicated builds', async () => {
      insertBuild('build-d1');
      insertBuild('build-d2', TEST_FAILURE, { external_id: 'build-d2' });

      await runTriage({ build_id: 'build-d1' });
      await runTriage({ build_id: 'build-d2' });

      const activities = testDb.prepare(
        "SELECT * FROM activities WHERE build_id = 'build-d2' AND activity_type = 'build_completed'"
      ).all() as Record<string, unknown>[];

      expect(activities).toHaveLength(1);
      expect(activities[0].actor).toBe('triage-agent');
      const metadata = JSON.parse(activities[0].metadata as string);
      expect(metadata.dedup).toBe(true);
    });
  });

  // =================================================================
  // Agent run logging
  // =================================================================

  describe('agent_runs logging', () => {
    it('logs agent_run on success', async () => {
      insertBuild('build-log');
      await runTriage({ build_id: 'build-log' });

      const runs = testDb.prepare(
        "SELECT * FROM agent_runs WHERE agent_name = 'triage'"
      ).all() as Record<string, unknown>[];

      expect(runs).toHaveLength(1);
      expect(runs[0].success).toBe(1);
      expect(runs[0].duration_ms).toBeDefined();
      expect(runs[0].output_payload).toBeDefined();
    });

    it('logs agent_run with error on failure', async () => {
      // build doesn't exist -> will error
      await runTriage({ build_id: 'nonexistent' });

      const runs = testDb.prepare(
        "SELECT * FROM agent_runs WHERE agent_name = 'triage'"
      ).all() as Record<string, unknown>[];

      expect(runs).toHaveLength(1);
      expect(runs[0].success).toBe(0);
      expect(runs[0].error_message).toContain('Build not found');
    });
  });

  // =================================================================
  // Auto-severity classification
  // =================================================================

  describe('auto-severity classification', () => {
    it('classifies as nightly_blocker when job_name contains "nightly"', async () => {
      insertBuild('build-nightly', TEST_FAILURE, { job_name: 'e2e-nightly-rosa-hcp' });
      const result = await runTriage({ build_id: 'build-nightly' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('nightly_blocker');
    });

    it('classifies as nightly_blocker when all tests failed', async () => {
      insertBuild('build-allfail', TEST_FAILURE, {
        job_name: 'regular-e2e',
        fail_count: 10,
        total_count: 10,
        pass_count: 0,
      });
      const result = await runTriage({ build_id: 'build-allfail' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('nightly_blocker');
    });

    it('classifies as infrastructure for timeout errors', async () => {
      const timeoutFailure = [{
        name: 'TestClusterCreate',
        className: 'e2e.cluster',
        errorMessage: 'operation timed out waiting for cluster to be ready',
        errorStackTrace: '',
      }];
      insertBuild('build-timeout', timeoutFailure, { job_name: 'regular-e2e' });
      const result = await runTriage({ build_id: 'build-timeout' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('infrastructure');
    });

    it('classifies as upstream_breakage for CAPI version errors', async () => {
      const capiFailure = [{
        name: 'TestCAPIVersion',
        className: 'e2e.capi',
        errorMessage: 'admission webhook denied: capi v1beta2 apiGroup migration required',
        errorStackTrace: '',
      }];
      insertBuild('build-capi', capiFailure, { job_name: 'regular-e2e', pass_count: 5, fail_count: 3, total_count: 8 });
      const result = await runTriage({ build_id: 'build-capi' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('upstream_breakage');
    });

    it('classifies as flaky when few failures with some passes', async () => {
      const flakyFailure = [{
        name: 'TestFlakyCheck',
        className: 'e2e.misc',
        errorMessage: 'assertion failed: expected 3 replicas got 2',
        errorStackTrace: '',
      }];
      insertBuild('build-flaky', flakyFailure, {
        job_name: 'regular-e2e',
        pass_count: 9,
        fail_count: 1,
        total_count: 10,
      });
      const result = await runTriage({ build_id: 'build-flaky' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('flaky');
    });

    it('defaults to test_regression for unclassified failures', async () => {
      const genericFailure = [{
        name: 'TestGeneric',
        className: 'e2e.generic',
        errorMessage: 'expected true got false',
        errorStackTrace: '',
      }];
      insertBuild('build-generic', genericFailure, {
        job_name: 'regular-e2e',
        pass_count: 5,
        fail_count: 5,
        total_count: 10,
      });
      const result = await runTriage({ build_id: 'build-generic' });

      const ticket = testDb.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.ticketId!) as Record<string, unknown>;
      expect(ticket.severity).toBe('test_regression');
    });
  });

  // =================================================================
  // Error signature computation
  // =================================================================

  describe('error signature', () => {
    it('normalizes UUIDs out of error messages', async () => {
      const failureWithUuid = [{
        name: 'TestCluster',
        className: 'e2e.cluster',
        errorMessage: 'resource 550e8400-e29b-41d4-a716-446655440000 not found',
        errorStackTrace: '',
      }];
      const failureWithDiffUuid = [{
        name: 'TestCluster',
        className: 'e2e.cluster',
        errorMessage: 'resource a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found',
        errorStackTrace: '',
      }];

      insertBuild('build-uuid1', failureWithUuid, { external_id: 'uuid1' });
      insertBuild('build-uuid2', failureWithDiffUuid, { external_id: 'uuid2' });

      const result1 = await runTriage({ build_id: 'build-uuid1' });
      const result2 = await runTriage({ build_id: 'build-uuid2' });

      // Same error after UUID normalization -> should dedup (linked, not created)
      expect(result1.errorSignature).toBe(result2.errorSignature);
      expect(result2.action).toBe('linked');
    });

    it('returns "unknown" for builds with no test failures', async () => {
      insertBuild('build-empty', [], { external_id: 'empty' });
      const result = await runTriage({ build_id: 'build-empty' });

      expect(result.errorSignature).toBe('unknown');
    });

    it('handles missing errorMessage gracefully', async () => {
      const noMsg = [{
        name: 'TestSomething',
        className: 'e2e.test',
        errorMessage: '',
        errorStackTrace: '',
      }];
      insertBuild('build-nomsg', noMsg, { external_id: 'nomsg' });
      const result = await runTriage({ build_id: 'build-nomsg' });

      expect(result.errorSignature).toBe('e2e.test::TestSomething::no-error-message');
    });
  });
});
