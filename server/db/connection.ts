import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new DatabaseSync(config.dbPath);

// Performance pragmas
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5s instead of failing immediately on lock
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -64000');

// Drop views that need to be recreated with updated column lists.
// CREATE VIEW IF NOT EXISTS won't update an existing view, so we drop first.
db.exec('DROP VIEW IF EXISTS v_ticket_summary');

// Apply schema (idempotent -- uses CREATE TABLE IF NOT EXISTS / CREATE VIEW IF NOT EXISTS)
const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schemaSql);

// Idempotent column additions — SQLite throws if the column already exists,
// so we check PRAGMA table_info first and only ALTER when absent.
interface ColumnInfo { name: string }

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as ColumnInfo[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('builds', 'failure_class',  'TEXT');
ensureColumn('builds', 'failure_reason', 'TEXT');
ensureColumn('builds', 'is_infra',       'INTEGER NOT NULL DEFAULT 0');
ensureColumn('support_tickets', 'failure_class', 'TEXT');

console.log(`[db] SQLite database opened at ${config.dbPath}`);

export { db };
