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

// Apply schema (idempotent -- uses CREATE TABLE IF NOT EXISTS / CREATE VIEW IF NOT EXISTS)
const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schemaSql);

console.log(`[db] SQLite database opened at ${config.dbPath}`);

export { db };
