/**
 * notify -- Node.js agent
 *
 * Triggered by new_activity events. Reads the activity and joined
 * ticket/build context, then sends a Slack Block Kit message via webhook.
 * Records notification_sent activity.
 *
 * Supports streak event notifications (streak_detected, streak_phase_change,
 * signature_cleared, streak_resolved) with enriched Block Kit messages.
 * Ported from supabase/functions/notify/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';

const AGENT_NAME = 'notify';

export interface NotifyParams {
  event_type: string;
  activity_id?: string;
  ticket_id?: string;
  build_id?: string;
}

export interface AgentResult {
  success: boolean;
  message: string;
  skipped?: boolean;
  reason?: string;
  channel?: string;
}

// Activity types that should trigger Slack notifications
const NOTIFIABLE_TYPES = new Set([
  'build_completed',
  'ticket_created',
  'ticket_updated',
  'diagnosis_completed',
  'fix_merged',
  'streak_detected',
  'streak_phase_change',
  'signature_cleared',
  'streak_resolved',
]);

// Streak activity types that require throttle checking
const STREAK_TYPES = new Set([
  'streak_detected',
  'streak_phase_change',
  'signature_cleared',
  'streak_resolved',
]);

// Severity color mapping for Slack
const SEVERITY_COLORS: Record<string, string> = {
  nightly_blocker: '#dc2626',
  upstream_breakage: '#ea580c',
  test_regression: '#eab308',
  infrastructure: '#6366f1',
  flaky: '#8b5cf6',
};

// Status emoji mapping
const STATUS_EMOJI: Record<string, string> = {
  new: ':new:',
  investigating: ':mag:',
  root_caused: ':dart:',
  fix_in_progress: ':wrench:',
  resolved: ':white_check_mark:',
  verified: ':heavy_check_mark:',
};

// Streak status emoji mapping
const STREAK_STATUS_EMOJI: Record<string, string> = {
  active: ':rotating_light:',
  partial_fix: ':construction:',
  resolved: ':tada:',
};

interface Activity {
  id: string;
  activity_type: string;
  title: string;
  description: string | null;
  build_id: string | null;
  ticket_id: string | null;
  actor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Ticket {
  id: string;
  ticket_number: number;
  title: string;
  status: string;
  severity: string;
  assignee: string | null;
  error_signature: string | null;
  root_cause: string | null;
  fix_pr_url: string | null;
  streak_id?: string | null;
}

interface Build {
  id: string;
  source: string;
  external_id: string;
  job_name: string;
  job_url: string | null;
  status: string;
  fail_count: number;
  total_count: number;
  ocp_version: string | null;
}

interface StreakPhase {
  phase_number: number;
  error_signature: string | null;
  first_build_id: string;
  last_build_id: string;
  first_seen: string;
  last_seen: string;
  build_count: number;
  ticket_id: string | null;
  fix_pr_url: string | null;
  fix_verified: boolean;
  summary: string | null;
}

interface FailureStreak {
  id: string;
  job_name: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  streak_length: number;
  phase_count: number;
  phases: StreakPhase[];
  analysis_summary: string | null;
  status: string;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string };
    url?: string;
    action_id?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
  accessory?: Record<string, unknown>;
}

// ============================================================
// Prepared statements
// ============================================================

const getActivityStmt = db.prepare('SELECT * FROM activities WHERE id = ?');

const getTicketStmt = db.prepare(`
  SELECT id, ticket_number, title, status, severity, assignee,
    error_signature, root_cause, fix_pr_url, streak_id
  FROM support_tickets WHERE id = ?
`);

const getBuildStmt = db.prepare(`
  SELECT id, source, external_id, job_name, job_url, status,
    fail_count, total_count, ocp_version
  FROM builds WHERE id = ?
`);

const getStreakStmt = db.prepare('SELECT * FROM failure_streaks WHERE id = ?');

const getTicketsByIdsStmt = (ids: string[]) => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, ticket_number, title, status, severity, assignee,
      error_signature, root_cause, fix_pr_url
    FROM support_tickets WHERE id IN (${placeholders})
  `).all(...ids) as unknown as Ticket[];
};

const checkThrottleStmt = db.prepare(`
  SELECT id FROM activities
  WHERE activity_type = 'notification_sent'
    AND created_at >= ?
    AND json_extract(metadata, '$.source_activity_type') = ?
    AND json_extract(metadata, '$.streak_id') = ?
  LIMIT 1
`);

const insertActivityStmt = db.prepare(`
  INSERT INTO activities (id, activity_type, title, description, ticket_id, build_id, actor, metadata, created_at)
  VALUES (?, 'notification_sent', ?, ?, ?, ?, 'notify-agent', ?, ?)
`);

const insertAgentRunStmt = db.prepare(`
  INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, output_payload, success, duration_ms, created_at)
  VALUES (?, ?, 'event', ?, ?, ?, ?, ?)
`);

const updateAgentRunStmt = db.prepare(`
  UPDATE agent_runs SET success = ?, output_payload = ?, duration_ms = ?, error_message = ? WHERE id = ?
`);

// ============================================================
// Throttle check
// ============================================================

function isThrottled(streakId: string, activityType: string): boolean {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const row = checkThrottleStmt.get(twelveHoursAgo, activityType, streakId);
  return !!row;
}

// ============================================================
// Formatting helpers
// ============================================================

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function truncateSignature(sig: string | null, maxLen = 40): string {
  if (!sig) return '(unknown)';
  if (sig.length <= maxLen) return sig;
  return sig.substring(0, maxLen) + '...';
}

// ============================================================
// Streak-aware Block Kit builders
// ============================================================

function buildStreakDetectedBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const statusEmoji = STREAK_STATUS_EMOJI[streak.status] || ':warning:';

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${statusEmoji} Failure Streak Detected`, emoji: true },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${streak.job_name}* has failed *${streak.streak_length} consecutive builds* since ${formatDate(streak.started_at)}. *${streak.phase_count} distinct error phase(s)*.`,
    },
  });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Duration:* ${streak.streak_length} builds over ${formatDuration(streak.started_at, streak.ended_at)}` },
      { type: 'mrkdwn', text: `*Source:* ${streak.source}` },
    ],
  });

  if (streak.phases.length > 0) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id ? phaseTickets.get(phase.ticket_id) : null;
      const ticketRef = ticket
        ? `CAPA-${ticket.ticket_number} (${STATUS_EMOJI[ticket.status] || ''} ${ticket.status})`
        : 'no ticket';
      const verified = phase.fix_verified ? ' :white_check_mark: verified' : '';
      const prRef = phase.fix_pr_url ? ` | <${phase.fix_pr_url}|PR>` : '';
      return `  Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${prRef}${verified}`;
    });

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Phases:*\n${phaseLines.join('\n')}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `streak_detected | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
    }],
  });

  blocks.push({ type: 'divider' });
  return blocks;
}

function buildStreakPhaseChangeBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: ':rotating_light: Streak Phase Change', emoji: true },
  });

  const newPhaseNumber =
    (activity.metadata?.new_phase_number as number) ??
    streak.phases[streak.phases.length - 1]?.phase_number;
  const newPhase = streak.phases.find((p) => p.phase_number === newPhaseNumber);
  const matchedPattern = (activity.metadata?.matched_pattern as string) ?? newPhase?.summary ?? null;

  let description = `*${streak.job_name}*: error signature changed.`;
  if (matchedPattern) description += ` New phase: _${matchedPattern}_`;
  if (newPhase) {
    description += `\n\nPhase ${newPhase.phase_number} started ${formatDate(newPhase.first_seen)} with signature: \`${truncateSignature(newPhase.error_signature, 60)}\``;
  }

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: description } });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Streak Length:* ${streak.streak_length} builds` },
      { type: 'mrkdwn', text: `*Total Phases:* ${streak.phase_count}` },
    ],
  });

  if (streak.phases.length > 1) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id ? phaseTickets.get(phase.ticket_id) : null;
      const ticketRef = ticket ? `CAPA-${ticket.ticket_number}` : 'no ticket';
      const current = phase.phase_number === newPhaseNumber ? ' :point_left: *current*' : '';
      const verified = phase.fix_verified ? ' :white_check_mark:' : '';
      return `  Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${verified}${current}`;
    });

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*All phases:*\n${phaseLines.join('\n')}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `streak_phase_change | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
    }],
  });

  blocks.push({ type: 'divider' });
  return blocks;
}

function buildSignatureClearedBlocks(
  activity: Activity,
  streak: FailureStreak | null,
  ticket: Ticket | null,
  build: Build | null,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: ':eyes: Error Signature Cleared', emoji: true },
  });

  const errorSig = (activity.metadata?.error_signature as string) ?? null;
  const clearingBuildStatus = (activity.metadata?.clearing_build_status as string) ?? 'unknown';

  let mainText: string;
  if (ticket) {
    const prRef = ticket.fix_pr_url ? ` Fix <${ticket.fix_pr_url}|PR> appears to be working` : '';
    if (clearingBuildStatus === 'failure') {
      mainText = `*CAPA-${ticket.ticket_number}'s error* (\`${truncateSignature(errorSig, 50)}\`) *no longer appears in the latest build*.${prRef ? ` ${prRef},` : ''} but the build is still failing for a different reason.`;
    } else {
      mainText = `*CAPA-${ticket.ticket_number}'s error* (\`${truncateSignature(errorSig, 50)}\`) *has been resolved*.${prRef ? ` ${prRef}.` : ''} Build is now passing.`;
    }
  } else {
    mainText = activity.description ?? `Error signature \`${truncateSignature(errorSig, 50)}\` no longer appears in the latest build.`;
  }

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: mainText } });

  if (clearingBuildStatus === 'failure' && build) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *Build still failed* (${build.fail_count}/${build.total_count} tests) -- the specific error tracked by this ticket is gone, but the build has other failures.`,
      },
    });
  }

  if (ticket) {
    const statusEmoji = STATUS_EMOJI[ticket.status] || ':question:';
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Ticket:* CAPA-${ticket.ticket_number}` },
        { type: 'mrkdwn', text: `*Status:* ${statusEmoji} ${ticket.status}` },
      ],
    });
  }

  if (build) {
    const buildLink = build.job_url
      ? `<${build.job_url}|${build.job_name} #${build.external_id}>`
      : `${build.job_name} #${build.external_id}`;
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Clearing Build:* ${buildLink}` },
        { type: 'mrkdwn', text: `*Build Status:* ${clearingBuildStatus}` },
      ],
    });
  }

  if (streak) {
    const verifiedCount = streak.phases.filter((p) => p.fix_verified).length;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Streak progress:* ${verifiedCount}/${streak.phase_count} phases verified fixed (${streak.job_name}, ${streak.streak_length} builds)`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `signature_cleared | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
    }],
  });

  blocks.push({ type: 'divider' });
  return blocks;
}

function buildStreakResolvedBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: ':tada: Failure Streak Resolved', emoji: true },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${streak.job_name}* failure streak resolved. All *${streak.phase_count} phase(s)* verified fixed.`,
    },
  });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Duration:* ${streak.streak_length} builds over ${formatDuration(streak.started_at, streak.ended_at)}` },
      { type: 'mrkdwn', text: `*Period:* ${formatDate(streak.started_at)} - ${streak.ended_at ? formatDate(streak.ended_at) : 'now'}` },
    ],
  });

  if (streak.phases.length > 0) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id ? phaseTickets.get(phase.ticket_id) : null;
      const ticketRef = ticket ? `CAPA-${ticket.ticket_number}` : 'no ticket';
      const prRef = phase.fix_pr_url ? ` | <${phase.fix_pr_url}|PR>` : '';
      return `  :white_check_mark: Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${prRef}`;
    });

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Verified phases:*\n${phaseLines.join('\n')}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `streak_resolved | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
    }],
  });

  blocks.push({ type: 'divider' });
  return blocks;
}

// ============================================================
// Standard (non-streak) Block Kit builder
// ============================================================

function buildSlackBlocks(
  activity: Activity,
  ticket: Ticket | null,
  build: Build | null,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: activity.title.substring(0, 150), emoji: true },
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `*${activity.activity_type}* | ${activity.actor || 'system'} | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
    }],
  });

  if (activity.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: activity.description.substring(0, 2000) },
    });
  }

  if (ticket) {
    const statusEmoji = STATUS_EMOJI[ticket.status] || ':question:';

    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Ticket:* CAPA-${ticket.ticket_number}` },
        { type: 'mrkdwn', text: `*Status:* ${statusEmoji} ${ticket.status}` },
        { type: 'mrkdwn', text: `*Severity:* ${ticket.severity.replace(/_/g, ' ')}` },
        { type: 'mrkdwn', text: `*Assignee:* ${ticket.assignee || 'unassigned'}` },
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
        { type: 'mrkdwn', text: `*OCP:* ${build.ocp_version || 'n/a'}` },
      ],
    });
  }

  blocks.push({ type: 'divider' });
  return blocks;
}

// ============================================================
// Slack webhook sender
// ============================================================

async function sendSlackNotification(
  webhookUrl: string,
  channel: string,
  blocks: SlackBlock[],
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: `Slack API error: ${response.status} ${body}` };
  }

  const body = await response.text();
  if (body === 'ok') {
    return { ok: true, ts: new Date().toISOString() };
  }

  try {
    const json = JSON.parse(body);
    return { ok: json.ok, ts: json.ts, error: json.error };
  } catch {
    return { ok: true, ts: new Date().toISOString() };
  }
}

// ============================================================
// Resolve streak_id from activity metadata or linked ticket
// ============================================================

function resolveStreakId(activity: Activity): string | null {
  if (activity.metadata?.streak_id) {
    return activity.metadata.streak_id as string;
  }

  if (activity.ticket_id) {
    const ticket = getTicketStmt.get(activity.ticket_id) as Ticket | undefined;
    if (ticket?.streak_id) {
      return ticket.streak_id;
    }
  }

  return null;
}

// ============================================================
// Exported run function
// ============================================================

export async function run(params: NotifyParams): Promise<AgentResult> {
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const SLACK_CHANNEL = process.env.SLACK_CHANNEL || '#capa-ci-alerts';

  if (!SLACK_WEBHOOK_URL) {
    console.warn('[notify] SLACK_WEBHOOK_URL not set -- skipping notification');
    return { success: true, message: 'SLACK_WEBHOOK_URL not configured, notification skipped', skipped: true };
  }

  const activityId = params.activity_id;
  if (!activityId) {
    return { success: false, message: 'activity_id is required' };
  }

  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'event', ?, 0, ?)
  `).run(runId, AGENT_NAME, JSON.stringify({ activity_id: activityId }), startedAt);

  try {
    // Fetch the activity
    const rawActivity = getActivityStmt.get(activityId) as Record<string, unknown> | undefined;

    if (!rawActivity) {
      throw new Error(`Activity not found: ${activityId}`);
    }

    // Parse metadata from JSON string
    const activity: Activity = {
      ...rawActivity,
      metadata: typeof rawActivity.metadata === 'string'
        ? JSON.parse(rawActivity.metadata || '{}')
        : (rawActivity.metadata as Record<string, unknown>) || {},
    } as Activity;

    // Skip non-notifiable activity types
    if (!NOTIFIABLE_TYPES.has(activity.activity_type)) {
      updateAgentRunStmt.run(
        1,
        JSON.stringify({ skipped: true, reason: `Activity type '${activity.activity_type}' is not notifiable` }),
        Date.now() - startTime,
        null,
        runId,
      );
      return {
        success: true,
        message: 'Non-notifiable activity type',
        skipped: true,
        reason: 'non-notifiable activity type',
      };
    }

    // Skip notification_sent activities to prevent infinite loops
    if (activity.activity_type === 'notification_sent') {
      return { success: true, message: 'Loop prevention', skipped: true, reason: 'notification_sent loop prevention' };
    }

    // Skip dedup activities (recurring failure links) to avoid noise
    if (activity.metadata?.dedup === true) {
      updateAgentRunStmt.run(
        1,
        JSON.stringify({ skipped: true, reason: 'dedup activity' }),
        Date.now() - startTime,
        null,
        runId,
      );
      return { success: true, message: 'Dedup activity skipped', skipped: true, reason: 'dedup' };
    }

    // Streak throttle check
    let streakId: string | null = null;

    if (STREAK_TYPES.has(activity.activity_type)) {
      streakId = resolveStreakId(activity);

      if (streakId) {
        const throttled = isThrottled(streakId, activity.activity_type);
        if (throttled) {
          updateAgentRunStmt.run(
            1,
            JSON.stringify({ skipped: true, reason: `Throttled: ${activity.activity_type} for streak ${streakId} already notified within 12h` }),
            Date.now() - startTime,
            null,
            runId,
          );
          return { success: true, message: 'Throttled', skipped: true, reason: 'throttled' };
        }
      }
    }

    // Fetch related ticket and build for context
    let ticket: Ticket | null = null;
    let build: Build | null = null;

    if (activity.ticket_id) {
      ticket = (getTicketStmt.get(activity.ticket_id) as unknown as Ticket) ?? null;
    }

    if (activity.build_id) {
      build = (getBuildStmt.get(activity.build_id) as unknown as Build) ?? null;
    }

    // Build Slack blocks
    let blocks: SlackBlock[];

    if (STREAK_TYPES.has(activity.activity_type)) {
      let streak: FailureStreak | null = null;
      let phaseTickets: Map<string, Ticket> = new Map();

      if (streakId) {
        const rawStreak = getStreakStmt.get(streakId) as Record<string, unknown> | undefined;
        if (rawStreak) {
          streak = {
            ...rawStreak,
            phases: typeof rawStreak.phases === 'string'
              ? JSON.parse(rawStreak.phases || '[]')
              : rawStreak.phases,
          } as FailureStreak;

          // Fetch tickets for phases
          const ticketIds = streak.phases
            .map((p) => p.ticket_id)
            .filter((id): id is string => id !== null);
          if (ticketIds.length > 0) {
            const tickets = getTicketsByIdsStmt(ticketIds);
            for (const t of tickets) {
              phaseTickets.set(t.id, t);
            }
          }
        }
      }

      switch (activity.activity_type) {
        case 'streak_detected':
          blocks = streak
            ? buildStreakDetectedBlocks(activity, streak, phaseTickets)
            : buildSlackBlocks(activity, ticket, build);
          break;
        case 'streak_phase_change':
          blocks = streak
            ? buildStreakPhaseChangeBlocks(activity, streak, phaseTickets)
            : buildSlackBlocks(activity, ticket, build);
          break;
        case 'signature_cleared':
          blocks = buildSignatureClearedBlocks(activity, streak, ticket, build);
          break;
        case 'streak_resolved':
          blocks = streak
            ? buildStreakResolvedBlocks(activity, streak, phaseTickets)
            : buildSlackBlocks(activity, ticket, build);
          break;
        default:
          blocks = buildSlackBlocks(activity, ticket, build);
      }
    } else {
      blocks = buildSlackBlocks(activity, ticket, build);
    }

    // Send to Slack
    const slackResult = await sendSlackNotification(SLACK_WEBHOOK_URL, SLACK_CHANNEL, blocks);

    if (!slackResult.ok) {
      throw new Error(`Slack notification failed: ${slackResult.error}`);
    }

    // Record notification_sent activity
    const now = new Date().toISOString();
    const notificationMetadata: Record<string, unknown> = {
      channel: SLACK_CHANNEL,
      ts: slackResult.ts,
      source_activity_id: activityId,
      source_activity_type: activity.activity_type,
    };
    if (streakId) {
      notificationMetadata.streak_id = streakId;
    }

    insertActivityStmt.run(
      uuidv4(),
      `Slack notification sent for: ${activity.title.substring(0, 100)}`,
      `Notification delivered to ${SLACK_CHANNEL}`,
      activity.ticket_id,
      activity.build_id,
      JSON.stringify(notificationMetadata),
      now,
    );

    updateAgentRunStmt.run(
      1,
      JSON.stringify({
        channel: SLACK_CHANNEL,
        ts: slackResult.ts,
        activity_type: activity.activity_type,
        streak_id: streakId,
      }),
      Date.now() - startTime,
      null,
      runId,
    );

    return {
      success: true,
      message: `Notification sent to ${SLACK_CHANNEL}`,
      channel: SLACK_CHANNEL,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAgentRunStmt.run(0, null, Date.now() - startTime, message, runId);
    return { success: false, message };
  }
}
