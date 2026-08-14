/**
 * One-time data migration: Supabase Postgres → SQLite
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/dbname DB_PATH=./prod.db npm run migrate
 *
 * This is a one-time migration from Supabase Postgres to SQLite.
 * Safe to re-run — uses INSERT OR IGNORE.
 * Requires network access to the Postgres instance (VPN if internal).
 */

import 'dotenv/config';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const DB_PATH = process.env.DB_PATH ?? './capa-ci-tracker.db';

if (!DATABASE_URL) {
  console.error(`
ERROR: DATABASE_URL environment variable is required.

Usage:
  DATABASE_URL=postgresql://user:pass@host:5432/dbname npm run migrate

Optional:
  DB_PATH=./prod.db  (default: ./capa-ci-tracker.db)
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SQLite setup
// ---------------------------------------------------------------------------

const sqliteDb = new DatabaseSync(DB_PATH);
sqliteDb.exec('PRAGMA journal_mode = WAL');
sqliteDb.exec('PRAGMA foreign_keys = OFF');  // Disable during bulk import
sqliteDb.exec('PRAGMA synchronous = OFF');   // Faster bulk writes
sqliteDb.exec('PRAGMA cache_size = -64000');

// Apply schema (idempotent)
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
sqliteDb.exec(schemaSql);

console.log(`[migrate] SQLite database at ${DB_PATH} — schema applied.`);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Convert a value for SQLite storage. */
function toSqlite(value: unknown, type: 'json' | 'boolean' | 'date' | 'text' | 'integer' | 'array'): unknown {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'json':
      // Postgres may return parsed objects (jsonb) or strings
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'boolean':
      return value ? 1 : 0;
    case 'date':
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'string') return value;
      return String(value);
    case 'array':
      // Postgres text[] comes as a JS array
      if (Array.isArray(value)) return JSON.stringify(value);
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    case 'integer':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseInt(value, 10);
      return value;
    case 'text':
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Table definitions — maps Postgres columns to SQLite columns + types
// ---------------------------------------------------------------------------

interface ColumnDef {
  pg: string;       // Postgres column name
  sqlite: string;   // SQLite column name
  type: 'json' | 'boolean' | 'date' | 'text' | 'integer' | 'array';
}

interface TableDef {
  name: string;         // table name (same in both DBs)
  pgName?: string;      // if the Postgres table has a different name
  columns: ColumnDef[];
}

const TABLES: TableDef[] = [
  // 1. failure_streaks (no FK deps)
  {
    name: 'failure_streaks',
    columns: [
      { pg: 'id',               sqlite: 'id',               type: 'text' },
      { pg: 'job_name',         sqlite: 'job_name',         type: 'text' },
      { pg: 'source',           sqlite: 'source',           type: 'text' },
      { pg: 'status',           sqlite: 'status',           type: 'text' },
      { pg: 'started_at',       sqlite: 'started_at',       type: 'date' },
      { pg: 'ended_at',         sqlite: 'ended_at',         type: 'date' },
      { pg: 'streak_length',    sqlite: 'streak_length',    type: 'integer' },
      { pg: 'phase_count',      sqlite: 'phase_count',      type: 'integer' },
      { pg: 'phases',           sqlite: 'phases',           type: 'json' },
      { pg: 'upstream_commits', sqlite: 'upstream_commits', type: 'array' },
      { pg: 'analysis_summary', sqlite: 'analysis_summary', type: 'text' },
      { pg: 'analyzed_at',      sqlite: 'analyzed_at',      type: 'date' },
      { pg: 'created_at',       sqlite: 'created_at',       type: 'date' },
      { pg: 'updated_at',       sqlite: 'updated_at',       type: 'date' },
    ],
  },

  // 2. builds (no FK deps)
  {
    name: 'builds',
    columns: [
      { pg: 'id',             sqlite: 'id',             type: 'text' },
      { pg: 'source',         sqlite: 'source',         type: 'text' },
      { pg: 'external_id',    sqlite: 'external_id',    type: 'text' },
      { pg: 'job_name',       sqlite: 'job_name',       type: 'text' },
      { pg: 'job_url',        sqlite: 'job_url',        type: 'text' },
      { pg: 'status',         sqlite: 'status',         type: 'text' },
      { pg: 'pass_count',     sqlite: 'pass_count',     type: 'integer' },
      { pg: 'fail_count',     sqlite: 'fail_count',     type: 'integer' },
      { pg: 'skip_count',     sqlite: 'skip_count',     type: 'integer' },
      { pg: 'total_count',    sqlite: 'total_count',    type: 'integer' },
      { pg: 'duration_ms',    sqlite: 'duration_ms',    type: 'integer' },
      { pg: 'started_at',     sqlite: 'started_at',     type: 'date' },
      { pg: 'finished_at',    sqlite: 'finished_at',    type: 'date' },
      { pg: 'ocp_version',    sqlite: 'ocp_version',    type: 'text' },
      { pg: 'parameters',     sqlite: 'parameters',     type: 'json' },
      { pg: 'test_failures',  sqlite: 'test_failures',  type: 'json' },
      { pg: 'raw_payload',    sqlite: 'raw_payload',    type: 'json' },
      { pg: 'log_fetched',    sqlite: 'log_fetched',    type: 'boolean' },
      { pg: 'created_at',     sqlite: 'created_at',     type: 'date' },
      { pg: 'updated_at',     sqlite: 'updated_at',     type: 'date' },
    ],
  },

  // 3. support_tickets (depends on builds, failure_streaks)
  {
    name: 'support_tickets',
    columns: [
      { pg: 'id',                          sqlite: 'id',                          type: 'text' },
      { pg: 'ticket_number',               sqlite: 'ticket_number',               type: 'integer' },
      { pg: 'title',                       sqlite: 'title',                       type: 'text' },
      { pg: 'description',                 sqlite: 'description',                 type: 'text' },
      { pg: 'status',                      sqlite: 'status',                      type: 'text' },
      { pg: 'severity',                    sqlite: 'severity',                    type: 'text' },
      { pg: 'assignee',                    sqlite: 'assignee',                    type: 'text' },
      { pg: 'build_id',                    sqlite: 'build_id',                    type: 'text' },
      { pg: 'error_signature',             sqlite: 'error_signature',             type: 'text' },
      { pg: 'root_cause',                  sqlite: 'root_cause',                  type: 'text' },
      { pg: 'root_cause_category',         sqlite: 'root_cause_category',         type: 'text' },
      { pg: 'matched_pattern',             sqlite: 'matched_pattern',             type: 'text' },
      { pg: 'fix_pr_url',                  sqlite: 'fix_pr_url',                  type: 'text' },
      { pg: 'fix_pr_number',               sqlite: 'fix_pr_number',               type: 'integer' },
      { pg: 'upstream_issue_url',          sqlite: 'upstream_issue_url',          type: 'text' },
      { pg: 'jira_key',                    sqlite: 'jira_key',                    type: 'text' },
      { pg: 'labels',                      sqlite: 'labels',                      type: 'json' },
      { pg: 'verified_in_build_id',        sqlite: 'verified_in_build_id',        type: 'text' },
      { pg: 'streak_id',                   sqlite: 'streak_id',                   type: 'text' },
      { pg: 'signature_cleared_in_build_id', sqlite: 'signature_cleared_in_build_id', type: 'text' },
      { pg: 'diagnosed_at',               sqlite: 'diagnosed_at',               type: 'date' },
      { pg: 'pr_merged_at',               sqlite: 'pr_merged_at',               type: 'date' },
      { pg: 'created_at',                 sqlite: 'created_at',                 type: 'date' },
      { pg: 'updated_at',                 sqlite: 'updated_at',                 type: 'date' },
      { pg: 'resolved_at',                sqlite: 'resolved_at',                type: 'date' },
      { pg: 'verified_at',                sqlite: 'verified_at',                type: 'date' },
    ],
  },

  // 4. activities (depends on builds, support_tickets)
  {
    name: 'activities',
    columns: [
      { pg: 'id',            sqlite: 'id',            type: 'text' },
      { pg: 'activity_type', sqlite: 'activity_type', type: 'text' },
      { pg: 'title',         sqlite: 'title',         type: 'text' },
      { pg: 'description',   sqlite: 'description',   type: 'text' },
      { pg: 'build_id',      sqlite: 'build_id',      type: 'text' },
      { pg: 'ticket_id',     sqlite: 'ticket_id',     type: 'text' },
      { pg: 'actor',         sqlite: 'actor',         type: 'text' },
      { pg: 'metadata',      sqlite: 'metadata',      type: 'json' },
      { pg: 'created_at',    sqlite: 'created_at',    type: 'date' },
    ],
  },

  // 5. tasks (depends on support_tickets)
  {
    name: 'tasks',
    columns: [
      { pg: 'id',           sqlite: 'id',           type: 'text' },
      { pg: 'ticket_id',    sqlite: 'ticket_id',    type: 'text' },
      { pg: 'title',        sqlite: 'title',        type: 'text' },
      { pg: 'status',       sqlite: 'status',       type: 'text' },
      { pg: 'assignee',     sqlite: 'assignee',     type: 'text' },
      { pg: 'sort_order',   sqlite: 'sort_order',   type: 'integer' },
      { pg: 'created_at',   sqlite: 'created_at',   type: 'date' },
      { pg: 'completed_at', sqlite: 'completed_at', type: 'date' },
    ],
  },

  // 6. agent_runs (no FK deps — column rename: trigger → trigger_source)
  {
    name: 'agent_runs',
    columns: [
      { pg: 'id',             sqlite: 'id',             type: 'text' },
      { pg: 'agent_name',     sqlite: 'agent_name',     type: 'text' },
      { pg: 'trigger',        sqlite: 'trigger_source',  type: 'text' },
      { pg: 'input_payload',  sqlite: 'input_payload',  type: 'json' },
      { pg: 'output_payload', sqlite: 'output_payload', type: 'json' },
      { pg: 'success',        sqlite: 'success',        type: 'boolean' },
      { pg: 'error_message',  sqlite: 'error_message',  type: 'text' },
      { pg: 'duration_ms',    sqlite: 'duration_ms',    type: 'integer' },
      { pg: 'created_at',     sqlite: 'created_at',     type: 'date' },
    ],
  },

  // 7. sop_mappings (no FK deps)
  {
    name: 'sop_mappings',
    columns: [
      { pg: 'id',            sqlite: 'id',            type: 'text' },
      { pg: 'pattern_type',  sqlite: 'pattern_type',  type: 'text' },
      { pg: 'sop_url',       sqlite: 'sop_url',       type: 'text' },
      { pg: 'sop_title',     sqlite: 'sop_title',     type: 'text' },
      { pg: 'sop_section',   sqlite: 'sop_section',   type: 'text' },
      { pg: 'summary',       sqlite: 'summary',       type: 'text' },
      { pg: 'source_repo',   sqlite: 'source_repo',   type: 'text' },
      { pg: 'last_verified', sqlite: 'last_verified', type: 'date' },
      { pg: 'created_at',    sqlite: 'created_at',    type: 'date' },
      { pg: 'updated_at',    sqlite: 'updated_at',    type: 'date' },
    ],
  },

  // 8. build_logs (depends on builds)
  {
    name: 'build_logs',
    columns: [
      { pg: 'id',             sqlite: 'id',             type: 'text' },
      { pg: 'build_id',       sqlite: 'build_id',       type: 'text' },
      { pg: 'log_url',        sqlite: 'log_url',        type: 'text' },
      { pg: 'log_text',       sqlite: 'log_text',       type: 'text' },
      { pg: 'log_size_bytes', sqlite: 'log_size_bytes', type: 'integer' },
      { pg: 'error_extract',  sqlite: 'error_extract',  type: 'text' },
      { pg: 'error_lines',    sqlite: 'error_lines',    type: 'json' },
      { pg: 'fetched_at',     sqlite: 'fetched_at',     type: 'date' },
    ],
  },

  // 9. streak_builds (depends on failure_streaks, builds — composite PK)
  {
    name: 'streak_builds',
    columns: [
      { pg: 'streak_id',       sqlite: 'streak_id',       type: 'text' },
      { pg: 'build_id',        sqlite: 'build_id',        type: 'text' },
      { pg: 'position',        sqlite: 'position',        type: 'integer' },
      { pg: 'error_signature', sqlite: 'error_signature', type: 'text' },
      { pg: 'phase_number',    sqlite: 'phase_number',    type: 'integer' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function migrateTable(pgClient: pg.Client, table: TableDef): Promise<number> {
  const pgTableName = table.pgName ?? table.name;
  const pgColumns = table.columns.map((c) => `"${c.pg}"`).join(', ');

  // Fetch all rows from Postgres
  const { rows } = await pgClient.query(`SELECT ${pgColumns} FROM "${pgTableName}" ORDER BY 1`);

  if (rows.length === 0) {
    return 0;
  }

  // Build the SQLite INSERT statement
  const sqliteCols = table.columns.map((c) => `"${c.sqlite}"`).join(', ');
  const placeholders = table.columns.map(() => '?').join(', ');
  const insertSql = `INSERT OR IGNORE INTO "${table.name}" (${sqliteCols}) VALUES (${placeholders})`;
  const stmt = sqliteDb.prepare(insertSql);

  // Insert in a transaction for performance
  const insertAll = sqliteDb.prepare('BEGIN');
  insertAll.run();

  let count = 0;
  try {
    for (const row of rows) {
      const values = table.columns.map((col) => toSqlite(row[col.pg], col.type)) as Array<string | number | null | Uint8Array>;
      stmt.run(...values);
      count++;
    }
    sqliteDb.prepare('COMMIT').run();
  } catch (err) {
    sqliteDb.prepare('ROLLBACK').run();
    throw err;
  }

  return count;
}

async function main(): Promise<void> {
  console.log('[migrate] Connecting to Postgres...');

  const pgClient = new pg.Client({ connectionString: DATABASE_URL });
  await pgClient.connect();
  console.log('[migrate] Connected to Postgres.');

  // Check which tables exist in Postgres
  const { rows: existingTables } = await pgClient.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const pgTableNames = new Set(existingTables.map((r: { table_name: string }) => r.table_name));

  console.log(`[migrate] Found ${pgTableNames.size} tables in Postgres: ${[...pgTableNames].sort().join(', ')}`);
  console.log('');

  const results: { table: string; count: number; status: string }[] = [];

  for (const table of TABLES) {
    const pgTableName = table.pgName ?? table.name;

    if (!pgTableNames.has(pgTableName)) {
      console.warn(`  WARNING: Table "${pgTableName}" does not exist in Postgres — skipping.`);
      results.push({ table: table.name, count: 0, status: 'skipped (not in Postgres)' });
      continue;
    }

    try {
      const count = await migrateTable(pgClient, table);
      console.log(`  ${table.name}: ${count} rows migrated`);
      results.push({ table: table.name, count, status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR migrating "${table.name}": ${msg}`);
      results.push({ table: table.name, count: 0, status: `error: ${msg}` });
    }
  }

  // Re-enable FK checks and verify
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  // Summary
  console.log('');
  console.log('=== Migration Summary ===');
  for (const r of results) {
    if (r.status === 'ok') {
      console.log(`  ${r.table}: ${r.count} rows migrated`);
    } else {
      console.log(`  ${r.table}: ${r.status}`);
    }
  }

  const totalRows = results.reduce((sum, r) => sum + r.count, 0);
  console.log(`\n  Total: ${totalRows} rows across ${results.filter((r) => r.status === 'ok').length} tables.`);

  await pgClient.end();
  sqliteDb.close();
  console.log('\n[migrate] Done.');
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
