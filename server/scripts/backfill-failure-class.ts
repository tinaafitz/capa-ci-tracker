/**
 * backfill-failure-class -- one-off / idempotent backfill script
 *
 * Classifies existing builds that have status 'failure', 'aborted', or 'unstable'
 * and writes failure_class, failure_reason, is_infra back to the builds table.
 * Then backfills support_tickets.failure_class via build_id join.
 *
 * Safe to re-run: idempotent (uses direct UPDATE; already-classified rows
 * get re-classified with the same result).
 *
 * Usage:
 *   DB_PATH=./capa-ci-tracker.db npx tsx scripts/backfill-failure-class.ts
 *   -- or via npm script --
 *   npm run backfill
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyFailure } from '../agents/classify-failure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'capa-ci-tracker.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[backfill] Database not found at ${DB_PATH}. Set DB_PATH env var.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 10000');
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------------------
// Idempotent column guard (same as connection.ts)
// ---------------------------------------------------------------------------

interface ColumnInfo { name: string }

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as ColumnInfo[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
    console.log(`[backfill] Added column ${table}.${column}`);
  }
}

ensureColumn('builds', 'failure_class',  'TEXT');
ensureColumn('builds', 'failure_reason', 'TEXT');
ensureColumn('builds', 'is_infra',       'INTEGER NOT NULL DEFAULT 0');
ensureColumn('support_tickets', 'failure_class', 'TEXT');

// ---------------------------------------------------------------------------
// Fetch builds to classify
// ---------------------------------------------------------------------------

interface BuildRow {
  id: string;
  status: string;
  job_name: string;
  fail_count: number;
  pass_count: number;
  raw_payload: string | null;
  test_failures: string | null;
}

const builds = db.prepare(`
  SELECT id, status, job_name, fail_count, pass_count, raw_payload, test_failures
  FROM builds
  WHERE status IN ('failure', 'aborted', 'unstable')
`).all() as unknown as BuildRow[];

console.log(`[backfill] Found ${builds.length} builds to classify.`);

const updateBuildStmt = db.prepare(`
  UPDATE builds
  SET failure_class = ?, failure_reason = ?, is_infra = ?
  WHERE id = ?
`);

const updateTicketStmt = db.prepare(`
  UPDATE support_tickets
  SET failure_class = ?
  WHERE build_id = ?
`);

// ---------------------------------------------------------------------------
// Classify and update
// ---------------------------------------------------------------------------

let buildsDone = 0;
let ticketsDone = 0;
let errors = 0;

db.exec('BEGIN');
try {
  for (const build of builds) {
    try {
      // Attempt to extract description/reason from raw_payload (Prow ProwJob JSON)
      let description: string | undefined;
      let reason: string | undefined;

      if (build.raw_payload) {
        try {
          const payload = JSON.parse(build.raw_payload) as Record<string, unknown>;
          const prowStatus = payload.status as Record<string, unknown> | undefined;
          if (prowStatus?.description) {
            description = String(prowStatus.description);
            reason = description;
          }
        } catch {
          // Not a Prow payload — may be a Jenkins build object; that's fine
        }
      }

      // Extract first test failure error message as reason if no description
      if (!reason && build.test_failures) {
        try {
          const failures = JSON.parse(build.test_failures) as Array<{ errorMessage?: string; name?: string }>;
          if (failures.length > 0) {
            reason = failures[0].errorMessage || failures[0].name;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      const testsPassed: boolean | null =
        build.fail_count === 0 && build.pass_count > 0 ? true : null;

      const cls = classifyFailure({
        status: build.status,
        jobName: build.job_name,
        description,
        reason,
        testsPassed,
        failCount: build.fail_count,
      });

      updateBuildStmt.run(cls.failure_class, cls.failure_reason, cls.is_infra, build.id);
      buildsDone++;

      // Backfill linked ticket(s)
      const ticketResult = updateTicketStmt.run(cls.failure_class, build.id);
      ticketsDone += (ticketResult as { changes: number }).changes ?? 0;
    } catch (err) {
      errors++;
      console.error(`[backfill] Error classifying build ${build.id}: ${(err as Error).message}`);
    }
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[backfill] Transaction failed, rolled back:', (err as Error).message);
  process.exit(1);
}

console.log(`[backfill] Done. builds updated: ${buildsDone}, tickets updated: ${ticketsDone}, errors: ${errors}`);
db.close();
