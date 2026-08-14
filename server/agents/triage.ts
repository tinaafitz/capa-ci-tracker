/**
 * triage -- Node.js agent
 *
 * Triggered by build_failure events. Computes error_signature,
 * deduplicates against open tickets, creates new tickets with
 * auto-severity classification, and invokes diagnosis.
 * Ported from supabase/functions/triage/index.ts.
 */

import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { dbEvents } from '../triggers.js';
import { run as runDiagnosis } from './diagnosis.js';

const AGENT_NAME = 'triage';

export interface AgentResult {
  success: boolean;
  message: string;
  action?: 'linked' | 'created' | 'skipped';
  ticketId?: string;
  ticketNumber?: number;
  errorSignature?: string;
  deduplicated?: boolean;
}

interface TestFailure {
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}

interface Build {
  id: string;
  source: string;
  external_id: string;
  job_name: string;
  job_url: string | null;
  status: string;
  pass_count: number;
  fail_count: number;
  skip_count: number;
  total_count: number;
  ocp_version: string | null;
  test_failures: string; // JSON string in SQLite
  started_at: string | null;
}

// ============================================================
// Error Signature Computation
// ============================================================

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function computeSignature(testFailures: TestFailure[]): string {
  if (!testFailures || testFailures.length === 0) return 'unknown';
  const f = testFailures[0];
  if (!f.errorMessage)
    return `${f.className || 'unknown'}::${f.name || 'unknown'}::no-error-message`;

  // Normalize: strip UUIDs, hex addresses, timestamps, line numbers
  const normalized = f.errorMessage
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<UUID>',
    )
    .replace(/0x[0-9a-fA-F]+/g, '<ADDR>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TS>')
    .replace(/:\d+/g, ':<N>')
    .trim();

  const hash = sha256Hex(normalized);
  return `${f.className || 'unknown'}::${f.name || 'unknown'}::${hash.substring(0, 16)}`;
}

// ============================================================
// Auto-Severity Classification
// ============================================================

function classifySeverity(
  build: Build,
  testFailures: TestFailure[],
): string {
  const jobName = build.job_name.toLowerCase();

  // nightly_blocker: nightly job OR all tests failed
  if (
    jobName.includes('nightly') ||
    (build.total_count > 0 && build.fail_count === build.total_count)
  ) {
    return 'nightly_blocker';
  }

  // upstream_breakage: CAPI/OCP version patterns in error messages
  const errorText = testFailures
    .map((f) => f.errorMessage)
    .join(' ')
    .toLowerCase();
  if (
    /capi.*v1beta[12]|apigroup.*migration|cluster\.x-k8s\.io.*v1beta/.test(
      errorText,
    ) ||
    /ocp.*\d+\.\d+.*incompatible|openshift.*version.*mismatch/.test(errorText)
  ) {
    return 'upstream_breakage';
  }

  // infrastructure: timeout/VPC/IAM patterns
  if (
    /timeout|timed?\s*out|vpc.*not found|subnet.*invalid|access.denied|iam.*error|quota.*exceed/i.test(
      errorText,
    )
  ) {
    return 'infrastructure';
  }

  // flaky: check if the same test alternates pass/fail in recent builds
  if (
    build.pass_count > 0 &&
    build.fail_count > 0 &&
    build.fail_count <= 2
  ) {
    return 'flaky';
  }

  // Default: test_regression
  return 'test_regression';
}

// ============================================================
// Default Tasks for New Tickets
// ============================================================

const DEFAULT_TASKS = [
  { title: 'Investigate logs', sort_order: 1 },
  { title: 'Identify root cause', sort_order: 2 },
  { title: 'Submit fix PR', sort_order: 3 },
  { title: 'Verify in next nightly', sort_order: 4 },
];

// ============================================================
// Prepared statements
// ============================================================

const getBuildStmt = db.prepare('SELECT * FROM builds WHERE id = ?');

const dedupCheckStmt = db.prepare(`
  SELECT id, ticket_number FROM support_tickets
  WHERE error_signature = ? AND status NOT IN ('resolved', 'verified')
  LIMIT 1
`);

const insertTicketStmt = db.prepare(`
  INSERT INTO support_tickets (id, title, description, status, severity,
    build_id, error_signature, labels, created_at, updated_at)
  VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
`);

const getTicketStmt = db.prepare(`
  SELECT id, ticket_number FROM support_tickets WHERE id = ?
`);

const insertTaskStmt = db.prepare(`
  INSERT INTO tasks (id, ticket_id, title, status, sort_order, created_at)
  VALUES (?, ?, ?, 'open', ?, ?)
`);

const insertActivityStmt = db.prepare(`
  INSERT INTO activities (id, activity_type, title, description, ticket_id, build_id, actor, metadata, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ============================================================
// Main Triage Logic
// ============================================================

async function triageBuild(buildId: string): Promise<{
  action: 'linked' | 'created' | 'skipped';
  ticketId?: string;
  ticketNumber?: number;
  errorSignature?: string;
}> {
  // 1. Fetch the build
  const build = getBuildStmt.get(buildId) as Build | undefined;

  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }

  if (build.status !== 'failure') {
    return { action: 'skipped' };
  }

  const testFailures: TestFailure[] = JSON.parse(build.test_failures || '[]');
  const errorSignature = computeSignature(testFailures);

  // 2. Dedup check -- SQLite is single-writer, no advisory lock needed
  const existing = dedupCheckStmt.get(errorSignature) as
    | { id: string; ticket_number: number }
    | undefined;

  if (existing) {
    // Link build to existing ticket via activity
    const now = new Date().toISOString();
    const dedupActivityId = uuidv4();
    insertActivityStmt.run(
      dedupActivityId,
      'build_completed',
      `Recurring failure linked to ticket #${existing.ticket_number}`,
      `Build ${build.job_name} #${build.external_id} failed with same error signature. Linked to existing ticket.`,
      existing.id,
      build.id,
      'triage-agent',
      JSON.stringify({
        dedup: true,
        error_signature: errorSignature,
      }),
      now,
    );
    dbEvents.emit('new_activity', { activity_id: dedupActivityId, activity_type: 'build_completed' });

    return {
      action: 'linked',
      ticketId: existing.id,
      ticketNumber: existing.ticket_number,
      errorSignature,
    };
  }

  // 3. No existing ticket -- create a new one (wrapped in transaction)
  const severity = classifySeverity(build, testFailures);
  const firstFailure = testFailures[0];
  const title = firstFailure
    ? `${firstFailure.className || build.job_name}: ${firstFailure.name || 'test failure'}`
    : `${build.job_name} build #${build.external_id} failed`;
  const description = firstFailure
    ? `**Error:** ${firstFailure.errorMessage?.substring(0, 500) || 'No error message'}\n\n**Job:** ${build.job_name}\n**Build:** #${build.external_id}\n**OCP Version:** ${build.ocp_version || 'unknown'}\n**Failed Tests:** ${build.fail_count}/${build.total_count}`
    : `Build ${build.job_name} #${build.external_id} failed. ${build.fail_count} test failures out of ${build.total_count} total.`;

  const newTicketId = uuidv4();
  const now = new Date().toISOString();
  const labels = JSON.stringify(
    [
      build.source,
      build.ocp_version ? `ocp-${build.ocp_version}` : null,
    ].filter(Boolean),
  );

  let ticketNumber = 0;
  const ticketCreatedActivityId = uuidv4();

  db.exec('BEGIN');
  try {
    insertTicketStmt.run(
      newTicketId,
      title,
      description,
      severity,
      build.id,
      errorSignature,
      labels,
      now,
      now,
    );

    // Re-fetch to get the auto-assigned ticket_number
    const newTicket = getTicketStmt.get(newTicketId) as
      | { id: string; ticket_number: number }
      | undefined;

    ticketNumber = newTicket?.ticket_number ?? 0;

    // 4. Create default tasks
    for (const task of DEFAULT_TASKS) {
      insertTaskStmt.run(uuidv4(), newTicketId, task.title, task.sort_order, now);
    }

    // 5. Insert ticket_created activity
    insertActivityStmt.run(
      ticketCreatedActivityId,
      'ticket_created',
      `Ticket #${ticketNumber} created: ${title}`,
      `Auto-created by triage agent. Severity: ${severity}. Error signature: ${errorSignature}`,
      newTicketId,
      build.id,
      'triage-agent',
      JSON.stringify({
        severity,
        error_signature: errorSignature,
        auto_created: true,
      }),
      now,
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Emit after successful commit (outside transaction)
  dbEvents.emit('new_activity', { activity_id: ticketCreatedActivityId, activity_type: 'ticket_created' });

  // 6. Invoke diagnosis agent -- direct function call instead of HTTP
  try {
    await runDiagnosis({ ticket_id: newTicketId, build_id: build.id });
  } catch (err) {
    // Log but do not fail the triage -- diagnosis is best-effort
    console.error(`[triage] Failed to invoke diagnosis: ${(err as Error).message}`);
  }

  return {
    action: 'created',
    ticketId: newTicketId,
    ticketNumber,
    errorSignature,
  };
}

// ============================================================
// Exported run function
// ============================================================

export async function run(params: { build_id: string }): Promise<AgentResult> {
  const { build_id } = params;

  if (!build_id) {
    return { success: false, message: 'build_id is required' };
  }

  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'event', ?, 0, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ build_id }), startedAt);

  try {
    const result = await triageBuild(build_id);

    const message =
      result.action === 'created'
        ? `Ticket #${result.ticketNumber} created for build ${build_id}`
        : result.action === 'linked'
          ? `Build ${build_id} linked to existing ticket #${result.ticketNumber}`
          : `Build ${build_id} skipped (not a failure)`;

    db.prepare(`
      UPDATE agent_runs SET success = 1, output_payload = ?, duration_ms = ? WHERE id = ?
    `).run(JSON.stringify(result), Date.now() - startTime, runId);

    return { success: true, message, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE agent_runs SET success = 0, error_message = ?, duration_ms = ? WHERE id = ?
    `).run(message, Date.now() - startTime, runId);
    return { success: false, message };
  }
}
