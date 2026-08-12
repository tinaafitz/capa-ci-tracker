// resolution-tracker.ts -- CronJob script for tracking PR merges and auto-verifying fixes.
// Runs every 15 minutes on OpenShift.
//
// Phase 1: Finds tickets with status='fix_in_progress' and a fix_pr_url,
//          checks GitHub API for PR merge status, advances to 'resolved' on merge.
// Phase 2: Finds tickets with status='resolved', checks for a newer successful build
//          that does not reproduce the error_signature, advances to 'verified'.
//
// Usage:
//   node --import tsx jobs/resolution-tracker.ts

import { pool, query, log, recordAgentRun } from './db.js';

const GITHUB_TOKEN = process.env.GITHUB_PAT ?? '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL ?? '#capa-ci-alerts';

// ============================================================
// Types
// ============================================================

interface TrackedTicket {
  id: string;
  ticket_number: number;
  title: string;
  fix_pr_url: string;
  fix_pr_number: number | null;
  status: string;
  error_signature: string | null;
}

interface GitHubPR {
  state: string;
  merged: boolean;
  merged_at: string | null;
  html_url: string;
  title: string;
  number: number;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string };
}

// ============================================================
// GitHub PR URL Parsing
// ============================================================

function parseGitHubPrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

async function checkPrStatus(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} for ${url}`);
  }

  return await response.json() as GitHubPR;
}

// ============================================================
// Slack Notification (simplified -- only for fix_merged and verified events)
// ============================================================

async function sendSlackMessage(text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          { type: 'divider' },
        ],
        unfurl_links: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log('WARN', 'notify', `Slack API error: ${response.status} ${body}`);
    }
  } catch (err) {
    log('WARN', 'notify', `Slack notification failed: ${(err as Error).message}`);
  }
}

// ============================================================
// Phase 1: Check fix_in_progress tickets for PR merge
// ============================================================

async function checkMergedPRs(): Promise<{ checked: number; resolved: number; errors: string[] }> {
  const result = { checked: 0, resolved: 0, errors: [] as string[] };

  const ticketRes = await query(
    `SELECT id, ticket_number, title, fix_pr_url, fix_pr_number, status::text AS status, error_signature
     FROM support_tickets
     WHERE status = 'fix_in_progress'
       AND fix_pr_url IS NOT NULL`,
  );

  const tickets = ticketRes.rows as TrackedTicket[];
  log('INFO', 'resolution-tracker', `Phase 1: Found ${tickets.length} fix_in_progress tickets with PR URLs`);

  for (const ticket of tickets) {
    result.checked++;

    try {
      const parsed = parseGitHubPrUrl(ticket.fix_pr_url);
      if (!parsed) {
        result.errors.push(`Ticket #${ticket.ticket_number}: invalid PR URL "${ticket.fix_pr_url}"`);
        continue;
      }

      const pr = await checkPrStatus(parsed.owner, parsed.repo, parsed.number);

      if (pr.merged) {
        // PR is merged -- advance ticket to 'resolved'
        await query(
          `UPDATE support_tickets SET status = 'resolved', pr_merged_at = $2 WHERE id = $1`,
          [ticket.id, pr.merged_at],
        );

        // Insert fix_merged activity
        await query(
          `INSERT INTO activities (activity_type, title, description, ticket_id, actor, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'fix_merged',
            `Fix PR merged for ticket #${ticket.ticket_number}`,
            `PR #${pr.number} "${pr.title}" by ${pr.user.login} was merged into ${pr.base.ref} at ${pr.merged_at}. Ticket status advanced to resolved.`,
            ticket.id,
            'resolution-tracker',
            JSON.stringify({
              pr_number: pr.number,
              pr_url: pr.html_url,
              pr_title: pr.title,
              merged_at: pr.merged_at,
              merged_by: pr.user.login,
              base_branch: pr.base.ref,
              head_sha: pr.head.sha,
            }),
          ],
        );

        // Send Slack notification
        await sendSlackMessage(
          `:white_check_mark: *Fix merged for CAPA-${ticket.ticket_number}*\n` +
          `PR <${pr.html_url}|#${pr.number}> "${pr.title}" merged by ${pr.user.login}\n` +
          `Ticket "${ticket.title}" advanced to *resolved*`,
        );

        log('INFO', 'resolution-tracker', `Ticket #${ticket.ticket_number} resolved (PR #${pr.number} merged)`);
        result.resolved++;
      }
      // If PR is still open or closed-without-merge, do nothing -- check again next cycle.
    } catch (err) {
      result.errors.push(`Ticket #${ticket.ticket_number}: ${(err as Error).message}`);
    }
  }

  return result;
}

// ============================================================
// Phase 2: Auto-advance resolved tickets to verified
// ============================================================

async function checkVerification(): Promise<{ checked: number; verified: number; errors: string[] }> {
  const result = { checked: 0, verified: 0, errors: [] as string[] };

  const ticketRes = await query(
    `SELECT id, ticket_number, title, status::text AS status, error_signature, updated_at
     FROM support_tickets
     WHERE status = 'resolved'
       AND error_signature IS NOT NULL`,
  );

  const tickets = ticketRes.rows;
  log('INFO', 'resolution-tracker', `Phase 2: Found ${tickets.length} resolved tickets to check for verification`);

  for (const ticket of tickets) {
    result.checked++;

    try {
      // Find successful builds that started after the ticket was resolved
      const buildRes = await query(
        `SELECT id, job_name, started_at, test_failures
         FROM builds
         WHERE status = 'success'
           AND started_at > $1
         ORDER BY started_at DESC
         LIMIT 10`,
        [ticket.updated_at],
      );

      if (buildRes.rows.length === 0) continue;

      // Check if any passing build lacks the ticket's error_signature in its test_failures
      const verifyingBuild = buildRes.rows.find((build: { test_failures: TestFailureRow[] | null }) => {
        const failures = build.test_failures as Array<{ name?: string; className?: string; errorMessage?: string }> | null;
        if (!failures || failures.length === 0) return true;
        return !failures.some((f: { className?: string; name?: string }) => {
          const className = f.className ?? '';
          const name = f.name ?? '';
          return (ticket.error_signature as string).startsWith(`${className}::${name}::`);
        });
      });

      if (verifyingBuild) {
        await query(
          `UPDATE support_tickets SET status = 'verified', verified_in_build_id = $2 WHERE id = $1`,
          [ticket.id, verifyingBuild.id],
        );

        // Log verification activity
        await query(
          `INSERT INTO activities (activity_type, title, description, ticket_id, build_id, actor, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            'ticket_updated',
            `Ticket #${ticket.ticket_number} auto-verified`,
            `Build ${verifyingBuild.job_name} (started ${verifyingBuild.started_at}) passed without the error signature "${ticket.error_signature}". Ticket auto-advanced from resolved to verified.`,
            ticket.id,
            verifyingBuild.id,
            'resolution-tracker',
            JSON.stringify({
              verifying_build_id: verifyingBuild.id,
              verifying_job_name: verifyingBuild.job_name,
              error_signature: ticket.error_signature,
            }),
          ],
        );

        await sendSlackMessage(
          `:heavy_check_mark: *CAPA-${ticket.ticket_number} auto-verified*\n` +
          `Build ${verifyingBuild.job_name} passed without the error signature.\n` +
          `Ticket "${ticket.title}" advanced to *verified*`,
        );

        log('INFO', 'resolution-tracker', `Ticket #${ticket.ticket_number} auto-verified via build ${verifyingBuild.id}`);
        result.verified++;
      }
    } catch (err) {
      result.errors.push(`Ticket #${ticket.ticket_number} (verify): ${(err as Error).message}`);
    }
  }

  return result;
}

// Minimal type for the test_failures column coming back from pg
type TestFailureRow = { name?: string; className?: string; errorMessage?: string };

// ============================================================
// Main Entry Point
// ============================================================

async function main() {
  const startTime = Date.now();
  log('INFO', 'resolution-tracker', 'Starting resolution tracker');

  try {
    const phase1 = await checkMergedPRs();
    const phase2 = await checkVerification();

    const allErrors = [...phase1.errors, ...phase2.errors];
    const success = allErrors.length === 0;

    await recordAgentRun({
      agentName: 'resolution-tracker',
      trigger: 'cron',
      inputPayload: {
        fix_in_progress_tickets: phase1.checked,
        resolved_tickets: phase2.checked,
      },
      outputPayload: {
        checked: phase1.checked,
        resolved: phase1.resolved,
        verified: phase2.verified,
        errors: allErrors,
      },
      success,
      errorMessage: success ? null : `${allErrors.length} error(s) during resolution tracking`,
      durationMs: Date.now() - startTime,
    });

    log('INFO', 'resolution-tracker', `Job finished in ${Date.now() - startTime}ms`, {
      checked: phase1.checked, resolved: phase1.resolved,
      verified: phase2.verified, errors: allErrors.length,
    });

    await pool.end();
    process.exit(success ? 0 : 1);
  } catch (err) {
    const errorMessage = (err as Error).message;
    log('ERROR', 'resolution-tracker', `Fatal error: ${errorMessage}`);

    await recordAgentRun({
      agentName: 'resolution-tracker',
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
