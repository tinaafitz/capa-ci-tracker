// morning-digest.ts -- CronJob that posts a daily CI summary to Slack.
// Runs at 9 AM ET (13:00 UTC) on weekdays via OpenShift CronJob.
//
// Queries overnight builds, active streaks, new tickets, and
// signature-cleared events, then posts a single Slack Block Kit message.
//
// Usage:
//   node --import tsx jobs/morning-digest.ts

import { pool, query, log, recordAgentRun } from './db.js';

// ============================================================
// Environment
// ============================================================

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL ?? '#capa-ci-alerts';

// ============================================================
// Types
// ============================================================

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text?: string | { type: string; text: string }; url?: string }>;
  fields?: Array<{ type: string; text: string }>;
}

interface OvernightBuild {
  id: string;
  source: string;
  external_id: string;
  job_name: string;
  job_url: string | null;
  status: string;
  pass_count: number;
  fail_count: number;
  total_count: number;
  started_at: string;
}

interface ActiveStreak {
  id: string;
  job_name: string;
  source: string;
  streak_length: number;
  phase_count: number;
  phases: StreakPhase[];
  started_at: string;
}

interface StreakPhase {
  phase_number: number;
  error_signature: string | null;
  build_count: number;
  ticket_id: string | null;
  fix_pr_url: string | null;
  fix_verified: boolean;
  summary: string | null;
}

interface NewTicket {
  id: string;
  ticket_number: number;
  title: string;
  status: string;
  severity: string;
  assignee: string | null;
}

interface SignatureClearedEvent {
  id: string;
  ticket_number: number;
  title: string;
  fix_pr_url: string | null;
  fix_pr_number: number | null;
  created_at: string;
}

interface OverallStats {
  total_builds: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
}

// ============================================================
// Queries
// ============================================================

async function fetchOvernightBuilds(): Promise<OvernightBuild[]> {
  const res = await query(
    `SELECT id, source, external_id, job_name, job_url,
            status::text AS status, pass_count, fail_count, total_count, started_at
     FROM builds
     WHERE started_at > now() - INTERVAL '18 hours'
     ORDER BY started_at DESC`,
  );
  return res.rows;
}

async function fetchActiveStreaks(): Promise<ActiveStreak[]> {
  const res = await query(
    `SELECT id, job_name, source, streak_length, phase_count, phases, started_at
     FROM failure_streaks
     WHERE status = 'active'
     ORDER BY streak_length DESC`,
  );
  return res.rows;
}

async function fetchNewTickets(): Promise<NewTicket[]> {
  const res = await query(
    `SELECT id, ticket_number, title, status::text AS status, severity::text AS severity, assignee
     FROM support_tickets
     WHERE status IN ('new', 'investigating')
       AND created_at > now() - INTERVAL '24 hours'
     ORDER BY created_at DESC`,
  );
  return res.rows;
}

async function fetchSignatureClearedEvents(): Promise<SignatureClearedEvent[]> {
  const res = await query(
    `SELECT a.id, t.ticket_number, t.title, t.fix_pr_url, t.fix_pr_number, a.created_at
     FROM activities a
     JOIN support_tickets t ON a.ticket_id = t.id
     WHERE a.activity_type = 'signature_cleared'
       AND a.created_at > now() - INTERVAL '24 hours'
     ORDER BY a.created_at DESC`,
  );
  return res.rows;
}

async function fetchOverallStats(): Promise<OverallStats> {
  const res = await query(
    `SELECT
       COUNT(*)::int AS total_builds,
       COUNT(*) FILTER (WHERE status = 'success')::int AS pass_count,
       COUNT(*) FILTER (WHERE status = 'failure')::int AS fail_count
     FROM builds
     WHERE started_at > now() - INTERVAL '24 hours'`,
  );
  const row = res.rows[0];
  const total = row.total_builds || 0;
  return {
    total_builds: total,
    pass_count: row.pass_count || 0,
    fail_count: row.fail_count || 0,
    pass_rate: total > 0 ? Math.round((row.pass_count / total) * 100) : 0,
  };
}

// ============================================================
// Streak phase enrichment: look up ticket info for each phase
// ============================================================

interface EnrichedPhase extends StreakPhase {
  ticket_number: number | null;
  ticket_title: string | null;
  ticket_status: string | null;
}

async function enrichStreakPhases(phases: StreakPhase[]): Promise<EnrichedPhase[]> {
  const enriched: EnrichedPhase[] = [];
  for (const phase of phases) {
    let ticketNumber: number | null = null;
    let ticketTitle: string | null = null;
    let ticketStatus: string | null = null;

    if (phase.ticket_id) {
      const res = await query(
        `SELECT ticket_number, title, status::text AS status FROM support_tickets WHERE id = $1`,
        [phase.ticket_id],
      );
      if (res.rows.length > 0) {
        ticketNumber = res.rows[0].ticket_number;
        ticketTitle = res.rows[0].title;
        ticketStatus = res.rows[0].status;
      }
    }

    enriched.push({
      ...phase,
      ticket_number: ticketNumber,
      ticket_title: ticketTitle,
      ticket_status: ticketStatus,
    });
  }
  return enriched;
}

// ============================================================
// Slack Block Kit message builder
// ============================================================

function formatDate(): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  return `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()}`;
}

function buildBuildLine(b: OvernightBuild): string {
  const icon = b.status === 'success' ? ':white_check_mark:' : ':x:';
  const statusText = b.status.toUpperCase();
  const testInfo = `${b.pass_count}/${b.total_count} tests`;
  const link = b.job_url ? `<${b.job_url}|View>` : '';
  // Truncate job_name if very long
  const jobDisplay = b.job_name.length > 30 ? b.job_name.slice(0, 28) + '..' : b.job_name;
  return `${icon} \`${jobDisplay}\` (${b.source})    ${statusText}   ${testInfo}   ${link}`;
}

function buildPhaseLabel(phase: EnrichedPhase): string {
  const sigDisplay = phase.summary
    ?? phase.error_signature?.split('::').pop()?.slice(0, 16)
    ?? 'unknown';

  let ticketRef = '';
  if (phase.ticket_number) {
    ticketRef = ` -- CAPA-${phase.ticket_number}`;
  }

  let verifyIcon = '';
  if (phase.fix_verified) {
    verifyIcon = ' -- :white_check_mark: signature cleared';
  } else if (phase.ticket_status === 'investigating' || phase.ticket_status === 'new') {
    verifyIcon = ' -- :mag: ' + (phase.ticket_status ?? '');
  } else if (phase.ticket_status === 'fix_in_progress' || phase.ticket_status === 'resolved') {
    verifyIcon = ' -- :wrench: ' + (phase.ticket_status?.replace(/_/g, ' ') ?? '');
  }

  return `  Phase ${phase.phase_number}: ${sigDisplay}${ticketRef}${verifyIcon}`;
}

async function buildDigestBlocks(
  builds: OvernightBuild[],
  streaks: ActiveStreak[],
  newTickets: NewTicket[],
  clearedEvents: SignatureClearedEvent[],
  stats: OverallStats,
): Promise<SlackBlock[]> {
  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `:wrench: CI Status -- ${formatDate()}`,
      emoji: true,
    },
  });

  // Stats context
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `${stats.total_builds} builds last 24h | ${stats.pass_rate}% pass rate | ${stats.fail_count} failures`,
    }],
  });

  blocks.push({ type: 'divider' });

  // ---- OVERNIGHT BUILDS ----
  if (builds.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*OVERNIGHT BUILDS*',
      },
    });

    // Group by job_name, show most recent per job
    const seenJobs = new Set<string>();
    const buildLines: string[] = [];
    for (const b of builds) {
      const key = `${b.source}:${b.job_name}`;
      if (seenJobs.has(key)) continue;
      seenJobs.add(key);
      buildLines.push(buildBuildLine(b));
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildLines.join('\n'),
      },
    });

    blocks.push({ type: 'divider' });
  }

  // ---- ACTIVE STREAKS ----
  if (streaks.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*ACTIVE STREAKS (${streaks.length})*`,
      },
    });

    for (const streak of streaks) {
      const dayCount = Math.ceil(
        (Date.now() - new Date(streak.started_at).getTime()) / (1000 * 60 * 60 * 24),
      );
      const enrichedPhases = await enrichStreakPhases(streak.phases ?? []);

      let streakText = `:warning: \`${streak.job_name}\`: ${dayCount} days, ${streak.phase_count} phase${streak.phase_count !== 1 ? 's' : ''}`;

      for (const phase of enrichedPhases) {
        streakText += '\n' + buildPhaseLabel(phase);
      }

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: streakText,
        },
      });
    }

    blocks.push({ type: 'divider' });
  }

  // ---- NEEDS ATTENTION ----
  if (newTickets.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*NEEDS ATTENTION (${newTickets.length})*`,
      },
    });

    const ticketLines = newTickets.map(t => {
      const assigneeText = t.assignee ?? 'unassigned';
      // Truncate title for readability
      const titleDisplay = t.title.length > 50 ? t.title.slice(0, 48) + '..' : t.title;
      return `*CAPA-${t.ticket_number}* (${t.status}) -- ${titleDisplay} -- ${assigneeText}`;
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ticketLines.join('\n'),
      },
    });

    blocks.push({ type: 'divider' });
  }

  // ---- GOOD NEWS ----
  if (clearedEvents.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*GOOD NEWS*',
      },
    });

    const goodLines = clearedEvents.map(e => {
      const prRef = e.fix_pr_number ? ` (fix PR #${e.fix_pr_number} working)` : '';
      const titleDisplay = e.title.length > 50 ? e.title.slice(0, 48) + '..' : e.title;
      return `:white_check_mark: CAPA-${e.ticket_number}: ${titleDisplay} no longer appears${prRef}`;
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: goodLines.join('\n'),
      },
    });
  }

  // If no streaks, no tickets, and no cleared events -- keep it simple
  if (streaks.length === 0 && newTickets.length === 0 && clearedEvents.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':tada: All clear! No active failure streaks, no new tickets, and no pending issues.',
      },
    });
  }

  return blocks;
}

// ============================================================
// Slack posting
// ============================================================

async function postToSlack(blocks: SlackBlock[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    log('WARN', 'morning-digest', 'SLACK_WEBHOOK_URL not set, skipping notification');
    return;
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: SLACK_CHANNEL,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack API error: ${response.status} ${body}`);
  }

  log('INFO', 'morning-digest', `Slack digest posted to ${SLACK_CHANNEL}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const startTime = Date.now();
  log('INFO', 'morning-digest', 'Starting morning CI digest');

  try {
    // 1. Query overnight builds first -- if none, skip posting (weekend/holiday)
    const builds = await fetchOvernightBuilds();

    if (builds.length === 0) {
      log('INFO', 'morning-digest', 'No builds in the last 18 hours, skipping digest (likely weekend)');

      await recordAgentRun({
        agentName: 'morning-digest',
        trigger: 'cron',
        inputPayload: {},
        outputPayload: { skipped: true, reason: 'no_builds_18h' },
        success: true,
        durationMs: Date.now() - startTime,
      });

      await pool.end();
      process.exit(0);
    }

    // 2. Run remaining queries in parallel
    const [streaks, newTickets, clearedEvents, stats] = await Promise.all([
      fetchActiveStreaks(),
      fetchNewTickets(),
      fetchSignatureClearedEvents(),
      fetchOverallStats(),
    ]);

    log('INFO', 'morning-digest', 'Data fetched', {
      builds: builds.length,
      activeStreaks: streaks.length,
      newTickets: newTickets.length,
      clearedEvents: clearedEvents.length,
      stats,
    });

    // 3. Build the Slack message
    const blocks = await buildDigestBlocks(builds, streaks, newTickets, clearedEvents, stats);

    // 4. Post to Slack
    await postToSlack(blocks);

    // 5. Record success
    await recordAgentRun({
      agentName: 'morning-digest',
      trigger: 'cron',
      inputPayload: {},
      outputPayload: {
        builds_reported: builds.length,
        active_streaks: streaks.length,
        new_tickets: newTickets.length,
        cleared_events: clearedEvents.length,
        stats,
      },
      success: true,
      durationMs: Date.now() - startTime,
    });

    log('INFO', 'morning-digest', `Job finished in ${Date.now() - startTime}ms`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    const errorMessage = (err as Error).message;
    log('ERROR', 'morning-digest', `Fatal error: ${errorMessage}`);

    await recordAgentRun({
      agentName: 'morning-digest',
      trigger: 'cron',
      inputPayload: {},
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
