// resolution-tracker -- Edge Function
// Triggered by pg_cron every 15 minutes.
// Finds tickets with status='fix_in_progress' and fix_pr_url set,
// checks GitHub API for PR merge status, and advances ticket status on merge.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_PAT")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface GitHubPR {
  state: string;
  merged: boolean;
  merged_at: string | null;
  html_url: string;
  title: string;
  number: number;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  user: {
    login: string;
  };
}

interface TrackedTicket {
  id: string;
  ticket_number: number;
  title: string;
  fix_pr_url: string;
  fix_pr_number: number | null;
  status: string;
  error_signature: string | null;
}

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number.
 * Handles URLs like:
 *   https://github.com/stolostron/rosa-hcp-e2e-test/pull/123
 *   https://github.com/openshift/cluster-api-provider-aws/pull/456
 */
function parseGitHubPrUrl(
  url: string
): { owner: string; repo: string; number: number } | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: parseInt(match[3], 10),
  };
}

async function checkPrStatus(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubPR> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText} for ${url}`
    );
  }

  return (await response.json()) as GitHubPR;
}

serve(async (_req: Request) => {
  const startTime = Date.now();
  let resolved = 0;
  let checked = 0;
  const errors: string[] = [];

  try {
    // Find tickets with fix_in_progress status and a PR URL
    const { data: tickets, error: queryError } = await supabase
      .from("support_tickets")
      .select(
        "id, ticket_number, title, fix_pr_url, fix_pr_number, status, error_signature"
      )
      .eq("status", "fix_in_progress")
      .not("fix_pr_url", "is", null);

    if (queryError) {
      throw new Error(`Failed to query tickets: ${queryError.message}`);
    }

    // Note: even if no fix_in_progress tickets are found, we still
    // proceed to Phase 2 (resolved -> verified check) below.

    for (const ticket of (tickets || []) as TrackedTicket[]) {
      checked++;

      try {
        const parsed = parseGitHubPrUrl(ticket.fix_pr_url);
        if (!parsed) {
          errors.push(
            `Ticket #${ticket.ticket_number}: invalid PR URL "${ticket.fix_pr_url}"`
          );
          continue;
        }

        const pr = await checkPrStatus(
          parsed.owner,
          parsed.repo,
          parsed.number
        );

        if (pr.merged) {
          // PR is merged -- advance ticket to 'resolved'
          const { error: updateError } = await supabase
            .from("support_tickets")
            .update({ status: "resolved", pr_merged_at: pr.merged_at })
            .eq("id", ticket.id);

          if (updateError) {
            errors.push(
              `Ticket #${ticket.ticket_number}: failed to update status: ${updateError.message}`
            );
            continue;
          }

          // Insert fix_merged activity
          await supabase.from("activities").insert({
            activity_type: "fix_merged",
            title: `Fix PR merged for ticket #${ticket.ticket_number}`,
            description: `PR #${pr.number} "${pr.title}" by ${pr.user.login} was merged into ${pr.base.ref} at ${pr.merged_at}. Ticket status advanced to resolved.`,
            ticket_id: ticket.id,
            actor: "resolution-tracker",
            metadata: {
              pr_number: pr.number,
              pr_url: pr.html_url,
              pr_title: pr.title,
              merged_at: pr.merged_at,
              merged_by: pr.user.login,
              base_branch: pr.base.ref,
              head_sha: pr.head.sha,
            },
          });

          resolved++;
        }
        // If PR is closed but not merged, or still open, we do nothing
        // and check again on the next cron cycle.
      } catch (err) {
        errors.push(
          `Ticket #${ticket.ticket_number}: ${(err as Error).message}`
        );
      }
    }

    // ----------------------------------------------------------------
    // Phase 2: Auto-advance resolved tickets to verified
    // A resolved ticket is verified when a newer successful build exists
    // whose test_failures do NOT contain the ticket's error_signature.
    // ----------------------------------------------------------------
    let verified = 0;

    const { data: resolvedTickets, error: resolvedQueryError } = await supabase
      .from("support_tickets")
      .select("id, ticket_number, title, status, error_signature, updated_at")
      .eq("status", "resolved")
      .not("error_signature", "is", null);

    if (resolvedQueryError) {
      errors.push(
        `Failed to query resolved tickets: ${resolvedQueryError.message}`
      );
    } else if (resolvedTickets && resolvedTickets.length > 0) {
      for (const ticket of resolvedTickets) {
        try {
          // Find a successful build that started after the ticket was resolved
          // and does NOT contain the error_signature in its test_failures.
          // We query successful builds newer than the ticket's updated_at
          // (which is set when status changes to resolved).
          const { data: passingBuilds, error: buildQueryError } = await supabase
            .from("builds")
            .select("id, job_name, started_at, test_failures")
            .eq("status", "success")
            .gt("started_at", ticket.updated_at)
            .order("started_at", { ascending: false })
            .limit(10);

          if (buildQueryError) {
            errors.push(
              `Ticket #${ticket.ticket_number}: failed to query builds: ${buildQueryError.message}`
            );
            continue;
          }

          if (!passingBuilds || passingBuilds.length === 0) {
            continue;
          }

          // Check if any passing build lacks the ticket's error_signature
          // in its test_failures array
          const verifyingBuild = passingBuilds.find((build) => {
            const failures = build.test_failures as Array<{
              name?: string;
              className?: string;
              errorMessage?: string;
            }> | null;
            if (!failures || failures.length === 0) return true;
            // The error_signature is not directly stored in test_failures,
            // so we check that no failure message matches the signature pattern.
            // Since error_signature is formatted as "className::name::hash",
            // we check if the signature appears in any failure's combined key.
            return !failures.some((f) => {
              const className = f.className || "";
              const name = f.name || "";
              return ticket.error_signature!.startsWith(`${className}::${name}::`);
            });
          });

          if (verifyingBuild) {
            const { error: updateError } = await supabase
              .from("support_tickets")
              .update({
                status: "verified",
                verified_in_build_id: verifyingBuild.id,
              })
              .eq("id", ticket.id);

            if (updateError) {
              errors.push(
                `Ticket #${ticket.ticket_number}: failed to update to verified: ${updateError.message}`
              );
              continue;
            }

            // Log verification activity
            await supabase.from("activities").insert({
              activity_type: "ticket_updated",
              title: `Ticket #${ticket.ticket_number} auto-verified`,
              description: `Build ${verifyingBuild.job_name} (started ${verifyingBuild.started_at}) passed without the error signature "${ticket.error_signature}". Ticket auto-advanced from resolved to verified.`,
              ticket_id: ticket.id,
              build_id: verifyingBuild.id,
              actor: "resolution-tracker",
              metadata: {
                verifying_build_id: verifyingBuild.id,
                verifying_job_name: verifyingBuild.job_name,
                error_signature: ticket.error_signature,
              },
            });

            verified++;
          }
        } catch (err) {
          errors.push(
            `Ticket #${ticket.ticket_number} (verify): ${(err as Error).message}`
          );
        }
      }
    }

    const success = errors.length === 0;

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "resolution-tracker",
      trigger: "cron",
      input_payload: {
        tickets_found: tickets?.length ?? 0,
        resolved_tickets_found: resolvedTickets?.length ?? 0,
      },
      output_payload: { checked, resolved, verified, errors },
      success,
      error_message: success
        ? null
        : `${errors.length} error(s) during resolution tracking`,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success, checked, resolved, verified, errors }),
      {
        status: success ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMessage = (err as Error).message;

    await supabase.from("agent_runs").insert({
      agent_name: "resolution-tracker",
      trigger: "cron",
      input_payload: {},
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
