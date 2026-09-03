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
// seed.sql uses hardcoded absolute dates so the demo would look stale after
// that window passes -- worse, the Activity page defaults to a 30d filter and
// anything older drops out, leaving the feed empty.
//
// Fix: shift every timestamp COLUMN by a single offset so the latest seeded
// event lands ~2h ago (comfortably inside the 30d window) while the relative
// ordering / spacing between events are preserved. All the anchor logic lives here in
// ONE place. Cosmetic date strings embedded in JSON columns (parameters,
// test_failures) and in ocp_version labels like "4.18.0-nightly-2026-08-01"
// are intentionally left untouched -- they are labels, not filter/display
// timestamps, and rewriting them risks breaking JSON validity.

// Land the newest event ~2h in the past so it reads as a fresh, just-completed run.
const LEAD_SECONDS = 2 * 60 * 60;

// Map of table -> timestamp columns to shift. NULLs are left as NULL by datetime().
const timestampColumns: Record<string, string[]> = {
  builds: ['started_at', 'finished_at', 'created_at', 'updated_at'],
  failure_streaks: ['started_at', 'ended_at', 'analyzed_at', 'created_at', 'updated_at'],
  support_tickets: ['diagnosed_at', 'pr_merged_at', 'created_at', 'updated_at', 'resolved_at', 'verified_at'],
  activities: ['created_at'],
  tasks: ['created_at', 'completed_at'],
  build_logs: ['fetched_at'],
  agent_runs: ['created_at'],
  // sop_mappings intentionally omitted: seed.sql treats them as reference data
  // ("preserved as-is") with fixed last_verified dates that should NOT drift.
};

// Latest timestamp actually present in the just-loaded seed data. Derived from
// the same columns we shift, so it can never drift out of sync with seed.sql
// (a hardcoded anchor silently breaks the "~2h ago" invariant if the seed's
// newest event changes). MAX() ignores NULLs; the ISO-8601 'Z' strings sort
// lexicographically in timestamp order.
const seedLatest = (() => {
  const maxima: string[] = [];
  for (const [table, cols] of Object.entries(timestampColumns)) {
    // One aggregate per column (MAX() cannot be nested); collect the row's values.
    const selectList = cols.map((c, i) => `MAX(${c}) AS c${i}`).join(', ');
    const row = db.prepare(`SELECT ${selectList} FROM ${table}`).get() as Record<string, string | null>;
    for (const v of Object.values(row)) if (v != null) maxima.push(v);
  }
  // ISO-8601 'Z' strings sort lexicographically in timestamp order.
  const latest = maxima.sort().at(-1);
  if (!latest) throw new Error('[seed] No timestamps found in seeded data -- cannot rebase.');
  return latest;
})();

// Offset (seconds) to add to every seeded timestamp. Computed once, applied uniformly.
// May be negative when the newest seeded event is close to / ahead of "now" (e.g. today's builds).
const offsetSeconds = Math.round(
  (Date.now() - LEAD_SECONDS * 1000 - Date.parse(seedLatest)) / 1000
);

// SQLite datetime() modifiers need an explicit sign; a bare "+-N seconds" is
// malformed and makes datetime() return NULL (which then trips NOT NULL columns).
const offsetModifier = `${offsetSeconds >= 0 ? '+' : '-'}${Math.abs(offsetSeconds)} seconds`;

db.exec('BEGIN');
for (const [table, cols] of Object.entries(timestampColumns)) {
  // Store as ISO 8601 with a trailing Z to match the seed's TIMESTAMPTZ format.
  const setClause = cols
    .map((c) => `${c} = strftime('%Y-%m-%dT%H:%M:%SZ', datetime(${c}, '${offsetModifier}'))`)
    .join(', ');
  db.exec(`UPDATE ${table} SET ${setClause};`);
}
db.exec('COMMIT');

console.log(`[seed] Newest seeded event ${seedLatest}; rebased timestamps by ${offsetSeconds}s so it lands ~2h ago.`);

// Verify
const buildCount = (db.prepare('SELECT count(*) AS n FROM builds').get() as { n: number }).n;
const ticketCount = (db.prepare('SELECT count(*) AS n FROM support_tickets').get() as { n: number }).n;
const activityCount = (db.prepare('SELECT count(*) AS n FROM activities').get() as { n: number }).n;
const taskCount = (db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n;
const sopCount = (db.prepare('SELECT count(*) AS n FROM sop_mappings').get() as { n: number }).n;

console.log(`[seed] Loaded: ${buildCount} builds, ${ticketCount} tickets, ${activityCount} activities, ${taskCount} tasks, ${sopCount} SOP mappings`);
console.log('[seed] Done.');
