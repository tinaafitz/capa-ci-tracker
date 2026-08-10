// notify -- Edge Function
// Triggered by pg_notify('new_activity', ...) when an activity is inserted.
// Reads the activity and joined ticket/build context, then sends a Slack
// Block Kit message via webhook. Records notification_sent activity.

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

    // Build Slack blocks
    const blocks = buildSlackBlocks(activity, ticket, build);

    // Send to Slack
    const slackResult = await sendSlackNotification(blocks);

    if (!slackResult.ok) {
      throw new Error(
        `Slack notification failed: ${slackResult.error}`
      );
    }

    // Record notification_sent activity
    await supabase.from("activities").insert({
      activity_type: "notification_sent",
      title: `Slack notification sent for: ${activity.title.substring(0, 100)}`,
      description: `Notification delivered to ${SLACK_CHANNEL}`,
      ticket_id: activity.ticket_id,
      build_id: activity.build_id,
      actor: "notify-agent",
      metadata: {
        channel: SLACK_CHANNEL,
        ts: slackResult.ts,
        source_activity_id: activityId,
        source_activity_type: activity.activity_type,
      },
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
