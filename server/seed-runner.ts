/**
 * Seed runner -- loads seed.sql into the SQLite database.
 * Run with: npm run seed (or tsx seed-runner.ts)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'db', 'seed.sql');

console.log('[seed] Loading seed data...');

const seedSql = fs.readFileSync(seedPath, 'utf-8');
db.exec(seedSql);

// ============================================================
// Rebase seed timestamps onto "now"
// ------------------------------------------------------------
// seed.sql uses hardcoded absolute dates (Aug 1-20 2026) so the demo would
// look stale after that window passes -- worse, the Activity page defaults to a
// 24h filter and everything older than 24h drops out, leaving the feed empty.
//
// Fix: shift every timestamp COLUMN by a single offset so the latest seeded
// event lands ~2h ago (inside the 24h window) while the ~20-day spread and all
// relative ordering / spacing are preserved. All the anchor logic lives here in
// ONE place. Cosmetic date strings embedded in JSON columns (parameters,
// test_failures) and in ocp_version labels like "4.18.0-nightly-2026-08-01"
// are intentionally left untouched -- they are labels, not filter/display
// timestamps, and rewriting them risks breaking JSON validity.

// Latest timestamp present in seed.sql (activities/verified ticket at Aug 20 05:00Z).
const SEED_LATEST = '2026-08-20T05:00:00Z';
// Land the newest event ~2h in the past so it sits comfortably inside the 24h view.
const LEAD_SECONDS = 2 * 60 * 60;

// Offset (seconds) to add to every seeded timestamp. Computed once, applied uniformly.
const offsetSeconds = Math.round(
  (Date.now() - LEAD_SECONDS * 1000 - Date.parse(SEED_LATEST)) / 1000
);

// Map of table -> timestamp columns to shift. NULLs are left as NULL by datetime().
const timestampColumns: Record<string, string[]> = {
  builds: ['started_at', 'finished_at', 'created_at', 'updated_at'],
  failure_streaks: ['started_at', 'ended_at', 'analyzed_at', 'created_at', 'updated_at'],
  support_tickets: ['diagnosed_at', 'pr_merged_at', 'created_at', 'updated_at', 'resolved_at', 'verified_at'],
  activities: ['created_at'],
  tasks: ['created_at', 'completed_at'],
  build_logs: ['fetched_at'],
  sop_mappings: ['last_verified', 'created_at', 'updated_at'],
  agent_runs: ['created_at'],
};

db.exec('BEGIN');
for (const [table, cols] of Object.entries(timestampColumns)) {
  // Store as ISO 8601 with a trailing Z to match the seed's TIMESTAMPTZ format.
  const setClause = cols
    .map((c) => `${c} = strftime('%Y-%m-%dT%H:%M:%SZ', datetime(${c}, '+${offsetSeconds} seconds'))`)
    .join(', ');
  db.exec(`UPDATE ${table} SET ${setClause};`);
}
db.exec('COMMIT');

console.log(`[seed] Rebased timestamps by ${offsetSeconds}s so the newest event is ~2h ago.`);

// Verify
const buildCount = (db.prepare('SELECT count(*) AS n FROM builds').get() as { n: number }).n;
const ticketCount = (db.prepare('SELECT count(*) AS n FROM support_tickets').get() as { n: number }).n;
const activityCount = (db.prepare('SELECT count(*) AS n FROM activities').get() as { n: number }).n;
const taskCount = (db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n;
const sopCount = (db.prepare('SELECT count(*) AS n FROM sop_mappings').get() as { n: number }).n;

console.log(`[seed] Loaded: ${buildCount} builds, ${ticketCount} tickets, ${activityCount} activities, ${taskCount} tasks, ${sopCount} SOP mappings`);
console.log('[seed] Done.');
