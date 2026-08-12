// notify -- Edge Function
// Triggered by pg_notify('new_activity', ...) when an activity is inserted.
// Reads the activity and joined ticket/build context, then sends a Slack
// Block Kit message via webhook. Records notification_sent activity.
//
// Supports streak event notifications (streak_detected, streak_phase_change,
// signature_cleared, streak_resolved) with enriched Block Kit messages that
// include streak context, phase details, and linked tickets.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")!;
const SLACK_CHANNEL = Deno.env.get("SLACK_CHANNEL") || "#capa-ci-alerts";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Activity types that should trigger Slack notifications
const NOTIFIABLE_TYPES = new Set([
  "build_completed",
  "ticket_created",
  "ticket_updated",
  "diagnosis_completed",
  "fix_merged",
  // Streak event types
  "streak_detected",
  "streak_phase_change",
  "signature_cleared",
  "streak_resolved",
]);

// Streak activity types that require throttle checking
const STREAK_TYPES = new Set([
  "streak_detected",
  "streak_phase_change",
  "signature_cleared",
  "streak_resolved",
]);

// Severity color mapping for Slack
const SEVERITY_COLORS: Record<string, string> = {
  nightly_blocker: "#dc2626", // red
  upstream_breakage: "#ea580c", // orange
  test_regression: "#eab308", // yellow
  infrastructure: "#6366f1", // indigo
  flaky: "#8b5cf6", // violet
};

// Status emoji mapping
const STATUS_EMOJI: Record<string, string> = {
  new: ":new:",
  investigating: ":mag:",
  root_caused: ":dart:",
  fix_in_progress: ":wrench:",
  resolved: ":white_check_mark:",
  verified: ":heavy_check_mark:",
};

// Streak status emoji mapping
const STREAK_STATUS_EMOJI: Record<string, string> = {
  active: ":rotating_light:",
  partial_fix: ":construction:",
  resolved: ":tada:",
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
  status: string;
  phases: StreakPhase[];
  analysis_summary: string | null;
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
// Throttle check: prevent duplicate notifications for the same
// streak_id + activity_type within 12 hours
// ============================================================

async function isThrottled(
  streakId: string,
  activityType: string
): Promise<boolean> {
  const twelveHoursAgo = new Date(
    Date.now() - 12 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("activities")
    .select("id")
    .eq("activity_type", "notification_sent")
    .gte("created_at", twelveHoursAgo)
    .filter(
      "metadata->>source_activity_type",
      "eq",
      activityType
    )
    .filter("metadata->>streak_id", "eq", streakId)
    .limit(1);

  if (error) {
    // On error, don't throttle (fail open)
    return false;
  }

  return (data?.length ?? 0) > 0;
}

// ============================================================
// Fetch streak context for streak event notifications
// ============================================================

async function fetchStreak(
  streakId: string
): Promise<FailureStreak | null> {
  const { data, error } = await supabase
    .from("failure_streaks")
    .select("*")
    .eq("id", streakId)
    .single();

  if (error || !data) return null;
  return data as FailureStreak;
}

// Fetch ticket info for phase-linked tickets
async function fetchPhaseTickets(
  phases: StreakPhase[]
): Promise<Map<string, Ticket>> {
  const ticketIds = phases
    .map((p) => p.ticket_id)
    .filter((id): id is string => id !== null);

  if (ticketIds.length === 0) return new Map();

  const { data } = await supabase
    .from("support_tickets")
    .select(
      "id, ticket_number, title, status, severity, assignee, error_signature, root_cause, fix_pr_url"
    )
    .in("id", ticketIds);

  const map = new Map<string, Ticket>();
  if (data) {
    for (const t of data) {
      map.set(t.id, t as Ticket);
    }
  }
  return map;
}

// ============================================================
// Formatting helpers
// ============================================================

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function truncateSignature(sig: string | null, maxLen = 40): string {
  if (!sig) return "(unknown)";
  if (sig.length <= maxLen) return sig;
  return sig.substring(0, maxLen) + "...";
}

// ============================================================
// Streak-aware Block Kit builders
// ============================================================

function buildStreakDetectedBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const statusEmoji = STREAK_STATUS_EMOJI[streak.status] || ":warning:";

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `${statusEmoji} Failure Streak Detected`,
      emoji: true,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${streak.job_name}* has failed *${streak.streak_length} consecutive builds* since ${formatDate(streak.started_at)}. *${streak.phase_count} distinct error phase(s)*.`,
    },
  });

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Duration:* ${streak.streak_length} builds over ${formatDuration(streak.started_at, streak.ended_at)}`,
      },
      {
        type: "mrkdwn",
        text: `*Source:* ${streak.source}`,
      },
    ],
  });

  // Phase details
  if (streak.phases.length > 0) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id
        ? phaseTickets.get(phase.ticket_id)
        : null;
      const ticketRef = ticket
        ? `CAPA-${ticket.ticket_number} (${STATUS_EMOJI[ticket.status] || ""} ${ticket.status})`
        : "no ticket";
      const verified = phase.fix_verified ? " :white_check_mark: verified" : "";
      const prRef = phase.fix_pr_url
        ? ` | <${phase.fix_pr_url}|PR>`
        : "";
      return `  Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${prRef}${verified}`;
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Phases:*\n${phaseLines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `streak_detected | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
      },
    ],
  });

  blocks.push({ type: "divider" });
  return blocks;
}

function buildStreakPhaseChangeBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: ":rotating_light: Streak Phase Change",
      emoji: true,
    },
  });

  // Identify the new phase from metadata or from the latest phase in the streak
  const newPhaseNumber =
    (activity.metadata?.new_phase_number as number) ??
    streak.phases[streak.phases.length - 1]?.phase_number;
  const newPhase = streak.phases.find(
    (p) => p.phase_number === newPhaseNumber
  );
  const matchedPattern =
    (activity.metadata?.matched_pattern as string) ??
    newPhase?.summary ??
    null;

  let description = `*${streak.job_name}*: error signature changed.`;
  if (matchedPattern) {
    description += ` New phase: _${matchedPattern}_`;
  }
  if (newPhase) {
    description += `\n\nPhase ${newPhase.phase_number} started ${formatDate(newPhase.first_seen)} with signature: \`${truncateSignature(newPhase.error_signature, 60)}\``;
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: description,
    },
  });

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Streak Length:* ${streak.streak_length} builds`,
      },
      {
        type: "mrkdwn",
        text: `*Total Phases:* ${streak.phase_count}`,
      },
    ],
  });

  // Show all phases for context
  if (streak.phases.length > 1) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id
        ? phaseTickets.get(phase.ticket_id)
        : null;
      const ticketRef = ticket
        ? `CAPA-${ticket.ticket_number}`
        : "no ticket";
      const current = phase.phase_number === newPhaseNumber ? " :point_left: *current*" : "";
      const verified = phase.fix_verified ? " :white_check_mark:" : "";
      return `  Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${verified}${current}`;
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*All phases:*\n${phaseLines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `streak_phase_change | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
      },
    ],
  });

  blocks.push({ type: "divider" });
  return blocks;
}

function buildSignatureClearedBlocks(
  activity: Activity,
  streak: FailureStreak | null,
  ticket: Ticket | null,
  build: Build | null
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // This is the highest-value message -- emphasize that the specific error is gone
  // even though the build may still be failing
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: ":eyes: Error Signature Cleared",
      emoji: true,
    },
  });

  const errorSig = (activity.metadata?.error_signature as string) ?? null;
  const clearingBuildStatus =
    (activity.metadata?.clearing_build_status as string) ?? "unknown";

  let mainText: string;
  if (ticket) {
    const prRef = ticket.fix_pr_url
      ? ` Fix <${ticket.fix_pr_url}|PR> appears to be working`
      : "";

    if (clearingBuildStatus === "failure") {
      // The high-value case: fix is working but build still failing for a different reason
      mainText = `*CAPA-${ticket.ticket_number}'s error* (\`${truncateSignature(errorSig, 50)}\`) *no longer appears in the latest build*.${prRef ? ` ${prRef},` : ""} but the build is still failing for a different reason.`;
    } else {
      // Build is passing, even better
      mainText = `*CAPA-${ticket.ticket_number}'s error* (\`${truncateSignature(errorSig, 50)}\`) *has been resolved*.${prRef ? ` ${prRef}.` : ""} Build is now passing.`;
    }
  } else {
    mainText =
      activity.description ??
      `Error signature \`${truncateSignature(errorSig, 50)}\` no longer appears in the latest build.`;
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: mainText,
    },
  });

  // Build status callout -- emphasize the "still failing" case
  if (clearingBuildStatus === "failure" && build) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Build still failed* (${build.fail_count}/${build.total_count} tests) -- the specific error tracked by this ticket is gone, but the build has other failures.`,
      },
    });
  }

  // Ticket details if available
  if (ticket) {
    const statusEmoji = STATUS_EMOJI[ticket.status] || ":question:";
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Ticket:* CAPA-${ticket.ticket_number}`,
        },
        {
          type: "mrkdwn",
          text: `*Status:* ${statusEmoji} ${ticket.status}`,
        },
      ],
    });
  }

  // Build info
  if (build) {
    const buildLink = build.job_url
      ? `<${build.job_url}|${build.job_name} #${build.external_id}>`
      : `${build.job_name} #${build.external_id}`;
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Clearing Build:* ${buildLink}`,
        },
        {
          type: "mrkdwn",
          text: `*Build Status:* ${clearingBuildStatus}`,
        },
      ],
    });
  }

  // If there's a parent streak, show how many phases are verified
  if (streak) {
    const verifiedCount = streak.phases.filter(
      (p) => p.fix_verified
    ).length;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Streak progress:* ${verifiedCount}/${streak.phase_count} phases verified fixed (${streak.job_name}, ${streak.streak_length} builds)`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `signature_cleared | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
      },
    ],
  });

  blocks.push({ type: "divider" });
  return blocks;
}

function buildStreakResolvedBlocks(
  activity: Activity,
  streak: FailureStreak,
  phaseTickets: Map<string, Ticket>
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: ":tada: Failure Streak Resolved",
      emoji: true,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${streak.job_name}* failure streak resolved. All *${streak.phase_count} phase(s)* verified fixed.`,
    },
  });

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Duration:* ${streak.streak_length} builds over ${formatDuration(streak.started_at, streak.ended_at)}`,
      },
      {
        type: "mrkdwn",
        text: `*Period:* ${formatDate(streak.started_at)} - ${streak.ended_at ? formatDate(streak.ended_at) : "now"}`,
      },
    ],
  });

  // Phase summary with verification status
  if (streak.phases.length > 0) {
    const phaseLines = streak.phases.map((phase) => {
      const ticket = phase.ticket_id
        ? phaseTickets.get(phase.ticket_id)
        : null;
      const ticketRef = ticket
        ? `CAPA-${ticket.ticket_number}`
        : "no ticket";
      const prRef = phase.fix_pr_url
        ? ` | <${phase.fix_pr_url}|PR>`
        : "";
      return `  :white_check_mark: Phase ${phase.phase_number}: ${truncateSignature(phase.error_signature)} -- ${ticketRef}${prRef}`;
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Verified phases:*\n${phaseLines.join("\n")}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `streak_resolved | streak-analyzer | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
      },
    ],
  });

  blocks.push({ type: "divider" });
  return blocks;
}

// ============================================================
// Standard (non-streak) Block Kit builder
// ============================================================

function buildSlackBlocks(
  activity: Activity,
  ticket: Ticket | null,
  build: Build | null
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Header block
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: activity.title.substring(0, 150),
      emoji: true,
    },
  });

  // Context block with timestamp and actor
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*${activity.activity_type}* | ${activity.actor || "system"} | <!date^${Math.floor(new Date(activity.created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${activity.created_at}>`,
      },
    ],
  });

  // Description section
  if (activity.description) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: activity.description.substring(0, 2000),
      },
    });
  }

  // Ticket details section (if applicable)
  if (ticket) {
    const statusEmoji = STATUS_EMOJI[ticket.status] || ":question:";

    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Ticket:* CAPA-${ticket.ticket_number}`,
        },
        {
          type: "mrkdwn",
          text: `*Status:* ${statusEmoji} ${ticket.status}`,
        },
        {
          type: "mrkdwn",
          text: `*Severity:* ${ticket.severity.replace(/_/g, " ")}`,
        },
        {
          type: "mrkdwn",
          text: `*Assignee:* ${ticket.assignee || "unassigned"}`,
        },
      ],
    });

    if (ticket.root_cause) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Root Cause:* ${ticket.root_cause}`,
        },
      });
    }

    if (ticket.fix_pr_url) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Fix PR:* <${ticket.fix_pr_url}|View PR>`,
        },
      });
    }
  }

  // Build details section (if applicable)
  if (build) {
    const buildLink = build.job_url
      ? `<${build.job_url}|${build.job_name} #${build.external_id}>`
      : `${build.job_name} #${build.external_id}`;

    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Build:* ${buildLink}`,
        },
        {
          type: "mrkdwn",
          text: `*Source:* ${build.source}`,
        },
        {
          type: "mrkdwn",
          text: `*Tests Failed:* ${build.fail_count}/${build.total_count}`,
        },
        {
          type: "mrkdwn",
          text: `*OCP:* ${build.ocp_version || "n/a"}`,
        },
      ],
    });
  }

  // Divider
  blocks.push({ type: "divider" });

  return blocks;
}

async function sendSlackNotification(
  blocks: SlackBlock[]
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: SLACK_CHANNEL,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: `Slack API error: ${response.status} ${body}` };
  }

  // Incoming webhooks return "ok" as text, not JSON
  const body = await response.text();
  if (body === "ok") {
    return { ok: true, ts: new Date().toISOString() };
  }

  // If it is a JSON response (chat.postMessage style), parse it
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

async function resolveStreakId(activity: Activity): Promise<string | null> {
  // Check metadata first (streak_detected, streak_resolved provide it directly)
  if (activity.metadata?.streak_id) {
    return activity.metadata.streak_id as string;
  }

  // For signature_cleared, the streak_id is on the linked ticket
  if (activity.ticket_id) {
    const { data } = await supabase
      .from("support_tickets")
      .select("streak_id")
      .eq("id", activity.ticket_id)
      .single();
    if (data?.streak_id) {
      return data.streak_id as string;
    }
  }

  return null;
}

serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const activityId: string =
      body.activity_id || body.record?.id;

    if (!activityId) {
      return new Response(
        JSON.stringify({ error: "activity_id is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch the activity
    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .select("*")
      .eq("id", activityId)
      .single();

    if (activityError || !activity) {
      throw new Error(
        `Activity not found: ${activityId} -- ${activityError?.message}`
      );
    }

    // Skip non-notifiable activity types
    if (!NOTIFIABLE_TYPES.has(activity.activity_type)) {
      await supabase.from("agent_runs").insert({
        agent_name: "notify",
        trigger: "pg_notify",
        input_payload: { activity_id: activityId },
        output_payload: {
          skipped: true,
          reason: `Activity type '${activity.activity_type}' is not notifiable`,
        },
        success: true,
        duration_ms: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "non-notifiable activity type",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Skip notification_sent activities to prevent infinite loops
    if (activity.activity_type === "notification_sent") {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "notification_sent loop prevention" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Skip dedup activities (recurring failure links) to avoid noise
    if (activity.metadata?.dedup === true) {
      await supabase.from("agent_runs").insert({
        agent_name: "notify",
        trigger: "pg_notify",
        input_payload: { activity_id: activityId },
        output_payload: { skipped: true, reason: "dedup activity" },
        success: true,
        duration_ms: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "dedup" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Streak throttle check: don't send duplicate notifications for
    // the same streak_id + activity_type within 12 hours
    // ============================================================

    let streakId: string | null = null;

    if (STREAK_TYPES.has(activity.activity_type)) {
      streakId = await resolveStreakId(activity);

      if (streakId) {
        const throttled = await isThrottled(streakId, activity.activity_type);
        if (throttled) {
          await supabase.from("agent_runs").insert({
            agent_name: "notify",
            trigger: "pg_notify",
            input_payload: { activity_id: activityId },
            output_payload: {
              skipped: true,
              reason: `Throttled: ${activity.activity_type} for streak ${streakId} already notified within 12h`,
            },
            success: true,
            duration_ms: Date.now() - startTime,
          });

          return new Response(
            JSON.stringify({
              success: true,
              skipped: true,
              reason: "throttled",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    // Fetch related ticket and build for context
    let ticket: Ticket | null = null;
    let build: Build | null = null;

    if (activity.ticket_id) {
      const { data } = await supabase
        .from("support_tickets")
        .select(
          "id, ticket_number, title, status, severity, assignee, error_signature, root_cause, fix_pr_url"
        )
        .eq("id", activity.ticket_id)
        .single();
      ticket = data as Ticket | null;
    }

    if (activity.build_id) {
      const { data } = await supabase
        .from("builds")
        .select(
          "id, source, external_id, job_name, job_url, status, fail_count, total_count, ocp_version"
        )
        .eq("id", activity.build_id)
        .single();
      build = data as Build | null;
    }

    // ============================================================
    // Build Slack blocks -- use streak-specific builders for streak
    // activity types, standard builder for everything else
    // ============================================================

    let blocks: SlackBlock[];

    if (STREAK_TYPES.has(activity.activity_type)) {
      // Fetch streak context (streakId was resolved above for throttle check)
      let streak: FailureStreak | null = null;
      let phaseTickets: Map<string, Ticket> = new Map();

      if (streakId) {
        streak = await fetchStreak(streakId);
        if (streak) {
          phaseTickets = await fetchPhaseTickets(streak.phases);
        }
      }

      switch (activity.activity_type) {
        case "streak_detected":
          if (streak) {
            blocks = buildStreakDetectedBlocks(
              activity,
              streak,
              phaseTickets
            );
          } else {
            // Fallback: streak not found, use standard builder
            blocks = buildSlackBlocks(activity, ticket, build);
          }
          break;

        case "streak_phase_change":
          if (streak) {
            blocks = buildStreakPhaseChangeBlocks(
              activity,
              streak,
              phaseTickets
            );
          } else {
            blocks = buildSlackBlocks(activity, ticket, build);
          }
          break;

        case "signature_cleared":
          // signature_cleared always has ticket context; streak is optional
          blocks = buildSignatureClearedBlocks(
            activity,
            streak,
            ticket,
            build
          );
          break;

        case "streak_resolved":
          if (streak) {
            blocks = buildStreakResolvedBlocks(
              activity,
              streak,
              phaseTickets
            );
          } else {
            blocks = buildSlackBlocks(activity, ticket, build);
          }
          break;

        default:
          blocks = buildSlackBlocks(activity, ticket, build);
      }
    } else {
      blocks = buildSlackBlocks(activity, ticket, build);
    }

    // Send to Slack
    const slackResult = await sendSlackNotification(blocks);

    if (!slackResult.ok) {
      throw new Error(
        `Slack notification failed: ${slackResult.error}`
      );
    }

    // Record notification_sent activity
    // Include streak_id in metadata for throttle checks on subsequent runs
    const notificationMetadata: Record<string, unknown> = {
      channel: SLACK_CHANNEL,
      ts: slackResult.ts,
      source_activity_id: activityId,
      source_activity_type: activity.activity_type,
    };
    if (streakId) {
      notificationMetadata.streak_id = streakId;
    }

    await supabase.from("activities").insert({
      activity_type: "notification_sent",
      title: `Slack notification sent for: ${activity.title.substring(0, 100)}`,
      description: `Notification delivered to ${SLACK_CHANNEL}`,
      ticket_id: activity.ticket_id,
      build_id: activity.build_id,
      actor: "notify-agent",
      metadata: notificationMetadata,
    });

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "notify",
      trigger: "pg_notify",
      input_payload: { activity_id: activityId },
      output_payload: {
        channel: SLACK_CHANNEL,
        ts: slackResult.ts,
        activity_type: activity.activity_type,
        streak_id: streakId,
      },
      success: true,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({
        success: true,
        channel: SLACK_CHANNEL,
        ts: slackResult.ts,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMessage = (err as Error).message;

    await supabase.from("agent_runs").insert({
      agent_name: "notify",
      trigger: "pg_notify",
      input_payload: null,
      output_payload: null,
      success: false,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
