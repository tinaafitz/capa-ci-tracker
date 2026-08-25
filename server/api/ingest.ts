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
 * Responses:
 *   200 { ok: false, message: 'ingest disabled' }       — DISABLE_INGEST=true
 *   409 { ok: false, message: 'ingest already running' } — concurrent run in progress
 *   200 { ok: true, jenkins: AgentResult, prow: AgentResult }
 */

import { Router } from 'express';
import { runIngestOnce } from '../scheduler.js';

export const ingestRouter = Router();

ingestRouter.post('/refresh-ingest', async (_req, res) => {
  const result = await runIngestOnce().catch(err => ({
    ok: false as const,
    message: err instanceof Error ? err.message : String(err),
  }));

  if (!result.ok) {
    const status = result.message === 'ingest already running' ? 409 : 200;
    res.status(status).json(result);
    return;
  }

  res.json(result);
});
