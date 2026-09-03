/**
 * repair-ticket-titles -- one-off / idempotent data repair
 *
 * Fixes already-stored doubled ticket titles in support_tickets.title.
 *
 * Background: Jenkins `capi_tests` (RHACM4K Ginkgo) reports put the same
 * "KEY: summary" text in both `className` and `name`, so the old triage
 * composition `${className}: ${name}` doubled the title, e.g.:
 *
 *   "RHACM4K-61815: Provisions ...: RHACM4K-61815: Provisions ..."
 *
 * This script collapses any immediately-repeated "KEY: summary" segment down
 * to a single occurrence and applies the same truncation rule as the ingest
 * fix. It is idempotent — already-good titles (e.g. the "[Infra] ..." tickets)
 * are left unchanged, and re-running never re-corrupts a repaired title.
 *
 * v_ticket_summary derives its title directly from support_tickets.title
 * (a plain column, `t.title AS title`), so fixing the column fixes the view.
 *
 * Usage:
 *   DB_PATH=./capa-ci-tracker.db npx tsx scripts/repair-ticket-titles.ts
 *   -- or via npm script --
 *   npm run repair-titles
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  dedupeTitleSegments,
  stripRedundantKeyPrefix,
  truncateTitle,
} from '../agents/ticket-title.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'capa-ci-tracker.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[repair-titles] Database not found at ${DB_PATH}. Set DB_PATH env var.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 10000');
db.exec('PRAGMA foreign_keys = ON');

/**
 * The repair transform, exported-in-spirit as a pure function so it stays in
 * lockstep with the ingest fix: collapse repeated segments, then truncate.
 */
function repairTitle(title: string): string {
  // Order matters. The stored doubling repeats the WHOLE composed title,
  // including the redundant className prefix, e.g.:
  //   "CAPA Provisioning KEY: summary: CAPA Provisioning KEY: summary"
  // so the two halves are symmetric only while the prefix is still present.
  //
  // 1. Collapse the repeated group first, while the halves still match
  //    ("prefix KEY: summary : prefix KEY: summary" -> "prefix KEY: summary").
  //    Stripping the prefix first would only strip it from the first half and
  //    destroy the symmetry dedupe relies on, leaving the title still doubled.
  // 2. Drop the redundant className prefix in front of the Jira key on the
  //    single remaining copy -> "KEY: summary".
  // 3. Apply the same word-boundary truncation as ingest.
  return truncateTitle(stripRedundantKeyPrefix(dedupeTitleSegments(title)));
}

interface TicketRow {
  id: string;
  ticket_number: number;
  title: string;
}

const tickets = db
  .prepare('SELECT id, ticket_number, title FROM support_tickets')
  .all() as unknown as TicketRow[];

const updateStmt = db.prepare('UPDATE support_tickets SET title = ? WHERE id = ?');

let changed = 0;
db.exec('BEGIN');
try {
  for (const t of tickets) {
    const repaired = repairTitle(t.title);
    if (repaired !== t.title) {
      console.log(`[repair-titles] ticket #${t.ticket_number}`);
      console.log(`  before: ${t.title}`);
      console.log(`  after:  ${repaired}`);
      updateStmt.run(repaired, t.id);
      changed++;
    }
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[repair-titles] Transaction failed, rolled back:', (err as Error).message);
  process.exit(1);
}

console.log(`[repair-titles] Done. tickets scanned: ${tickets.length}, titles repaired: ${changed}`);
db.close();
