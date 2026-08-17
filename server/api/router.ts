/**
 * PostgREST-compatible Express router.
 *
 * Handles GET/HEAD/POST/PATCH/DELETE on /:table for whitelisted tables and views.
 * Uses the postgrest-compat parser to translate PostgREST query syntax into SQL.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import {
  parseRequest,
  buildSelectQuery,
  nestEmbeddedResults,
} from './postgrest-compat.js';
import {
  afterBuildInsert,
  afterActivityInsert,
  beforeTicketUpdate,
  setUpdatedAt,
} from '../triggers.js';
import { config } from '../config.js';
import { JSON_COLUMNS } from '../constants.js';

export const tableRouter = Router();

// ---------------------------------------------------------------------------
// Whitelist of allowed tables and views
// ---------------------------------------------------------------------------

const TABLES = new Set([
  'builds',
  'support_tickets',
  'activities',
  'tasks',
  'agent_runs',
  'sop_mappings',
  'failure_streaks',
  'build_logs',
  'streak_builds',
]);

const VIEWS = new Set([
  'v_ticket_summary',
  'v_build_failures',
  'v_daily_build_stats',
  'v_ticket_lifecycle',
  'v_pipeline_funnel',
  'v_failure_timeline',
]);

const ALLOWED = new Set([...TABLES, ...VIEWS]);

// ---------------------------------------------------------------------------
// Column whitelist per table — validated before any INSERT/UPDATE to prevent
// SQL injection via crafted column names.
// ---------------------------------------------------------------------------

const TABLE_COLUMNS: Record<string, Set<string>> = {
  builds: new Set(['id','source','external_id','job_name','job_url','status','pass_count','fail_count','skip_count','total_count','duration_ms','started_at','finished_at','ocp_version','parameters','test_failures','raw_payload','log_fetched','created_at','updated_at']),
  support_tickets: new Set(['id','ticket_number','title','description','status','severity','assignee','error_signature','root_cause','root_cause_category','matched_pattern','fix_pr_url','fix_pr_number','upstream_issue_url','jira_key','labels','build_id','verified_in_build_id','streak_id','signature_cleared_in_build_id','diagnosed_at','pr_merged_at','resolved_at','verified_at','created_at','updated_at']),
  activities: new Set(['id','activity_type','title','description','build_id','ticket_id','actor','metadata','created_at']),
  tasks: new Set(['id','ticket_id','title','status','assignee','sort_order','created_at','completed_at']),
  agent_runs: new Set(['id','agent_name','trigger_source','input_payload','output_payload','success','error_message','duration_ms','created_at']),
  sop_mappings: new Set(['id','pattern_type','sop_url','sop_title','sop_section','summary','source_repo','last_verified','created_at','updated_at']),
  failure_streaks: new Set(['id','job_name','source','status','started_at','ended_at','streak_length','phase_count','phases','upstream_commits','analysis_summary','analyzed_at','created_at','updated_at']),
  build_logs: new Set(['id','build_id','log_url','log_text','log_size_bytes','error_extract','error_lines','fetched_at']),
  streak_builds: new Set(['streak_id','build_id','position','error_signature','phase_number']),
};

function validateColumns(tableName: string, columns: string[]): string | null {
  const allowed = TABLE_COLUMNS[tableName];
  if (!allowed) return null; // views — no write operations allowed anyway
  const invalid = columns.filter(c => !allowed.has(c));
  if (invalid.length > 0) return `Unknown column(s): ${invalid.join(', ')}`;
  return null;
}

// ---------------------------------------------------------------------------
// Columns with timestamps that should get auto-populated
// ---------------------------------------------------------------------------

const TIMESTAMP_DEFAULTS: Record<string, string[]> = {
  builds:           ['created_at', 'updated_at'],
  support_tickets:  ['created_at', 'updated_at'],
  activities:       ['created_at'],
  tasks:            ['created_at'],
  agent_runs:       ['created_at'],
  sop_mappings:     ['created_at', 'updated_at'],
  failure_streaks:  ['created_at', 'updated_at'],
  build_logs:       ['fetched_at'],
};

// ---------------------------------------------------------------------------
// Unique constraint columns for UPSERT (on_conflict)
// ---------------------------------------------------------------------------

const UPSERT_CONFLICT: Record<string, string> = {
  builds:          'source, external_id, job_name',
  sop_mappings:    'pattern_type, sop_url',
  failure_streaks: 'source, job_name, started_at',
  build_logs:      'build_id',
  streak_builds:   'streak_id, build_id',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SqlValue = string | number | bigint | null;

function serializeValue(key: string, value: unknown): SqlValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (JSON_COLUMNS.has(key) && typeof value === 'object') {
    return JSON.stringify(value);
  }
  // Convert boolean to 0/1 for SQLite
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  return String(value);
}

function now(): string {
  return new Date().toISOString();
}

function deserializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try { out[key] = JSON.parse(value); } catch { out[key] = value; }
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

tableRouter.all('/:table', (req, res) => {
  const tableName = req.params.table;

  if (!ALLOWED.has(tableName)) {
    res.status(404).json({ message: `Table or view '${tableName}' not found`, code: '404' });
    return;
  }

  // Views are read-only
  if (VIEWS.has(tableName) && req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ message: 'Views are read-only', code: '405' });
    return;
  }

  switch (req.method) {
    case 'GET':
    case 'HEAD':
      handleSelect(req, res, tableName);
      break;
    case 'POST':
      handleInsert(req, res, tableName);
      break;
    case 'PATCH':
      handleUpdate(req, res, tableName);
      break;
    case 'DELETE':
      handleDelete(req, res, tableName);
      break;
    default:
      res.status(405).json({ message: `Method ${req.method} not allowed`, code: '405' });
  }
});

// ---------------------------------------------------------------------------
// GET / HEAD
// ---------------------------------------------------------------------------

function handleSelect(req: import('express').Request, res: import('express').Response, tableName: string): void {
  const parsed = parseRequest(req, tableName);
  const { sql, params, countSql, countParams } = buildSelectQuery(tableName, parsed);

  try {
    // Run count query if needed
    let total: number | null = null;
    if (countSql) {
      const countRow = db.prepare(countSql).get(...countParams) as Record<string, unknown> | undefined;
      total = (countRow?.total as number) ?? 0;
    }

    // HEAD request: just return count
    if (parsed.isHead) {
      if (total !== null) {
        const rangeEnd = total > 0 ? total - 1 : 0;
        res.set('Content-Range', `0-${rangeEnd}/${total}`);
      }
      res.status(200).end();
      return;
    }

    // Execute main query
    const rows = (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(deserializeRow);

    // Nest embedded resources
    const result = nestEmbeddedResults(rows, parsed.embeds);

    // Set Content-Range header
    if (total !== null) {
      const from = parsed.offset ?? 0;
      const to = from + result.length - 1;
      res.set('Content-Range', `${from}-${Math.max(to, from)}/${total}`);
    }

    // Single object response — maybeSingle() returns null on 0 rows, single() would 406
    if (parsed.wantSingleObject) {
      if (result.length === 0) {
        const preferHeader = (req.headers['prefer'] as string) || '';
        if (preferHeader.includes('missing=default')) {
          res.json(null);
          return;
        }
        res.status(406).json({
          message: 'JSON object requested, multiple (or no) rows returned',
          code: 'PGRST116',
        });
        return;
      }
      res.json(result[0]);
      return;
    }

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] SELECT error on ${tableName}:`, message);
    const clientMessage = config.nodeEnv === 'production' ? 'Internal server error' : message;
    res.status(500).json({ message: clientMessage, code: '500' });
  }
}

// ---------------------------------------------------------------------------
// POST (INSERT / UPSERT)
// ---------------------------------------------------------------------------

function handleInsert(req: import('express').Request, res: import('express').Response, tableName: string): void {
  const parsed = parseRequest(req, tableName);
  const bodyData = req.body;

  if (!bodyData || (typeof bodyData !== 'object')) {
    res.status(400).json({ message: 'Request body must be a JSON object or array', code: '400' });
    return;
  }

  const rows = Array.isArray(bodyData) ? bodyData : [bodyData];
  if (rows.length === 0) {
    res.status(400).json({ message: 'Request body must not be empty', code: '400' });
    return;
  }

  try {
    const insertedRows: Record<string, unknown>[] = [];
    const insertedDataObjects: Record<string, unknown>[] = [];
    const timestamp = now();

    db.exec('BEGIN');
    try {

      for (const row of rows) {
        const data = { ...row } as Record<string, unknown>;

        // Auto-generate id if not provided
        if (!data.id && tableName !== 'streak_builds') {
          data.id = uuidv4();
        }

        // Auto-populate timestamp fields
        const tsFields = TIMESTAMP_DEFAULTS[tableName] || [];
        for (const field of tsFields) {
          if (!data[field]) {
            data[field] = timestamp;
          }
        }

        const columns = Object.keys(data);
        const colError = validateColumns(tableName, columns);
        if (colError) {
          db.exec('ROLLBACK');
          res.status(400).json({ message: colError, code: '400' });
          return;
        }
        const values = columns.map(c => serializeValue(c, data[c]));
        const placeholders = columns.map(() => '?').join(', ');
        const colList = columns.map(c => `"${c}"`).join(', ');

        let sql: string;

        if (parsed.isMergeDuplicates) {
          let conflictCols = UPSERT_CONFLICT[tableName];
          if (parsed.onConflict) {
            // Validate client-supplied on_conflict columns against the table's known columns
            const clientCols = parsed.onConflict.split(',').map(s => s.trim());
            const allowed = TABLE_COLUMNS[tableName];
            const invalidConflict = allowed ? clientCols.filter(c => !allowed.has(c)) : clientCols;
            if (invalidConflict.length > 0) {
              db.exec('ROLLBACK');
              res.status(400).json({ message: `Invalid on_conflict column(s): ${invalidConflict.join(', ')}`, code: '400' });
              return;
            }
            conflictCols = parsed.onConflict;
          }
          if (conflictCols) {
            const conflictColList = conflictCols.split(',').map(s => s.trim());
            const updateCols = columns
              .filter(c => !conflictColList.includes(c))
              .map(c => `"${c}" = excluded."${c}"`)
              .join(', ');
            sql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`;
          } else {
            sql = `INSERT OR REPLACE INTO "${tableName}" (${colList}) VALUES (${placeholders})`;
          }
        } else {
          sql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;
        }

        db.prepare(sql).run(...values);

        // Track the data object for post-insert hooks
        insertedDataObjects.push(data);

        // Fetch the inserted/upserted row if return=representation
        if (parsed.returnRepresentation) {
          if (tableName === 'streak_builds') {
            const fetched = db.prepare(
              `SELECT * FROM "${tableName}" WHERE streak_id = ? AND build_id = ?`
            ).get(data.streak_id as SqlValue, data.build_id as SqlValue);
            if (fetched) insertedRows.push(deserializeRow(fetched as Record<string, unknown>));
          } else {
            const fetched = db.prepare(
              `SELECT * FROM "${tableName}" WHERE id = ?`
            ).get(data.id as SqlValue);
            if (fetched) insertedRows.push(deserializeRow(fetched as Record<string, unknown>));
          }
        }
      }
      db.exec('COMMIT');
    } catch (innerErr) {
      db.exec('ROLLBACK');
      throw innerErr;
    }

    // Fire post-insert hooks (after successful commit)
    for (const data of insertedDataObjects) {
      if (tableName === 'builds') afterBuildInsert(data);
      if (tableName === 'activities') afterActivityInsert(data);
    }

    if (parsed.returnRepresentation) {
      res.status(201).json(insertedRows);
    } else {
      res.status(201).end();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] INSERT error on ${tableName}:`, message);
    const clientMessage = config.nodeEnv === 'production' ? 'Internal server error' : message;
    res.status(500).json({ message: clientMessage, code: '500' });
  }
}

// ---------------------------------------------------------------------------
// PATCH (UPDATE)
// ---------------------------------------------------------------------------

function handleUpdate(req: import('express').Request, res: import('express').Response, tableName: string): void {
  const parsed = parseRequest(req, tableName);
  const bodyData = req.body;

  if (!bodyData || typeof bodyData !== 'object' || Array.isArray(bodyData)) {
    res.status(400).json({ message: 'PATCH body must be a JSON object', code: '400' });
    return;
  }

  if (parsed.whereClauses.length === 0) {
    res.status(400).json({ message: 'UPDATE requires at least one filter', code: '400' });
    return;
  }

  try {
    const data = { ...bodyData } as Record<string, unknown>;

    const colError = validateColumns(tableName, Object.keys(data));
    if (colError) {
      res.status(400).json({ message: colError, code: '400' });
      return;
    }

    // Auto-set updated_at via trigger helper
    const tsFields = TIMESTAMP_DEFAULTS[tableName] || [];
    if (tsFields.includes('updated_at') && !data.updated_at) {
      setUpdatedAt(data);
    }

    // Pre-update hook: if updating support_tickets status, apply status-change logic
    if (tableName === 'support_tickets' && data.status !== undefined && parsed.whereParams.length > 0) {
      // Extract the ticket id from the WHERE clause (first param, typically from id=eq.{uuid})
      const ticketWhereClause = parsed.whereClauses.length > 0
        ? `WHERE ${parsed.whereClauses.join(' AND ')}`
        : '';
      const oldTicket = db.prepare(
        `SELECT * FROM support_tickets ${ticketWhereClause}`
      ).get(...parsed.whereParams) as Record<string, unknown> | undefined;

      if (oldTicket && oldTicket.status !== data.status) {
        // beforeTicketUpdate mutates `data` to add resolved_at/verified_at
        // and inserts a status-change activity record directly
        beforeTicketUpdate(oldTicket, data);
      }
    }

    const setClauses: string[] = [];
    const setParams: SqlValue[] = [];

    for (const [key, value] of Object.entries(data)) {
      setClauses.push(`"${key}" = ?`);
      setParams.push(serializeValue(key, value));
    }

    if (setClauses.length === 0) {
      res.status(400).json({ message: 'No fields to update', code: '400' });
      return;
    }

    // Build WHERE from parsed filters
    const whereClause = parsed.whereClauses.length > 0
      ? `WHERE ${parsed.whereClauses.join(' AND ')}`
      : '';

    const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')} ${whereClause}`;
    const allParams = [...setParams, ...parsed.whereParams];
    db.prepare(sql).run(...allParams);

    if (parsed.returnRepresentation) {
      // Re-fetch updated rows
      const refetchSql = `SELECT * FROM "${tableName}" ${whereClause}`;
      const updatedRows = (db.prepare(refetchSql).all(...parsed.whereParams) as Record<string, unknown>[]).map(deserializeRow);
      res.json(updatedRows);
    } else {
      res.status(204).end();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] UPDATE error on ${tableName}:`, message);
    const clientMessage = config.nodeEnv === 'production' ? 'Internal server error' : message;
    res.status(500).json({ message: clientMessage, code: '500' });
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

function handleDelete(req: import('express').Request, res: import('express').Response, tableName: string): void {
  const parsed = parseRequest(req, tableName);

  if (parsed.whereClauses.length === 0) {
    res.status(400).json({ message: 'DELETE requires at least one filter', code: '400' });
    return;
  }

  try {
    let deletedRows: Record<string, unknown>[] = [];

    // Fetch rows before deleting if return=representation
    if (parsed.returnRepresentation) {
      const whereClause = parsed.whereClauses.length > 0
        ? `WHERE ${parsed.whereClauses.join(' AND ')}`
        : '';
      const selectSql = `SELECT * FROM "${tableName}" ${whereClause}`;
      deletedRows = (db.prepare(selectSql).all(...parsed.whereParams) as Record<string, unknown>[]).map(deserializeRow);
    }

    const whereClause = parsed.whereClauses.length > 0
      ? `WHERE ${parsed.whereClauses.join(' AND ')}`
      : '';
    const sql = `DELETE FROM "${tableName}" ${whereClause}`;
    db.prepare(sql).run(...parsed.whereParams);

    if (parsed.returnRepresentation) {
      res.json(deletedRows);
    } else {
      res.status(204).end();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] DELETE error on ${tableName}:`, message);
    const clientMessage = config.nodeEnv === 'production' ? 'Internal server error' : message;
    res.status(500).json({ message: clientMessage, code: '500' });
  }
}
