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

// Verify
const buildCount = (db.prepare('SELECT count(*) AS n FROM builds').get() as { n: number }).n;
const ticketCount = (db.prepare('SELECT count(*) AS n FROM support_tickets').get() as { n: number }).n;
const activityCount = (db.prepare('SELECT count(*) AS n FROM activities').get() as { n: number }).n;
const taskCount = (db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n;
const sopCount = (db.prepare('SELECT count(*) AS n FROM sop_mappings').get() as { n: number }).n;

console.log(`[seed] Loaded: ${buildCount} builds, ${ticketCount} tickets, ${activityCount} activities, ${taskCount} tasks, ${sopCount} SOP mappings`);
console.log('[seed] Done.');
