/**
 * resolution-tracker -- Node.js agent
 *
 * Finds tickets with status='fix_in_progress' and fix_pr_url set,
 * checks GitHub API for PR merge status, and advances ticket status on merge.
 * Also auto-advances resolved tickets to verified when a newer successful
 * build exists without the ticket's error signature.
 * Ported from supabase/functions/resolution-tracker/index.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';

const AGENT_NAME = 'resolution-tracker';

export interface AgentResult {
  success: boolean;
  message: string;
  checked?: number;
  resolved?: number;
  verified?: number;
  errors?: string[];
}

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
  updated_at: string;
}

// ============================================================
// Prepared statements
// ============================================================

const getFixInProgressTicketsStmt = db.prepare(`
  SELECT id, ticket_number, title, fix_pr_url, fix_pr_number, status, error_signature
  FROM support_tickets
  WHERE status = 'fix_in_progress' AND fix_pr_url IS NOT NULL
`);

const updateTicketResolvedStmt = db.prepare(`
  UPDATE support_tickets
  SET status = 'resolved', pr_merged_at = ?, resolved_at = ?, updated_at = ?
  WHERE id = ?
`);

const insertActivityStmt = db.prepare(`
  INSERT INTO activities (id, activity_type, title, description, ticket_id, build_id, actor, metadata, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'resolution-tracker', ?, ?)
`);

const getResolvedTicketsStmt = db.prepare(`
  SELECT id, ticket_number, title, status, error_signature, updated_at
  FROM support_tickets
  WHERE status = 'resolved' AND error_signature IS NOT NULL
`);

const getSuccessBuildsStmt = db.prepare(`
  SELECT id, job_name, started_at, test_failures
  FROM builds
  WHERE status = 'success' AND started_at > ?
  ORDER BY started_at DESC
  LIMIT 10
`);

const updateTicketVerifiedStmt = db.prepare(`
  UPDATE support_tickets
  SET status = 'verified', verified_in_build_id = ?, verified_at = ?, updated_at = ?
  WHERE id = ?
`);

// ============================================================
// GitHub PR URL parser
// ============================================================

function parseGitHubPrUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
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
  prNumber: number,
  githubToken: string,
): Promise<GitHubPR> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText} for ${url}`,
    );
  }

  return (await response.json()) as GitHubPR;
}

// ============================================================
// Exported run function
// ============================================================

export async function run(): Promise<AgentResult> {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;

  if (!GITHUB_TOKEN) {
    console.warn('[resolution-tracker] Missing GITHUB_TOKEN or GITHUB_PAT -- skipping');
    return { success: false, message: 'Missing GitHub token environment variable' };
  }

  const runId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  let resolvedCount = 0;
  let checked = 0;
  let verifiedCount = 0;
  const errors: string[] = [];

  db.prepare(`
    INSERT INTO agent_runs (id, agent_name, trigger_source, input_payload, success, created_at)
    VALUES (?, ?, 'cron', '{}', 1, ?)
  `).run(runId, AGENT_NAME, startedAt);

  try {
    // ----------------------------------------------------------------
    // Phase 1: Check fix_in_progress tickets for PR merge
    // ----------------------------------------------------------------

    const tickets = getFixInProgressTicketsStmt.all() as unknown as TrackedTicket[];

    for (const ticket of tickets) {
      checked++;

      try {
        const parsed = parseGitHubPrUrl(ticket.fix_pr_url);
        if (!parsed) {
          errors.push(
            `Ticket #${ticket.ticket_number}: invalid PR URL "${ticket.fix_pr_url}"`,
          );
          continue;
        }

        const pr = await checkPrStatus(
          parsed.owner,
          parsed.repo,
          parsed.number,
          GITHUB_TOKEN,
        );

        if (pr.merged) {
          const now = new Date().toISOString();

          // PR is merged -- advance ticket to 'resolved'
          updateTicketResolvedStmt.run(pr.merged_at, now, now, ticket.id);

          // Insert fix_merged activity
          insertActivityStmt.run(
            uuidv4(),
            'fix_merged',
            `Fix PR merged for ticket #${ticket.ticket_number}`,
            `PR #${pr.number} "${pr.title}" by ${pr.user.login} was merged into ${pr.base.ref} at ${pr.merged_at}. Ticket status advanced to resolved.`,
            ticket.id,
            null,
            JSON.stringify({
              pr_number: pr.number,
              pr_url: pr.html_url,
              pr_title: pr.title,
              merged_at: pr.merged_at,
              merged_by: pr.user.login,
              base_branch: pr.base.ref,
              head_sha: pr.head.sha,
            }),
            now,
          );

          resolvedCount++;
        }
        // If PR is closed but not merged, or still open, we do nothing
      } catch (err) {
        errors.push(
          `Ticket #${ticket.ticket_number}: ${(err as Error).message}`,
        );
      }
    }

    // ----------------------------------------------------------------
    // Phase 2: Auto-advance resolved tickets to verified
    // ----------------------------------------------------------------

    const resolvedTickets = getResolvedTicketsStmt.all() as unknown as TrackedTicket[];

    for (const ticket of resolvedTickets) {
      try {
        // Find successful builds newer than the ticket's updated_at
        const passingBuilds = getSuccessBuildsStmt.all(ticket.updated_at) as Array<{
          id: string;
          job_name: string;
          started_at: string;
          test_failures: string;
        }>;

        if (passingBuilds.length === 0) continue;

        // Check if any passing build lacks the ticket's error_signature
        const verifyingBuild = passingBuilds.find((build) => {
          const failures = JSON.parse(build.test_failures || '[]') as Array<{
            name?: string;
            className?: string;
            errorMessage?: string;
          }>;

          if (!failures || failures.length === 0) return true;

          return !failures.some((f) => {
            const className = f.className || '';
            const name = f.name || '';
            return ticket.error_signature!.startsWith(`${className}::${name}::`);
          });
        });

        if (verifyingBuild) {
          const now = new Date().toISOString();

          updateTicketVerifiedStmt.run(verifyingBuild.id, now, now, ticket.id);

          // Log verification activity
          insertActivityStmt.run(
            uuidv4(),
            'ticket_updated',
            `Ticket #${ticket.ticket_number} auto-verified`,
            `Build ${verifyingBuild.job_name} (started ${verifyingBuild.started_at}) passed without the error signature "${ticket.error_signature}". Ticket auto-advanced from resolved to verified.`,
            ticket.id,
            verifyingBuild.id,
            JSON.stringify({
              verifying_build_id: verifyingBuild.id,
              verifying_job_name: verifyingBuild.job_name,
              error_signature: ticket.error_signature,
            }),
            now,
          );

          verifiedCount++;
        }
      } catch (err) {
        errors.push(
          `Ticket #${ticket.ticket_number} (verify): ${(err as Error).message}`,
        );
      }
    }

    const success = errors.length === 0;
    const message = `Checked ${checked} tickets: ${resolvedCount} resolved, ${verifiedCount} verified${errors.length > 0 ? `, ${errors.length} error(s)` : ''}`;

    db.prepare(`
      UPDATE agent_runs SET success = ?, output_payload = ?, duration_ms = ?,
        error_message = ? WHERE id = ?
    `).run(
      success ? 1 : 0,
      JSON.stringify({ checked, resolved: resolvedCount, verified: verifiedCount, errors }),
      Date.now() - startTime,
      success ? null : `${errors.length} error(s) during resolution tracking`,
      runId,
    );

    return {
      success,
      message,
      checked,
      resolved: resolvedCount,
      verified: verifiedCount,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE agent_runs SET success = 0, error_message = ?, duration_ms = ? WHERE id = ?
    `).run(message, Date.now() - startTime, runId);
    return { success: false, message };
  }
}
