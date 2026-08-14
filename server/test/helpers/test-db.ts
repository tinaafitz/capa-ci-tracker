/**
 * Test helper: creates a fresh in-memory SQLite database with the full schema.
 *
 * Each test file gets its own DB instance to avoid cross-test contamination.
 * The schema is read from disk once and cached.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'db', 'schema.sql');

let schemaCache: string | null = null;

function getSchema(): string {
  if (!schemaCache) {
    schemaCache = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  }
  return schemaCache;
}

/**
 * Create a fresh in-memory SQLite database with the CAPA CI Tracker schema.
 * Each call returns a brand new database.
 */
export function createTestDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(getSchema());
  return db;
}
