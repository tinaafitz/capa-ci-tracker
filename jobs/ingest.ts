// ingest.ts -- CronJob entry point for CI build ingestion.
// Combines ingest-jenkins, ingest-prow, triage, diagnosis, and notify
// into a single pipeline that runs inline (no inter-service HTTP calls).
//
// Usage:
//   node --import tsx jobs/ingest.ts --source=jenkins
//   node --import tsx jobs/ingest.ts --source=prow

import { createHash } from 'node:crypto';
import { pool, query, log, recordAgentRun } from './db.js';

// ============================================================
// Environment
// ============================================================

const JENKINS_BASE_URL = process.env.JENKINS_BASE_URL ?? '';
const JENKINS_USER = process.env.JENKINS_USER ?? '';
const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN ?? '';
const JENKINS_JOBS = (process.env.JENKINS_JOBS ?? 'capi_tests,capi_nightly,rosa_hcp_e2e,capa_e2e_nightly,capa_upgrade_tests').split(',').map(s => s.trim()).filter(Boolean);

const PROW_API_URL = process.env.PROW_API_URL ?? 'https://prow.ci.openshift.org/prowjobs.js?type=periodic&job=*openshift-online-rosa-e2e*';
const PROW_JOB_PATTERNS = [
  /periodic-ci-openshift-online-rosa-e2e-/,
];

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL ?? '#capa-ci-alerts';

// ============================================================
// Types
// ============================================================

interface TestFailure {
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}

interface JenkinsBuild {
  number: number;
  result: string | null;
  timestamp: number;
  duration: number;
  url: string;
  actions: Array<{
    _class?: string;
    parameters?: Array<{ name: string; value: string }>;
  }>;
}

interface JenkinsTestReport {
  passCount: number;
  failCount: number;
  skipCount: number;
  suites: Array<{
    cases: Array<{
      name: string;
      className: string;
      status: string;
      errorDetails: string | null;
      errorStackTrace: string | null;
    }>;
  }>;
}

interface ProwJob {
  spec: {
    job: string;
    type: string;
    cluster?: string;
    refs?: { org: string; repo: string; base_ref: string };
    extra_refs?: Array<{ org: string; repo: string; base_ref: string }>;
  };
  status: {
    state: string;
    startTime?: string;
    completionTime?: string;
    url?: string;
    build_id?: string;
    description?: string;
  };
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

interface TriageResult {
  action: 'linked' | 'created' | 'skipped';
  ticketId?: string;
  ticketNumber?: number;
  errorSignature?: string;
}

interface DiagnosisResult {
  root_cause: string;
  root_cause_category: string;
  severity: string;
  matched_pattern: string;
}

// ============================================================
// Known Issue Patterns (12 patterns from diagnosis Edge Function)
// ============================================================

interface KnownIssue {
  type: string;
  pattern: string;
  description: string;
  category: string;
  default_severity: string;
}

const KNOWN_ISSUES: KnownIssue[] = [
  {
    type: 'cloudformation_deletion_failure',
    pattern: 'CloudFormation stack DELETE_FAILED:.*|FAILED - RETRYING.*cloudformation.*deletion',
    description: 'AWS CloudFormation stack deletion failure -- ROSA creates security groups outside CF that block VPC deletion',
    category: 'aws_infrastructure',
    default_severity: 'infrastructure',
  },
  {
    type: 'ocm_auth_failure',
    pattern: '.*(ocm|openshift cluster manager).*(401|403|unauthorized|forbidden).*',
    description: 'OpenShift Cluster Manager authentication failure',
    category: 'auth_credentials',
    default_severity: 'infrastructure',
  },
  {
    type: 'capi_not_installed',
    pattern: '.*(capi|cluster.*api).*(not found|does not exist|no.*running).*',
    description: 'CAPI/CAPA controllers not installed or running',
    category: 'capi_setup',
    default_severity: 'upstream_breakage',
  },
  {
    type: 'api_rate_limit',
    pattern: '^(?!.*(?:Pattern matched|Issue detected|Fix applied|Monitor|Remediation|RETRYING|retries left)).*(?:HTTP.*429|rate.limit.exceed|throttl.*request|too.many.requests.*api).*',
    description: 'API rate limiting encountered',
    category: 'aws_infrastructure',
    default_severity: 'infrastructure',
  },
  {
    type: 'resource_quota_exceeded',
    pattern: '.*(quota|limit).*exceed.*',
    description: 'Resource quota or limit exceeded',
    category: 'aws_infrastructure',
    default_severity: 'infrastructure',
  },
  {
    type: 'rosacontrolplane_stuck_deletion',
    pattern: 'FAILED - RETRYING.*(?:rosacontrolplane|ROSAControlPlane).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosacontrolplane|ROSAControlPlane)',
    description: 'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
    category: 'rosa_lifecycle',
    default_severity: 'infrastructure',
  },
  {
    type: 'rosanetwork_stuck_deletion',
    pattern: 'FAILED - RETRYING.*(?:rosanetwork|ROSANetwork).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosanetwork|ROSANetwork)',
    description: 'ROSANetwork stuck in deletion state due to finalizers or VPC dependencies',
    category: 'rosa_lifecycle',
    default_severity: 'infrastructure',
  },
  {
    type: 'rosaroleconfig_stuck_deletion',
    pattern: 'FAILED - RETRYING.*(?:rosaroleconfig|ROSARoleConfig).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosaroleconfig|ROSARoleConfig)',
    description: 'ROSARoleConfig stuck in deletion state due to finalizers or IAM cleanup',
    category: 'rosa_lifecycle',
    default_severity: 'infrastructure',
  },
  {
    type: 'vpc_deletion_failure',
    pattern: '.*vpc.*(has dependencies|cannot be deleted|delete.*fail|DELETE_FAILED).*',
    description: 'VPC deletion failure due to orphaned dependencies',
    category: 'aws_infrastructure',
    default_severity: 'infrastructure',
  },
  {
    type: 'networking_configuration_error',
    pattern: '(?i)(?:subnet|vpc).*(?:invalid|not found|does not exist|no route|unreachable)',
    description: 'Network configuration error',
    category: 'aws_infrastructure',
    default_severity: 'infrastructure',
  },
  {
    type: 'repeated_timeouts',
    pattern: '^(?!.*(?:Pattern matched|Issue detected|RETRYING)).*(?:timed?.out|timeout.*(?:waiting|exceeded|expired)).*',
    description: 'Operation timing out repeatedly',
    category: 'infrastructure_timeout',
    default_severity: 'infrastructure',
  },
  {
    type: 'iam_permission_error',
    pattern: '(?i)(?:access denied|not authorized|AccessDenied|UnauthorizedAccess|iam.*(?:error|fail|denied))',
    description: 'IAM permission or role error',
    category: 'aws_iam',
    default_severity: 'infrastructure',
  },
];

// ============================================================
// Slack Notification (from notify Edge Function)
// ============================================================

const NOTIFIABLE_TYPES = new Set([
  'build_completed',
  'ticket_created',
  'ticket_updated',
  'diagnosis_completed',
  'fix_merged',
]);

const STATUS_EMOJI: Record<string, string> = {
  new: ':new:',
  investigating: ':mag:',
  root_caused: ':dart:',
  fix_in_progress: ':wrench:',
  resolved: ':white_check_mark:',
  verified: ':heavy_check_mark:',
};

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text?: string | { type: string; text: string }; url?: string }>;
  fields?: Array<{ type: string; text: string }>;
}

function buildSlackBlocks(
  activityType: string,
  title: string,
  description: string | null,
  actor: string,
  createdAt: string,
  ticket: { ticket_number: number; title: string; status: string; severity: string; assignee: string | null; root_cause: string | null; fix_pr_url: string | null } | null,
  build: { source: string; external_id: string; job_name: string; job_url: string | null; status: string; fail_count: number; total_count: number; ocp_version: string | null } | null,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: title.substring(0, 150), emoji: true },
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `*${activityType}* | ${actor} | <!date^${Math.floor(new Date(createdAt).getTime() / 1000)}^{date_short_pretty} at {time}|${createdAt}>`,
    }],
  });

  if (description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: description.substring(0, 2000) },
    });
  }

  if (ticket) {
    const statusEmoji = STATUS_EMOJI[ticket.status] ?? ':question:';
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Ticket:* CAPA-${ticket.ticket_number}` },
        { type: 'mrkdwn', text: `*Status:* ${statusEmoji} ${ticket.status}` },
        { type: 'mrkdwn', text: `*Severity:* ${ticket.severity.replace(/_/g, ' ')}` },
        { type: 'mrkdwn', text: `*Assignee:* ${ticket.assignee ?? 'unassigned'}` },
      ],
    });
    if (ticket.root_cause) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Root Cause:* ${ticket.root_cause}` },
      });
    }
    if (ticket.fix_pr_url) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Fix PR:* <${ticket.fix_pr_url}|View PR>` },
      });
    }
  }

  if (build) {
    const buildLink = build.job_url
      ? `<${build.job_url}|${build.job_name} #${build.external_id}>`
      : `${build.job_name} #${build.external_id}`;
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Build:* ${buildLink}` },
        { type: 'mrkdwn', text: `*Source:* ${build.source}` },
        { type: 'mrkdwn', text: `*Tests Failed:* ${build.fail_count}/${build.total_count}` },
        { type: 'mrkdwn', text: `*OCP:* ${build.ocp_version ?? 'n/a'}` },
      ],
    });
  }

  blocks.push({ type: 'divider' });
  return blocks;
}

async function sendSlackNotification(blocks: SlackBlock[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    log('WARN', 'notify', 'SLACK_WEBHOOK_URL not set, skipping notification');
    return;
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: SLACK_CHANNEL, blocks, unfurl_links: false, unfurl_media: false }),
  });

  if (!response.ok) {
    const body = await response.text();
    log('ERROR', 'notify', `Slack API error: ${response.status} ${body}`);
  } else {
    log('INFO', 'notify', `Slack notification sent to ${SLACK_CHANNEL}`);
  }
}

async function notifyActivity(
  activityType: string,
  title: string,
  description: string | null,
  actor: string,
  ticketId: string | null,
  buildId: string | null,
): Promise<void> {
  if (!NOTIFIABLE_TYPES.has(activityType)) return;

  let ticket = null;
  let build = null;

  if (ticketId) {
    const res = await query(
      `SELECT ticket_number, title, status::text, severity::text, assignee, root_cause, fix_pr_url
       FROM support_tickets WHERE id = $1`,
      [ticketId],
    );
    if (res.rows.length > 0) ticket = res.rows[0];
  }

  if (buildId) {
    const res = await query(
      `SELECT source, external_id, job_name, job_url, status::text, fail_count, total_count, ocp_version
       FROM builds WHERE id = $1`,
      [buildId],
    );
    if (res.rows.length > 0) build = res.rows[0];
  }

  const blocks = buildSlackBlocks(activityType, title, description, actor, new Date().toISOString(), ticket, build);
  await sendSlackNotification(blocks);
}

// ============================================================
// Error Signature Computation (from triage Edge Function)
// ============================================================

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function computeSignature(testFailures: TestFailure[]): string {
  if (!testFailures || testFailures.length === 0) return 'unknown';
  const f = testFailures[0];
  if (!f.errorMessage) return `${f.className ?? 'unknown'}::${f.name ?? 'unknown'}::no-error-message`;

  const normalized = f.errorMessage
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/0x[0-9a-fA-F]+/g, '<ADDR>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TS>')
    .replace(/:\d+/g, ':<N>')
    .trim();

  const hash = sha256Hex(normalized);
  return `${f.className ?? 'unknown'}::${f.name ?? 'unknown'}::${hash.substring(0, 16)}`;
}

// ============================================================
// Auto-Severity Classification (from triage Edge Function)
// ============================================================

function classifySeverity(
  jobName: string,
  failCount: number,
  totalCount: number,
  passCount: number,
  testFailures: TestFailure[],
): string {
  const jn = jobName.toLowerCase();

  if (jn.includes('nightly') || (totalCount > 0 && failCount === totalCount)) {
    return 'nightly_blocker';
  }

  const errorText = testFailures.map(f => f.errorMessage).join(' ').toLowerCase();

  if (/capi.*v1beta[12]|apigroup.*migration|cluster\.x-k8s\.io.*v1beta/.test(errorText) ||
      /ocp.*\d+\.\d+.*incompatible|openshift.*version.*mismatch/.test(errorText)) {
    return 'upstream_breakage';
  }

  if (/timeout|timed?\s*out|vpc.*not found|subnet.*invalid|access.denied|iam.*error|quota.*exceed/i.test(errorText)) {
    return 'infrastructure';
  }

  if (passCount > 0 && failCount > 0 && failCount <= 2) {
    return 'flaky';
  }

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
// Diagnosis (from diagnosis Edge Function)
// ============================================================

function diagnoseFailures(testFailures: TestFailure[]): DiagnosisResult | null {
  for (const failure of testFailures) {
    const errorText = failure.errorMessage ?? '';
    for (const issue of KNOWN_ISSUES) {
      try {
        const regex = new RegExp(issue.pattern, 'i');
        if (regex.test(errorText)) {
          return {
            root_cause: issue.description,
            root_cause_category: issue.category,
            severity: issue.default_severity,
            matched_pattern: issue.type,
          };
        }
      } catch {
        // Skip invalid regex patterns
      }
    }

    const stackText = failure.errorStackTrace ?? '';
    if (stackText) {
      for (const issue of KNOWN_ISSUES) {
        try {
          const regex = new RegExp(issue.pattern, 'i');
          if (regex.test(stackText)) {
            return {
              root_cause: issue.description,
              root_cause_category: issue.category,
              severity: issue.default_severity,
              matched_pattern: issue.type,
            };
          }
        } catch {
          // Skip invalid regex patterns
        }
      }
    }
  }
  return null;
}

// ============================================================
// Triage (from triage Edge Function -- runs inline after ingestion)
// ============================================================

async function triageBuild(buildId: string, source: string): Promise<TriageResult> {
  // 1. Fetch the build
  const buildRes = await query(
    `SELECT id, source, external_id, job_name, job_url, status::text AS status,
            pass_count, fail_count, skip_count, total_count, ocp_version,
            test_failures, started_at
     FROM builds WHERE id = $1`,
    [buildId],
  );

  if (buildRes.rows.length === 0) {
    throw new Error(`Build not found: ${buildId}`);
  }

  const build = buildRes.rows[0];

  if (build.status !== 'failure') {
    return { action: 'skipped' };
  }

  const testFailures: TestFailure[] = build.test_failures ?? [];
  const errorSignature = computeSignature(testFailures);

  // 2. Advisory lock + dedup check via the dedup_triage_check RPC function
  const dedupRes = await query(
    `SELECT * FROM dedup_triage_check($1)`,
    [errorSignature],
  );

  if (dedupRes.rows.length > 0 && dedupRes.rows[0].id) {
    const existing = dedupRes.rows[0];

    // Link build to existing ticket via activity
    await query(
      `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'build_completed',
        `Recurring failure linked to ticket #${existing.ticket_number}`,
        `Build ${build.job_name} #${build.external_id} failed with same error signature. Linked to existing ticket.`,
        existing.id,
        build.id,
        'triage-agent',
        JSON.stringify({ dedup: true, error_signature: errorSignature }),
      ],
    );

    log('INFO', 'triage', `Build ${buildId} linked to existing ticket #${existing.ticket_number}`, { errorSignature });

    return { action: 'linked', ticketId: existing.id, ticketNumber: existing.ticket_number, errorSignature };
  }

  // 3. No existing ticket -- create a new one
  const severity = classifySeverity(build.job_name, build.fail_count, build.total_count, build.pass_count, testFailures);
  const firstFailure = testFailures[0];
  const title = firstFailure
    ? `${firstFailure.className ?? build.job_name}: ${firstFailure.name ?? 'test failure'}`
    : `${build.job_name} build #${build.external_id} failed`;
  const description = firstFailure
    ? `**Error:** ${(firstFailure.errorMessage ?? 'No error message').substring(0, 500)}\n\n**Job:** ${build.job_name}\n**Build:** #${build.external_id}\n**OCP Version:** ${build.ocp_version ?? 'unknown'}\n**Failed Tests:** ${build.fail_count}/${build.total_count}`
    : `Build ${build.job_name} #${build.external_id} failed. ${build.fail_count} test failures out of ${build.total_count} total.`;

  const labels = [build.source, build.ocp_version ? `ocp-${build.ocp_version}` : null].filter(Boolean);

  const ticketRes = await query(
    `INSERT INTO support_tickets (title, description, status, severity, build_id, error_signature, labels)
     VALUES ($1, $2, 'new', $3::ticket_severity, $4, $5, $6)
     RETURNING id, ticket_number`,
    [title, description, severity, build.id, errorSignature, labels],
  );

  if (ticketRes.rows.length === 0) {
    throw new Error('Failed to create ticket');
  }

  const newTicket = ticketRes.rows[0];

  // 4. Create default tasks
  for (const task of DEFAULT_TASKS) {
    await query(
      `INSERT INTO tasks (ticket_id, title, sort_order) VALUES ($1, $2, $3)`,
      [newTicket.id, task.title, task.sort_order],
    );
  }

  // 5. Insert ticket_created activity
  const activityTitle = `Ticket #${newTicket.ticket_number} created: ${title}`;
  const activityDesc = `Auto-created by triage agent. Severity: ${severity}. Error signature: ${errorSignature}`;
  await query(
    `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'ticket_created',
      activityTitle,
      activityDesc,
      newTicket.id,
      build.id,
      'triage-agent',
      JSON.stringify({ severity, error_signature: errorSignature, auto_created: true }),
    ],
  );

  log('INFO', 'triage', `Created ticket #${newTicket.ticket_number}`, { severity, errorSignature, buildId });

  // 6. Run diagnosis inline (not via HTTP)
  try {
    await runDiagnosis(newTicket.id, buildId, testFailures);
  } catch (err) {
    log('ERROR', 'diagnosis', `Diagnosis failed for ticket #${newTicket.ticket_number}: ${(err as Error).message}`);
  }

  // 7. Send Slack notification for the new ticket
  try {
    await notifyActivity('ticket_created', activityTitle, activityDesc, 'triage-agent', newTicket.id, build.id);
  } catch (err) {
    log('ERROR', 'notify', `Slack notification failed: ${(err as Error).message}`);
  }

  return { action: 'created', ticketId: newTicket.id, ticketNumber: newTicket.ticket_number, errorSignature };
}

// ============================================================
// Run Diagnosis Inline (from diagnosis Edge Function)
// ============================================================

async function runDiagnosis(ticketId: string, buildId: string, testFailures: TestFailure[]): Promise<void> {
  const diagStartTime = Date.now();

  const diagnosisResult = diagnoseFailures(testFailures);

  if (diagnosisResult) {
    // Check if current severity is the default before adjusting
    const currentRes = await query(
      `SELECT severity::text AS severity FROM support_tickets WHERE id = $1`,
      [ticketId],
    );
    const currentSeverity = currentRes.rows[0]?.severity;

    const updateFields: string[] = [
      'root_cause = $2',
      'root_cause_category = $3',
      'diagnosed_at = now()',
    ];
    const updateParams: unknown[] = [ticketId, diagnosisResult.root_cause, diagnosisResult.root_cause_category];

    if (currentSeverity === 'test_regression' && diagnosisResult.severity !== 'test_regression') {
      updateFields.push(`severity = $${updateParams.length + 1}::ticket_severity`);
      updateParams.push(diagnosisResult.severity);
    }

    await query(
      `UPDATE support_tickets SET ${updateFields.join(', ')} WHERE id = $1`,
      updateParams,
    );

    // Insert diagnosis_completed activity
    await query(
      `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'diagnosis_completed',
        `Diagnosis completed: ${diagnosisResult.matched_pattern}`,
        `Root cause identified: ${diagnosisResult.root_cause}. Category: ${diagnosisResult.root_cause_category}.`,
        ticketId,
        buildId,
        'diagnosis-agent',
        JSON.stringify({
          matched_pattern: diagnosisResult.matched_pattern,
          root_cause: diagnosisResult.root_cause,
          root_cause_category: diagnosisResult.root_cause_category,
          severity_adjusted: currentSeverity !== diagnosisResult.severity,
          patterns_checked: KNOWN_ISSUES.length,
        }),
      ],
    );

    log('INFO', 'diagnosis', `Matched pattern: ${diagnosisResult.matched_pattern}`, {
      ticketId, buildId, category: diagnosisResult.root_cause_category,
    });

    // Notify on diagnosis
    try {
      await notifyActivity(
        'diagnosis_completed',
        `Diagnosis completed: ${diagnosisResult.matched_pattern}`,
        `Root cause identified: ${diagnosisResult.root_cause}. Category: ${diagnosisResult.root_cause_category}.`,
        'diagnosis-agent',
        ticketId,
        buildId,
      );
    } catch (err) {
      log('ERROR', 'notify', `Slack notification for diagnosis failed: ${(err as Error).message}`);
    }
  } else {
    // No known pattern matched
    await query(
      `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'diagnosis_completed',
        'Diagnosis completed: no known pattern matched',
        `Checked ${KNOWN_ISSUES.length} known issue patterns against ${testFailures.length} test failure(s). No match found -- manual investigation required.`,
        ticketId,
        buildId,
        'diagnosis-agent',
        JSON.stringify({
          matched_pattern: null,
          patterns_checked: KNOWN_ISSUES.length,
          failures_checked: testFailures.length,
        }),
      ],
    );

    log('INFO', 'diagnosis', 'No known pattern matched', {
      ticketId, buildId, patternsChecked: KNOWN_ISSUES.length, failuresChecked: testFailures.length,
    });
  }

  await recordAgentRun({
    agentName: 'diagnosis',
    trigger: 'inline',
    inputPayload: { ticket_id: ticketId, build_id: buildId },
    outputPayload: diagnosisResult ?? { matched: false },
    success: true,
    durationMs: Date.now() - diagStartTime,
  });
}

// ============================================================
// Jenkins Ingestion (from ingest-jenkins Edge Function)
// ============================================================

function mapJenkinsResult(result: string | null): string {
  if (!result) return 'running';
  switch (result.toUpperCase()) {
    case 'SUCCESS': return 'success';
    case 'FAILURE': return 'failure';
    case 'ABORTED': return 'aborted';
    case 'UNSTABLE': return 'unstable';
    default: return 'pending';
  }
}

function extractParameters(actions: JenkinsBuild['actions']): Record<string, string> {
  const params: Record<string, string> = {};
  for (const action of actions) {
    if (action.parameters) {
      for (const p of action.parameters) {
        params[p.name] = p.value;
      }
    }
  }
  return params;
}

function extractOcpVersion(params: Record<string, string>): string | null {
  for (const key of ['OCP_VERSION', 'OPENSHIFT_VERSION', 'ocp_version', 'VERSION']) {
    if (params[key]) return params[key];
  }
  return null;
}

async function fetchJenkinsApi(path: string): Promise<unknown> {
  const url = `${JENKINS_BASE_URL}${path}`;
  const credentials = Buffer.from(`${JENKINS_USER}:${JENKINS_API_TOKEN}`).toString('base64');

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Jenkins API error: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

async function fetchTestReport(buildNumber: number): Promise<JenkinsTestReport | null> {
  try {
    return await fetchJenkinsApi(`/${buildNumber}/testReport/api/json`) as JenkinsTestReport;
  } catch {
    return null;
  }
}

function extractTestFailures(report: JenkinsTestReport | null): TestFailure[] {
  if (!report) return [];
  const failures: TestFailure[] = [];
  for (const suite of report.suites ?? []) {
    for (const testCase of suite.cases ?? []) {
      if (testCase.status === 'FAILED' || testCase.status === 'REGRESSION') {
        failures.push({
          name: testCase.name,
          className: testCase.className,
          errorMessage: testCase.errorDetails ?? '',
          errorStackTrace: testCase.errorStackTrace ?? '',
        });
      }
    }
  }
  return failures;
}

async function ingestJenkins(): Promise<{ ingested: number; skipped: number; errors: string[]; newFailureBuildIds: string[] }> {
  const result = { ingested: 0, skipped: 0, errors: [] as string[], newFailureBuildIds: [] as string[] };

  for (const jobName of JENKINS_JOBS) {
    let builds: JenkinsBuild[];
    try {
      const data = await fetchJenkinsApi(
        `/api/json?tree=builds[number,result,timestamp,duration,url,actions[parameters[name,value]]]{0,20}`,
      ) as { builds: JenkinsBuild[] };
      builds = data.builds ?? [];
    } catch (err) {
      result.errors.push(`Failed to fetch builds for ${jobName}: ${(err as Error).message}`);
      continue;
    }

    for (const build of builds) {
      try {
        const parameters = extractParameters(build.actions ?? []);
        const ocpVersion = extractOcpVersion(parameters);
        const status = mapJenkinsResult(build.result);

        let testReport: JenkinsTestReport | null = null;
        if (build.result) {
          testReport = await fetchTestReport(build.number);
        }

        const testFailures = extractTestFailures(testReport);
        const startedAt = new Date(build.timestamp).toISOString();
        const finishedAt = build.result ? new Date(build.timestamp + build.duration).toISOString() : null;

        // Upsert the build using ON CONFLICT with terminal-state guard
        const upsertRes = await query(
          `INSERT INTO builds (source, external_id, job_name, job_url, status, pass_count, fail_count,
                               skip_count, total_count, duration_ms, started_at, finished_at,
                               ocp_version, parameters, test_failures, raw_payload)
           VALUES ($1, $2, $3, $4, $5::build_status, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (source, external_id, job_name) DO UPDATE SET
             status = EXCLUDED.status,
             pass_count = EXCLUDED.pass_count,
             fail_count = EXCLUDED.fail_count,
             skip_count = EXCLUDED.skip_count,
             total_count = EXCLUDED.total_count,
             duration_ms = EXCLUDED.duration_ms,
             finished_at = EXCLUDED.finished_at,
             ocp_version = EXCLUDED.ocp_version,
             parameters = EXCLUDED.parameters,
             test_failures = EXCLUDED.test_failures,
             raw_payload = EXCLUDED.raw_payload,
             updated_at = now()
           WHERE builds.status NOT IN ('success', 'failure', 'aborted')
              OR builds.status = 'pending'
           RETURNING id, (xmax = 0) AS is_insert`,
          [
            'jenkins', String(build.number), jobName, build.url, status,
            testReport?.passCount ?? 0, testReport?.failCount ?? 0,
            testReport?.skipCount ?? 0,
            (testReport?.passCount ?? 0) + (testReport?.failCount ?? 0) + (testReport?.skipCount ?? 0),
            build.duration || null, startedAt, finishedAt,
            ocpVersion, JSON.stringify(parameters), JSON.stringify(testFailures), JSON.stringify(build),
          ],
        );

        if (upsertRes.rows.length === 0) {
          result.skipped++;
          continue;
        }

        const upsertedBuild = upsertRes.rows[0];

        // Insert build_completed activity for finished builds (only if not already logged)
        if (build.result) {
          const activityCheck = await query(
            `SELECT 1 FROM activities WHERE build_id = $1 AND activity_type = 'build_completed' LIMIT 1`,
            [upsertedBuild.id],
          );

          if (activityCheck.rows.length === 0) {
            await query(
              `INSERT INTO activities (activity_type, title, description, build_id, actor, metadata)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                'build_completed',
                `Build #${build.number} ${status}`,
                `Jenkins job ${jobName} build #${build.number} completed with status: ${status}. ${testReport?.failCount ?? 0} test failures.`,
                upsertedBuild.id,
                'ingest-jenkins',
                JSON.stringify({
                  source: 'jenkins', job_name: jobName, build_number: build.number,
                  pass_count: testReport?.passCount ?? 0, fail_count: testReport?.failCount ?? 0,
                }),
              ],
            );
          }
        }

        // Track new failures for triage
        if (status === 'failure' && upsertedBuild.is_insert) {
          result.newFailureBuildIds.push(upsertedBuild.id);
        }

        result.ingested++;
      } catch (err) {
        result.errors.push(`Error processing Jenkins build #${build.number}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}

// ============================================================
// Prow Ingestion (from ingest-prow Edge Function)
// ============================================================

function mapProwState(state: string): string {
  switch (state.toLowerCase()) {
    case 'success': return 'success';
    case 'failure': case 'error': return 'failure';
    case 'pending': case 'triggered': return 'pending';
    case 'aborted': return 'aborted';
    default: return 'pending';
  }
}

function isRelevantJob(jobName: string): boolean {
  return PROW_JOB_PATTERNS.some(pattern => pattern.test(jobName));
}

function extractOcpVersionFromJobName(jobName: string): string | null {
  const match = jobName.match(/release-(\d+\.\d+)/);
  if (match) return match[1];
  const nightlyMatch = jobName.match(/(\d+\.\d+(?:\.\d+)?(?:-nightly)?)/);
  if (nightlyMatch) return nightlyMatch[1];
  return null;
}

function extractTestFailuresFromDescription(description?: string): TestFailure[] {
  if (!description) return [];
  return [{
    name: 'prow-job-result',
    className: 'ProwJobExecution',
    errorMessage: description,
    errorStackTrace: '',
  }];
}

async function ingestProw(): Promise<{ ingested: number; skipped: number; errors: string[]; newFailureBuildIds: string[] }> {
  const result = { ingested: 0, skipped: 0, errors: [] as string[], newFailureBuildIds: [] as string[] };

  const response = await fetch(PROW_API_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Prow API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { items?: ProwJob[] };
  const prowJobs = data.items ?? [];
  const relevantJobs = prowJobs.filter(pj => isRelevantJob(pj.spec.job));

  log('INFO', 'ingest-prow', `Fetched ${prowJobs.length} jobs, ${relevantJobs.length} relevant`);

  for (const prowJob of relevantJobs) {
    try {
      const jobName = prowJob.spec.job;
      const buildId = prowJob.status.build_id ?? prowJob.metadata?.name ?? `${jobName}-${prowJob.status.startTime ?? 'unknown'}`;
      const status = mapProwState(prowJob.status.state);
      const ocpVersion = extractOcpVersionFromJobName(jobName);

      let durationMs: number | null = null;
      if (prowJob.status.startTime && prowJob.status.completionTime) {
        const d = new Date(prowJob.status.completionTime).getTime() - new Date(prowJob.status.startTime).getTime();
        durationMs = d >= 0 ? d : null;
      }

      const testFailures = status === 'failure'
        ? extractTestFailuresFromDescription(prowJob.status.description)
        : [];

      const prowParams = {
        prow_job_type: prowJob.spec.type,
        cluster: prowJob.spec.cluster ?? null,
        refs: prowJob.spec.refs ?? null,
      };

      const upsertRes = await query(
        `INSERT INTO builds (source, external_id, job_name, job_url, status, pass_count, fail_count,
                             skip_count, total_count, duration_ms, started_at, finished_at,
                             ocp_version, parameters, test_failures, raw_payload)
         VALUES ($1, $2, $3, $4, $5::build_status, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (source, external_id, job_name) DO UPDATE SET
           status = EXCLUDED.status,
           pass_count = EXCLUDED.pass_count,
           fail_count = EXCLUDED.fail_count,
           skip_count = EXCLUDED.skip_count,
           total_count = EXCLUDED.total_count,
           duration_ms = EXCLUDED.duration_ms,
           finished_at = EXCLUDED.finished_at,
           ocp_version = EXCLUDED.ocp_version,
           parameters = EXCLUDED.parameters,
           test_failures = EXCLUDED.test_failures,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = now()
         WHERE builds.status NOT IN ('success', 'failure', 'aborted')
            OR builds.status = 'pending'
         RETURNING id, (xmax = 0) AS is_insert`,
        [
          'prow', buildId, jobName, prowJob.status.url ?? null, status,
          status === 'success' ? 1 : 0, status === 'failure' ? 1 : 0,
          0, 1,
          durationMs, prowJob.status.startTime ?? null, prowJob.status.completionTime ?? null,
          ocpVersion, JSON.stringify(prowParams), JSON.stringify(testFailures), JSON.stringify(prowJob),
        ],
      );

      if (upsertRes.rows.length === 0) {
        result.skipped++;
        continue;
      }

      const upsertedBuild = upsertRes.rows[0];

      // Insert build_completed activity for finished builds
      if (prowJob.status.completionTime) {
        const activityCheck = await query(
          `SELECT 1 FROM activities WHERE build_id = $1 AND activity_type = 'build_completed' LIMIT 1`,
          [upsertedBuild.id],
        );

        if (activityCheck.rows.length === 0) {
          await query(
            `INSERT INTO activities (activity_type, title, description, build_id, actor, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              'build_completed',
              `Prow job ${jobName} ${status}`,
              `Prow periodic job ${jobName} completed with status: ${status}.${prowJob.status.description ? ' ' + prowJob.status.description : ''}`,
              upsertedBuild.id,
              'ingest-prow',
              JSON.stringify({
                source: 'prow', job_name: jobName, build_id: buildId, prow_state: prowJob.status.state,
              }),
            ],
          );
        }
      }

      // Track new failures for triage
      if (status === 'failure' && upsertedBuild.is_insert) {
        result.newFailureBuildIds.push(upsertedBuild.id);
      }

      result.ingested++;
    } catch (err) {
      result.errors.push(`Error processing Prow job ${prowJob.spec.job}: ${(err as Error).message}`);
    }
  }

  return result;
}

// ============================================================
// Main Entry Point
// ============================================================

async function main() {
  const startTime = Date.now();

  // Parse --source=jenkins|prow from CLI args
  const sourceArg = process.argv.find(a => a.startsWith('--source='));
  if (!sourceArg) {
    log('ERROR', 'ingest', 'Missing --source argument. Usage: --source=jenkins or --source=prow');
    process.exit(1);
  }
  const source = sourceArg.split('=')[1];
  if (source !== 'jenkins' && source !== 'prow') {
    log('ERROR', 'ingest', `Invalid source: ${source}. Must be "jenkins" or "prow".`);
    process.exit(1);
  }

  const agentName = `ingest-${source}`;
  log('INFO', agentName, `Starting ${source} ingestion`);

  let result: { ingested: number; skipped: number; errors: string[]; newFailureBuildIds: string[] };

  try {
    if (source === 'jenkins') {
      result = await ingestJenkins();
    } else {
      result = await ingestProw();
    }

    log('INFO', agentName, `Ingestion complete: ${result.ingested} ingested, ${result.skipped} skipped, ${result.errors.length} errors`);

    // Run triage inline for each new failure
    const triageResults: TriageResult[] = [];
    for (const buildId of result.newFailureBuildIds) {
      try {
        const triageResult = await triageBuild(buildId, source);
        triageResults.push(triageResult);
      } catch (err) {
        log('ERROR', 'triage', `Triage failed for build ${buildId}: ${(err as Error).message}`);
        result.errors.push(`Triage failed for build ${buildId}: ${(err as Error).message}`);
      }
    }

    const ticketsCreated = triageResults.filter(r => r.action === 'created').length;
    const ticketsLinked = triageResults.filter(r => r.action === 'linked').length;

    log('INFO', agentName, `Triage complete: ${ticketsCreated} tickets created, ${ticketsLinked} linked to existing`);

    const overallSuccess = result.errors.length === 0;

    // Log the agent run
    await recordAgentRun({
      agentName,
      trigger: 'cron',
      inputPayload: source === 'jenkins'
        ? { jobs: JENKINS_JOBS }
        : { api_url: PROW_API_URL },
      outputPayload: {
        ingested: result.ingested,
        skipped: result.skipped,
        errors: result.errors,
        tickets_created: ticketsCreated,
        tickets_linked: ticketsLinked,
      },
      success: overallSuccess,
      errorMessage: overallSuccess ? null : `${result.errors.length} error(s)`,
      durationMs: Date.now() - startTime,
    });

    log('INFO', agentName, `Job finished in ${Date.now() - startTime}ms`, {
      ingested: result.ingested, skipped: result.skipped,
      errors: result.errors.length, ticketsCreated, ticketsLinked,
    });

    await pool.end();
    process.exit(overallSuccess ? 0 : 1);
  } catch (err) {
    const errorMessage = (err as Error).message;
    log('ERROR', agentName, `Fatal error: ${errorMessage}`);

    await recordAgentRun({
      agentName,
      trigger: 'cron',
      inputPayload: { source },
      outputPayload: null,
      success: false,
      errorMessage,
      durationMs: Date.now() - startTime,
    });

    await pool.end();
    process.exit(1);
  }
}

main();
