/**
 * On-demand ingest endpoint.
 *
 * POST /api/refresh-ingest
 *
 * Runs the requested ingest agent(s) immediately, respecting the same overlap
 * guards and DISABLE_INGEST flag as the scheduled cron jobs. The shared guard
 * state lives in scheduler.ts so a manual refresh can never run concurrently
 * with a scheduled run (or another manual refresh of the same source).
 *
 * Request body (optional JSON):
 *   { "source": "jenkins" | "prow" | "both" }
 * Absent or invalid → "both" (preserves the original button behaviour, which
 * sends no source field).
 *
 * Responses (status → body) — the discriminator is `reason`, not prose:
 *   200 { ok: true, sources, jenkins?, prow? }             — requested agent(s) succeeded
 *   200 { ok: false, reason: 'disabled', disabled: true }  — DISABLE_INGEST=true
 *   409 { ok: false, reason: 'running' }                   — requested source already running
 *   500 { ok: false, error: true, jenkins?, prow? }        — a requested agent failed
 *
 * `sources` echoes which sources ran ({ jenkins: bool, prow: bool }), and only
 * the corresponding jenkins/prow result objects are included.
 *
 * Frontend contract (RefreshIngestButton):
 *   res.status === 409           → "Already running…"
 *   !res.ok (500)                → "Refresh failed"
 *   res.ok && body.ok === false  → "Ingest disabled"  (only the disabled path
 *                                   returns 200 + ok:false, so this is safe)
 *   res.ok && body.ok === true   → "Updated" (success)
 */

import { Router } from 'express';
import { runIngestOnce, type IngestSources } from '../scheduler.js';

export const ingestRouter = Router();

/** Map the request body's `source` field to a runIngestOnce sources arg. */
function parseSources(body: unknown): IngestSources {
  const source =
    body && typeof body === 'object' && 'source' in body
      ? (body as { source?: unknown }).source
      : undefined;

  if (source === 'jenkins') return { jenkins: true, prow: false };
  if (source === 'prow') return { jenkins: false, prow: true };
  // 'both', absent, or anything unrecognised → run both (back-compat default).
  return { jenkins: true, prow: true };
}

ingestRouter.post('/refresh-ingest', async (req, res) => {
  const sources = parseSources(req.body);

  const result = await runIngestOnce(sources).catch(err => ({
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
