// triage -- Edge Function
// Triggered by pg_notify('build_failure', ...) when a failed build is inserted.
// Computes error_signature, deduplicates against open tickets using advisory locks,
// creates new tickets with auto-severity classification, and invokes diagnosis.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  test_failures: TestFailure[];
  started_at: string | null;
}

// ============================================================
// Error Signature Computation
// Normalizes the first test failure to produce a stable fingerprint.
// ============================================================

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeSignature(testFailures: TestFailure[]): Promise<string> {
  if (!testFailures || testFailures.length === 0) return "unknown";
  const f = testFailures[0];
  if (!f.errorMessage) return `${f.className || "unknown"}::${f.name || "unknown"}::no-error-message`;

  // Normalize: strip UUIDs, hex addresses, timestamps, line numbers
  const normalized = f.errorMessage
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<UUID>"
    )
    .replace(/0x[0-9a-fA-F]+/g, "<ADDR>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "<TS>")
    .replace(/:\d+/g, ":<N>")
    .trim();

  const hash = await sha256Hex(normalized);
  return `${f.className || "unknown"}::${f.name || "unknown"}::${hash.substring(0, 16)}`;
}

// ============================================================
// Auto-Severity Classification
// ============================================================

function classifySeverity(
  build: Build,
  testFailures: TestFailure[]
): string {
  const jobName = build.job_name.toLowerCase();

  // nightly_blocker: nightly job OR all tests failed
  if (
    jobName.includes("nightly") ||
    (build.total_count > 0 && build.fail_count === build.total_count)
  ) {
    return "nightly_blocker";
  }

  // upstream_breakage: CAPI/OCP version patterns in error messages
  const errorText = testFailures
    .map((f) => f.errorMessage)
    .join(" ")
    .toLowerCase();
  if (
    /capi.*v1beta[12]|apigroup.*migration|cluster\.x-k8s\.io.*v1beta/.test(
      errorText
    ) ||
    /ocp.*\d+\.\d+.*incompatible|openshift.*version.*mismatch/.test(errorText)
  ) {
    return "upstream_breakage";
  }

  // infrastructure: timeout/VPC/IAM patterns
  if (
    /timeout|timed?\s*out|vpc.*not found|subnet.*invalid|access.denied|iam.*error|quota.*exceed/i.test(
      errorText
    )
  ) {
    return "infrastructure";
  }

  // flaky: check if the same test alternates pass/fail in recent builds
  // (This is a simplified heuristic -- full flaky detection would query
  // historical builds, but we do a basic check here)
  if (
    build.pass_count > 0 &&
    build.fail_count > 0 &&
    build.fail_count <= 2
  ) {
    return "flaky";
  }

  // Default: test_regression
  return "test_regression";
}

// ============================================================
// Default Tasks for New Tickets
// ============================================================

const DEFAULT_TASKS = [
  { title: "Investigate logs", sort_order: 1 },
  { title: "Identify root cause", sort_order: 2 },
  { title: "Submit fix PR", sort_order: 3 },
  { title: "Verify in next nightly", sort_order: 4 },
];

// ============================================================
// Main Triage Logic
// ============================================================

async function triageBuild(buildId: string): Promise<{
  action: "linked" | "created" | "skipped";
  ticketId?: string;
  ticketNumber?: number;
  errorSignature?: string;
}> {
  // 1. Fetch the build
  const { data: build, error: buildError } = await supabase
    .from("builds")
    .select("*")
    .eq("id", buildId)
    .single();

  if (buildError || !build) {
    throw new Error(`Build not found: ${buildId} -- ${buildError?.message}`);
  }

  if (build.status !== "failure") {
    return { action: "skipped" };
  }

  const testFailures: TestFailure[] = build.test_failures || [];
  const errorSignature = await computeSignature(testFailures);

  // 2. Advisory lock + dedup check via RPC
  // We use a raw SQL query to get the advisory lock and perform the dedup
  // check atomically within a single transaction.
  const { data: existingTicket } = await supabase.rpc("dedup_triage_check", {
    p_error_signature: errorSignature,
  });

  // If an existing open ticket was found, link this build to it
  if (existingTicket && existingTicket.length > 0 && existingTicket[0].id) {
    const existing = existingTicket[0];

    // Link build to existing ticket via activity
    await supabase.from("activities").insert({
      activity_type: "build_completed",
      title: `Recurring failure linked to ticket #${existing.ticket_number}`,
      description: `Build ${build.job_name} #${build.external_id} failed with same error signature. Linked to existing ticket.`,
      ticket_id: existing.id,
      build_id: build.id,
      actor: "triage-agent",
      metadata: {
        dedup: true,
        error_signature: errorSignature,
      },
    });

    return {
      action: "linked",
      ticketId: existing.id,
      ticketNumber: existing.ticket_number,
      errorSignature,
    };
  }

  // 3. No existing ticket -- create a new one
  const severity = classifySeverity(build, testFailures);
  const firstFailure = testFailures[0];
  const title = firstFailure
    ? `${firstFailure.className || build.job_name}: ${firstFailure.name || "test failure"}`
    : `${build.job_name} build #${build.external_id} failed`;
  const description = firstFailure
    ? `**Error:** ${firstFailure.errorMessage?.substring(0, 500) || "No error message"}\n\n**Job:** ${build.job_name}\n**Build:** #${build.external_id}\n**OCP Version:** ${build.ocp_version || "unknown"}\n**Failed Tests:** ${build.fail_count}/${build.total_count}`
    : `Build ${build.job_name} #${build.external_id} failed. ${build.fail_count} test failures out of ${build.total_count} total.`;

  const { data: newTicket, error: ticketError } = await supabase
    .from("support_tickets")
    .insert({
      title,
      description,
      status: "new",
      severity,
      build_id: build.id,
      error_signature: errorSignature,
      labels: [
        build.source,
        build.ocp_version ? `ocp-${build.ocp_version}` : null,
      ].filter(Boolean),
    })
    .select("id, ticket_number")
    .single();

  if (ticketError || !newTicket) {
    throw new Error(
      `Failed to create ticket: ${ticketError?.message}`
    );
  }

  // 4. Create default tasks
  const taskInserts = DEFAULT_TASKS.map((task) => ({
    ticket_id: newTicket.id,
    title: task.title,
    sort_order: task.sort_order,
  }));

  await supabase.from("tasks").insert(taskInserts);

  // 5. Insert ticket_created activity
  await supabase.from("activities").insert({
    activity_type: "ticket_created",
    title: `Ticket #${newTicket.ticket_number} created: ${title}`,
    description: `Auto-created by triage agent. Severity: ${severity}. Error signature: ${errorSignature}`,
    ticket_id: newTicket.id,
    build_id: build.id,
    actor: "triage-agent",
    metadata: {
      severity,
      error_signature: errorSignature,
      auto_created: true,
    },
  });

  // 6. Invoke diagnosis agent
  try {
    const diagnosisUrl = `${SUPABASE_URL}/functions/v1/diagnosis`;
    await fetch(diagnosisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket_id: newTicket.id,
        build_id: build.id,
      }),
    });
  } catch (err) {
    // Log but do not fail the triage -- diagnosis is best-effort
    console.error(`Failed to invoke diagnosis: ${(err as Error).message}`);
  }

  return {
    action: "created",
    ticketId: newTicket.id,
    ticketNumber: newTicket.ticket_number,
    errorSignature,
  };
}

serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const buildId: string = body.build_id || body.record?.id;

    if (!buildId) {
      return new Response(
        JSON.stringify({ error: "build_id is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await triageBuild(buildId);

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "triage",
      trigger: "pg_notify",
      input_payload: { build_id: buildId },
      output_payload: result,
      success: true,
      duration_ms: Date.now() - startTime,
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = (err as Error).message;

    await supabase.from("agent_runs").insert({
      agent_name: "triage",
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
