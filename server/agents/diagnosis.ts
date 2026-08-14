/**
 * diagnosis -- Node.js agent
 *
 * Called by the triage agent after ticket creation.
 * Matches test_failures against 12 known-issue regex patterns.
 * Updates ticket with root_cause, root_cause_category, and potentially adjusted severity.
 * Ported from supabase/functions/diagnosis/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { KNOWN_ISSUES } from './known-issues.js';

const AGENT_NAME = 'diagnosis';

export interface AgentResult {
  success: boolean;
  message: string;
  ticket_id?: string;
  build_id?: string;
  diagnosis?: {
    root_cause: string;
    root_cause_category: string;
    severity: string;
    matched_pattern: string;
  } | { matched: boolean };
  patterns_checked?: number;
  failures_checked?: number;
}

interface TestFailure {
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}

interface DiagnosisResult {
  root_cause: string;
  root_cause_category: string;
  severity: string;
  matched_pattern: string;
}

// ============================================================
// Prepared statements
// ============================================================

const getBuildStmt = db.prepare(
  'SELECT id, job_name, test_failures, parameters, ocp_version FROM builds WHERE id = ?',
);

const getTicketSeverityStmt = db.prepare(
  'SELECT severity FROM support_tickets WHERE id = ?',
);

const updateTicketStmt = db.prepare(`
  UPDATE support_tickets
  SET root_cause = ?, root_cause_category = ?, matched_pattern = ?,
      diagnosed_at = ?, updated_at = ?
  WHERE id = ?
`);

const updateTicketWithSeverityStmt = db.prepare(`
  UPDATE support_tickets
  SET root_cause = ?, root_cause_category = ?, matched_pattern = ?,
      severity = ?, diagnosed_at = ?, updated_at = ?
  WHERE id = ?
`);

const insertActivityStmt = db.prepare(`
  INSERT INTO activities (id, activity_type, title, description, ticket_id, build_id, actor, metadata, created_at)
  VALUES (?, 'diagnosis_completed', ?, ?, ?, ?, 'diagnosis-agent', ?, ?)
`);

// ============================================================
// Pattern matching logic
// ============================================================

function diagnoseFailures(testFailures: TestFailure[]): DiagnosisResult | null {
  for (const failure of testFailures) {
    const errorText = failure.errorMessage || '';
    for (const issue of KNOWN_ISSUES) {
      if (issue.pattern.test(errorText)) {
        return {
          root_cause: issue.rootCause,
          root_cause_category: issue.category,
          severity: issue.defaultSeverity,
          matched_pattern: issue.id,
        };
      }
    }

    // Also check the stack trace
    const stackText = failure.errorStackTrace || '';
    if (stackText) {
      for (const issue of KNOWN_ISSUES) {
        if (issue.pattern.test(stackText)) {
          return {
            root_cause: issue.rootCause,
            root_cause_category: issue.category,
            severity: issue.defaultSeverity,
            matched_pattern: issue.id,
          };
        }
      }
    }
  }

  return null;
}

// ============================================================
// Exported run function
// ============================================================

export async function run(params: {
  ticket_id: string;
  build_id: string;
}): Promise<AgentResult> {
  const { ticket_id, build_id } = params;

  if (!ticket_id || !build_id) {
    return { success: false, message: 'ticket_id and build_id are required' };
  }

  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'triage-agent', ?, 1, ?)
  `).run(
    runId,
    AGENT_NAME,
    JSON.stringify({ ticket_id, build_id }),
    startedAt,
  );

  try {
    // Fetch the build with test_failures
    const build = getBuildStmt.get(build_id) as
      | { id: string; job_name: string; test_failures: string; parameters: string; ocp_version: string | null }
      | undefined;

    if (!build) {
      throw new Error(`Build not found: ${build_id}`);
    }

    const testFailures: TestFailure[] = JSON.parse(build.test_failures || '[]');
    const diagnosisResult = diagnoseFailures(testFailures);

    const now = new Date().toISOString();

    if (diagnosisResult) {
      // Check current ticket severity to decide if we should adjust
      const currentTicket = getTicketSeverityStmt.get(ticket_id) as
        | { severity: string }
        | undefined;

      if (
        currentTicket &&
        currentTicket.severity === 'test_regression' &&
        diagnosisResult.severity !== 'test_regression'
      ) {
        // Update ticket with adjusted severity
        updateTicketWithSeverityStmt.run(
          diagnosisResult.root_cause,
          diagnosisResult.root_cause_category,
          diagnosisResult.matched_pattern,
          diagnosisResult.severity,
          now,
          now,
          ticket_id,
        );
      } else {
        // Update ticket without changing severity
        updateTicketStmt.run(
          diagnosisResult.root_cause,
          diagnosisResult.root_cause_category,
          diagnosisResult.matched_pattern,
          now,
          now,
          ticket_id,
        );
      }

      // Insert diagnosis_completed activity
      insertActivityStmt.run(
        uuidv4(),
        `Diagnosis completed: ${diagnosisResult.matched_pattern}`,
        `Root cause identified: ${diagnosisResult.root_cause}. Category: ${diagnosisResult.root_cause_category}.`,
        ticket_id,
        build_id,
        JSON.stringify({
          matched_pattern: diagnosisResult.matched_pattern,
          root_cause: diagnosisResult.root_cause,
          root_cause_category: diagnosisResult.root_cause_category,
          severity_adjusted:
            currentTicket?.severity !== diagnosisResult.severity,
          patterns_checked: KNOWN_ISSUES.length,
        }),
        now,
      );
    } else {
      // No known pattern matched -- still record the attempt
      insertActivityStmt.run(
        uuidv4(),
        'Diagnosis completed: no known pattern matched',
        `Checked ${KNOWN_ISSUES.length} known issue patterns against ${testFailures.length} test failure(s). No match found -- manual investigation required.`,
        ticket_id,
        build_id,
        JSON.stringify({
          matched_pattern: null,
          patterns_checked: KNOWN_ISSUES.length,
          failures_checked: testFailures.length,
        }),
        now,
      );
    }

    const outputPayload = {
      ticket_id,
      build_id,
      diagnosis: diagnosisResult || { matched: false },
      patterns_checked: KNOWN_ISSUES.length,
      failures_checked: testFailures.length,
    };

    const message = diagnosisResult
      ? `Matched pattern: ${diagnosisResult.matched_pattern}`
      : `No pattern matched (${KNOWN_ISSUES.length} checked)`;

    db.prepare(`
      UPDATE agent_runs SET success = 1, output_payload = ?, duration_ms = ? WHERE id = ?
    `).run(JSON.stringify(outputPayload), Date.now() - startTime, runId);

    return { success: true, message, ...outputPayload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE agent_runs SET success = 0, error_message = ?, duration_ms = ? WHERE id = ?
    `).run(message, Date.now() - startTime, runId);
    return { success: false, message };
  }
}
