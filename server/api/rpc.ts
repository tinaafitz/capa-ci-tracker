/**
 * RPC endpoints -- replacements for Postgres stored functions.
 *
 * POST /api/rpc/dedup_triage_check
 */

import { Router } from 'express';
import { db } from '../db/connection.js';

export const rpcRouter = Router();

/**
 * POST /rpc/dedup_triage_check
 *
 * Checks if an open (non-resolved/verified) ticket with the given
 * error_signature already exists. SQLite is single-writer, so the
 * advisory lock from the Postgres version is unnecessary.
 *
 * Body: { p_error_signature: string }
 * Response: { exists: boolean, ticket_id: string | null }
 */
rpcRouter.post('/dedup_triage_check', (req, res) => {
  const { p_error_signature } = req.body as { p_error_signature?: string };

  if (!p_error_signature) {
    res.status(400).json({
      message: 'Missing required parameter: p_error_signature',
      code: '400',
    });
    return;
  }

  const stmt = db.prepare(`
    SELECT id, ticket_number
    FROM support_tickets
    WHERE error_signature = ?
      AND status NOT IN ('resolved', 'verified')
    LIMIT 1
  `);

  const row = stmt.get(p_error_signature) as Record<string, unknown> | undefined;

  if (row) {
    res.json({ exists: true, ticket_id: row.id, ticket_number: row.ticket_number });
  } else {
    res.json({ exists: false, ticket_id: null, ticket_number: null });
  }
});
