/**
 * prune-pre-floor-builds -- one-off / idempotent cleanup script
 *
 * Deletes builds whose started_at is strictly before the ingest floor date
 * (INGEST_FLOOR_DATE, default 2026-08-31 -- floor is INCLUSIVE, so anything on
 * or after the floor is kept). The ingest agents now refuse to re-add pre-floor
 * builds, so this cleans up the rows they backfilled before the floor existed.
 *
 * HARD DELETE: pre-floor builds and everything hanging off them are removed so
 * the tracker fully starts at the floor date with no orphaned tickets. The
 * pre-floor tickets are the doubled-title RHACM4K rows re-created by the ingest
 * backfill, so they are deleted rather than kept with a nulled build ref.
 *
 * For every build with started_at < floor, this deletes (children before
 * parents, so no FK violation), all inside ONE transaction:
 *   - support_tickets whose build_id is the pruned build, AND those tickets'
 *     own dependents:
 *       - tasks.ticket_id       (schema: ON DELETE CASCADE)
 *       - activities.ticket_id  (schema: ON DELETE CASCADE)
 *   - activities.build_id       (schema: ON DELETE SET NULL) -> deleted here
 *   - build_logs.build_id       (schema: ON DELETE CASCADE)
 *   - streak_builds.build_id    (schema: ON DELETE CASCADE)
 *   - the builds themselves
 * (agent_runs has no build_id/ticket_id FK, so it is untouched.)
 *
 * A surviving ticket may still reference a pruned build via its SET NULL side
 * columns (verified_in_build_id, signature_cleared_in_build_id); those are
 * nulled before the builds are deleted to avoid an FK error.
 *
 * Idempotent: a second run finds no pre-floor builds and changes nothing.
 *
 * Usage:
 *   DB_PATH=./capa-ci-tracker.db npx tsx scripts/prune-pre-floor-builds.ts
 *   # preview only, no writes:
 *   DB_PATH=./capa-ci-tracker.db npx tsx scripts/prune-pre-floor-builds.ts --dry-run
 *   # override floor:
 *   INGEST_FLOOR_DATE=2026-09-01 npx tsx scripts/prune-pre-floor-builds.ts
 *   # or via npm script:
 *   npm run prune-builds -- --dry-run
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveFloorMs } from '../agents/ingest-floor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'capa-ci-tracker.db');

const floorMs = resolveFloorMs(process.env.INGEST_FLOOR_DATE);
if (floorMs === null) {
  console.error('[prune] Ingest floor is disabled (INGEST_FLOOR_DATE empty/invalid); nothing to prune.');
  process.exit(0);
}
// ISO 8601 string form for lexicographic comparison against started_at TEXT.
const floorIso = new Date(floorMs).toISOString();

if (!fs.existsSync(DB_PATH)) {
  console.error(`[prune] Database not found at ${DB_PATH}. Set DB_PATH env var.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 10000');
db.exec('PRAGMA foreign_keys = ON');

console.log(`[prune] DB: ${DB_PATH}`);
console.log(`[prune] Floor (inclusive): ${floorIso} -- deleting builds with started_at < floor`);
console.log(`[prune] Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

// ---------------------------------------------------------------------------
// Identify pre-floor builds. started_at is stored as ISO 8601 UTC text. We
// normalize both sides through SQLite's datetime() so the comparison is by
// actual instant rather than raw lexicographic bytes -- this keeps the prune
// in agreement with the ingest path's numeric epoch-ms compare even if a
// source ever emits an offset form (e.g. +00:00) instead of a Z suffix.
// Rows with NULL / unparseable started_at (datetime() -> NULL) are left alone.
// ---------------------------------------------------------------------------

interface CountRow { cnt: number }

const preFloorIds = (
  db.prepare(
    `SELECT id FROM builds
       WHERE started_at IS NOT NULL
         AND datetime(started_at) IS NOT NULL
         AND datetime(started_at) < datetime(?)`,
  ).all(floorIso) as unknown as Array<{ id: string }>
).map((r) => r.id);

if (preFloorIds.length === 0) {
  const totalBuilds = (db.prepare('SELECT count(*) AS cnt FROM builds').get() as unknown as CountRow).cnt;
  const totalTickets = (db.prepare('SELECT count(*) AS cnt FROM support_tickets').get() as unknown as CountRow).cnt;
  console.log(`[prune] No pre-floor builds found. builds=${totalBuilds}, tickets=${totalTickets}. Nothing to do.`);
  db.close();
  process.exit(0);
}

const buildPlaceholders = preFloorIds.map(() => '?').join(',');

// Tickets to delete: those whose originating build is being pruned.
const ticketIds = (
  db.prepare(`SELECT id FROM support_tickets WHERE build_id IN (${buildPlaceholders})`).all(...preFloorIds) as unknown as Array<{ id: string }>
).map((r) => r.id);
const ticketPlaceholders = ticketIds.map(() => '?').join(',');

// ---------------------------------------------------------------------------
// Count what will be affected (printed BEFORE any write)
// ---------------------------------------------------------------------------

function countByBuild(sql: string): number {
  return (db.prepare(sql).get(...preFloorIds) as unknown as CountRow).cnt;
}
function countByTicket(sql: string): number {
  if (ticketIds.length === 0) return 0;
  return (db.prepare(sql).get(...ticketIds) as unknown as CountRow).cnt;
}

// Ticket-scoped children (deleted because their parent ticket is deleted).
const tasksToDelete = countByTicket(
  `SELECT count(*) AS cnt FROM tasks WHERE ticket_id IN (${ticketPlaceholders})`,
);
const ticketActivitiesToDelete = countByTicket(
  `SELECT count(*) AS cnt FROM activities WHERE ticket_id IN (${ticketPlaceholders})`,
);

// Build-scoped rows.
const buildActivitiesToDelete = countByBuild(
  `SELECT count(*) AS cnt FROM activities WHERE build_id IN (${buildPlaceholders})`,
);
const buildLogsToDelete = countByBuild(
  `SELECT count(*) AS cnt FROM build_logs WHERE build_id IN (${buildPlaceholders})`,
);
const streakBuildsToDelete = countByBuild(
  `SELECT count(*) AS cnt FROM streak_builds WHERE build_id IN (${buildPlaceholders})`,
);

// SET NULL side-refs on SURVIVING tickets that point at a pruned build.
const survivingSelfRefsToNull = countByBuild(
  `SELECT count(*) AS cnt FROM support_tickets
     WHERE (verified_in_build_id IN (${buildPlaceholders})
         OR signature_cleared_in_build_id IN (${buildPlaceholders}))`,
);

// Total activities deleted = union of ticket-scoped and build-scoped. A row
// could match both (build_id pruned AND ticket_id pruned); count distinctly.
const totalActivitiesToDelete =
  ticketIds.length === 0
    ? buildActivitiesToDelete
    : (
        db.prepare(
          `SELECT count(*) AS cnt FROM activities
             WHERE build_id IN (${buildPlaceholders})
                OR ticket_id IN (${ticketPlaceholders})`,
        ).get(...preFloorIds, ...ticketIds) as unknown as CountRow
      ).cnt;

console.log('[prune] Planned deletes:');
console.log(`[prune]   builds ................................. ${preFloorIds.length}`);
console.log(`[prune]   support_tickets ........................ ${ticketIds.length}`);
console.log(`[prune]   activities (build- and ticket-scoped).. ${totalActivitiesToDelete}`);
console.log(`[prune]   tasks (ticket-scoped) .................. ${tasksToDelete}`);
console.log(`[prune]   build_logs ............................. ${buildLogsToDelete}`);
console.log(`[prune]   streak_builds .......................... ${streakBuildsToDelete}`);
console.log(`[prune]   agent_runs ............................. 0 (no build/ticket FK)`);
console.log(`[prune] Planned nulls (surviving tickets):`);
console.log(`[prune]   verified/signature_cleared side-refs ... ${survivingSelfRefsToNull}`);

if (DRY_RUN) {
  console.log('[prune] DRY RUN -- no changes written. Re-run without --dry-run to apply.');
  db.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply, children before parents, in a single transaction.
// ---------------------------------------------------------------------------

db.exec('BEGIN');
try {
  // 1. Ticket-scoped children of the tickets we are about to delete.
  if (ticketIds.length > 0) {
    db.prepare(`DELETE FROM tasks WHERE ticket_id IN (${ticketPlaceholders})`).run(...ticketIds);
    db.prepare(`DELETE FROM activities WHERE ticket_id IN (${ticketPlaceholders})`).run(...ticketIds);
  }

  // 2. Build-scoped activities not already removed via their ticket.
  db.prepare(`DELETE FROM activities WHERE build_id IN (${buildPlaceholders})`).run(...preFloorIds);

  // 3. CASCADE-equivalent build dependents.
  db.prepare(`DELETE FROM build_logs WHERE build_id IN (${buildPlaceholders})`).run(...preFloorIds);
  db.prepare(`DELETE FROM streak_builds WHERE build_id IN (${buildPlaceholders})`).run(...preFloorIds);

  // 4. Null SET NULL side-refs on SURVIVING tickets pointing at a pruned build
  //    (the to-be-deleted tickets go away entirely in the next step).
  db.prepare(
    `UPDATE support_tickets SET verified_in_build_id = NULL WHERE verified_in_build_id IN (${buildPlaceholders})`,
  ).run(...preFloorIds);
  db.prepare(
    `UPDATE support_tickets SET signature_cleared_in_build_id = NULL WHERE signature_cleared_in_build_id IN (${buildPlaceholders})`,
  ).run(...preFloorIds);

  // 5. The pre-floor tickets themselves (children already gone).
  if (ticketIds.length > 0) {
    db.prepare(`DELETE FROM support_tickets WHERE id IN (${ticketPlaceholders})`).run(...ticketIds);
  }

  // 6. Finally the builds.
  db.prepare(`DELETE FROM builds WHERE id IN (${buildPlaceholders})`).run(...preFloorIds);

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[prune] Transaction failed, rolled back:', (err as Error).message);
  db.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resulting state
// ---------------------------------------------------------------------------

const remainingBuilds = (db.prepare('SELECT count(*) AS cnt FROM builds').get() as unknown as CountRow).cnt;
const remainingTickets = (db.prepare('SELECT count(*) AS cnt FROM support_tickets').get() as unknown as CountRow).cnt;
const minStarted = (
  db.prepare('SELECT MIN(started_at) AS m FROM builds WHERE started_at IS NOT NULL').get() as unknown as { m: string | null }
).m;

console.log('[prune] Done. Deleted:');
console.log(`[prune]   builds ................. ${preFloorIds.length}`);
console.log(`[prune]   support_tickets ........ ${ticketIds.length}`);
console.log(`[prune]   activities ............. ${totalActivitiesToDelete}`);
console.log(`[prune]   tasks .................. ${tasksToDelete}`);
console.log(`[prune]   build_logs ............. ${buildLogsToDelete}`);
console.log(`[prune]   streak_builds .......... ${streakBuildsToDelete}`);
console.log(`[prune]   agent_runs ............. 0`);
console.log(`[prune] Remaining: builds=${remainingBuilds}, tickets=${remainingTickets}, min(started_at)=${minStarted ?? '(none)'}`);

db.close();
