/**
 * On-demand ingest endpoint.
 *
 * POST /api/refresh-ingest
 *
 * Runs both ingest agents immediately, respecting the same overlap guards
 * and DISABLE_INGEST flag as the scheduled cron jobs. The shared guard
 * state lives in scheduler.ts so a manual refresh can never run concurrently
 * with a scheduled run (or another manual refresh).
 *
 * Responses (status → body) — the discriminator is `reason`, not prose:
 *   200 { ok: true, jenkins, prow }                       — both agents succeeded
 *   200 { ok: false, reason: 'disabled', disabled: true } — DISABLE_INGEST=true
 *   409 { ok: false, reason: 'running' }                  — concurrent run in progress
 *   500 { ok: false, error: true, jenkins?, prow? }       — one/both agents failed
 *
 * Frontend contract (RefreshIngestButton):
 *   res.status === 409           → "Already running…"
 *   !res.ok (500)                → "Refresh failed"
 *   res.ok && body.ok === false  → "Ingest disabled"  (only the disabled path
 *                                   returns 200 + ok:false, so this is safe)
 *   res.ok && body.ok === true   → "Updated" (success)
 */

import { Router } from 'express';
import { runIngestOnce } from '../scheduler.js';

export const ingestRouter = Router();

ingestRouter.post('/refresh-ingest', async (_req, res) => {
  const result = await runIngestOnce().catch(err => ({
    ok: false as const,
    message: err instanceof Error ? err.message : String(err),
  }));

  if (result.ok) {
    res.json(result);
    return;
  }

  // Non-ok: discriminate on the machine-readable reason.
  const reason = 'reason' in result ? result.reason : undefined;

  if (reason === 'running') {
    // Concurrent run — retryable; frontend shows "Already running…".
    res.status(409).json(result);
    return;
  }

  if (reason === 'disabled') {
    // Ingest turned off via env. Must stay 200 + ok:false so the frontend's
    // `res.ok && body.ok === false` branch shows "Ingest disabled".
    res.status(200).json({ ...result, disabled: true });
    return;
  }

  // Genuine failure (one or both agents failed internally, or an unexpected
  // error). Return 500 so the frontend's `!res.ok` branch shows "Refresh
  // failed" rather than mislabeling it as "Ingest disabled".
  res.status(500).json({ ...result, error: true });
});
