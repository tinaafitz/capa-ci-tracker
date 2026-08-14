/**
 * PostgREST-compatible query parser and SQL generator.
 *
 * Translates PostgREST filter syntax from query parameters into
 * parameterized SQLite SQL. Handles:
 *   - Filter operators: eq, neq, gt, gte, lt, lte, in, ilike, like, is, not, cs
 *   - OR filters: or=(col1.op.val,col2.op.val)
 *   - select with column selection and embedded resources (LEFT JOIN)
 *   - order, limit, offset
 *   - Range header pagination
 *   - Prefer header (count=exact, return=representation, resolution=merge-duplicates)
 *   - Accept header (application/vnd.pgrst.object+json for single-row response)
 */

import type { Request } from 'express';

// ---------------------------------------------------------------------------
// JSON columns — must be parsed from strings when read from SQLite
// ---------------------------------------------------------------------------

const JSON_COLUMNS = new Set([
  'parameters', 'test_failures', 'raw_payload', 'metadata',
  'labels', 'phases', 'upstream_commits', 'error_lines',
  'input_payload', 'output_payload',
]);

function parseJsonValue(key: string, value: unknown): unknown {
  if (JSON_COLUMNS.has(key) && typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Foreign key map for embedded resources
// ---------------------------------------------------------------------------

/** Maps `alias:fk_column` to the target table and the FK column on the source. */
const FK_MAP: Record<string, { table: string; fk: string }> = {
  'builds:build_id':                       { table: 'builds',           fk: 'build_id' },
  'verify_build:verified_in_build_id':     { table: 'builds',           fk: 'verified_in_build_id' },
  'support_tickets:ticket_id':             { table: 'support_tickets',  fk: 'ticket_id' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddedResource {
  alias: string;           // key name in response JSON
  fkColumn: string;        // FK column on the queried table
  targetTable: string;     // table to LEFT JOIN
  columns: string[];       // columns to select from target table
}

export interface ParsedQuery {
  /** Columns for SELECT (empty = *) */
  columns: string[];
  /** Embedded resources (JOIN specs) */
  embeds: EmbeddedResource[];
  /** WHERE clauses (parameterized) */
  whereClauses: string[];
  /** Parameter values for WHERE */
  whereParams: (string | number | null)[];
  /** ORDER BY clauses */
  orderClauses: string[];
  /** LIMIT (from query or Range header) */
  limit: number | null;
  /** OFFSET (from query or Range header) */
  offset: number | null;
  /** Whether to run a count(*) query */
  wantCount: boolean;
  /** Whether to return the inserted/updated rows */
  returnRepresentation: boolean;
  /** Whether this is an upsert (merge-duplicates) */
  isMergeDuplicates: boolean;
  /** Whether the client wants a single object (not array) */
  wantSingleObject: boolean;
  /** Whether this is a HEAD request */
  isHead: boolean;
  /** ON CONFLICT column(s) for upsert */
  onConflict: string | null;
}

// ---------------------------------------------------------------------------
// Reserved query param keys (not filter columns)
// ---------------------------------------------------------------------------

const RESERVED_KEYS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or']);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a PostgREST-style filter expression like "eq.somevalue" into
 * a SQL clause and parameter(s).
 */
function parseFilterOp(
  column: string,
  rawValue: string,
  tableName: string
): { clause: string; params: (string | number | null)[] } {
  // Handle "not." prefix
  if (rawValue.startsWith('not.')) {
    const inner = rawValue.slice(4);
    const result = parseFilterOp(column, inner, tableName);
    // Invert: wrap in NOT (...)
    return { clause: `NOT (${result.clause})`, params: result.params };
  }

  const col = `"${tableName}"."${column}"`;

  if (rawValue.startsWith('eq.')) {
    return { clause: `${col} = ?`, params: [rawValue.slice(3)] };
  }
  if (rawValue.startsWith('neq.')) {
    return { clause: `${col} != ?`, params: [rawValue.slice(4)] };
  }
  if (rawValue.startsWith('gt.')) {
    return { clause: `${col} > ?`, params: [rawValue.slice(3)] };
  }
  if (rawValue.startsWith('gte.')) {
    return { clause: `${col} >= ?`, params: [rawValue.slice(4)] };
  }
  if (rawValue.startsWith('lt.')) {
    return { clause: `${col} < ?`, params: [rawValue.slice(3)] };
  }
  if (rawValue.startsWith('lte.')) {
    return { clause: `${col} <= ?`, params: [rawValue.slice(4)] };
  }
  if (rawValue.startsWith('in.')) {
    // in.(val1,val2,val3)
    const inner = rawValue.slice(3);
    const list = inner.replace(/^\(/, '').replace(/\)$/, '');
    const values = splitCSV(list);
    const placeholders = values.map(() => '?').join(', ');
    return { clause: `${col} IN (${placeholders})`, params: values };
  }
  if (rawValue.startsWith('ilike.')) {
    const pattern = rawValue.slice(6);
    return { clause: `${col} LIKE ? COLLATE NOCASE`, params: [pattern] };
  }
  if (rawValue.startsWith('like.')) {
    const pattern = rawValue.slice(5);
    return { clause: `${col} LIKE ?`, params: [pattern] };
  }
  if (rawValue.startsWith('is.')) {
    const val = rawValue.slice(3);
    if (val === 'null') {
      return { clause: `${col} IS NULL`, params: [] };
    }
    if (val === 'true') {
      return { clause: `${col} = 1`, params: [] };
    }
    if (val === 'false') {
      return { clause: `${col} = 0`, params: [] };
    }
    return { clause: `${col} IS ?`, params: [val] };
  }
  if (rawValue.startsWith('cs.')) {
    // contains -- for JSON array columns
    // cs.["value"] or cs.{"key":"val"}
    const jsonVal = rawValue.slice(3);
    try {
      const parsed = JSON.parse(jsonVal);
      if (Array.isArray(parsed)) {
        // Check that all values in parsed are contained in the column's JSON array
        const checks = parsed.map(() =>
          `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`
        );
        return { clause: `(${checks.join(' AND ')})`, params: parsed.map(String) };
      }
    } catch {
      // Fall through
    }
    return { clause: `${col} LIKE ?`, params: [`%${jsonVal}%`] };
  }

  // Fallback: treat as eq
  return { clause: `${col} = ?`, params: [rawValue] };
}

/**
 * Split a comma-separated string, respecting double-quoted values.
 * PostgREST uses ("val1","val2") for values containing special chars.
 */
function splitCSV(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    result.push(current.trim());
  }
  return result;
}

/**
 * Parse the `or` parameter value: (col1.op.val,col2.op.val)
 *
 * The frontend sends: or=(title.ilike.%foo%,ticket_number.eq.42)
 * We parse each element as column.operator.value
 */
function parseOrFilter(
  orValue: string,
  tableName: string
): { clause: string; params: (string | number | null)[] } {
  // Strip outer parens
  const inner = orValue.replace(/^\(/, '').replace(/\)$/, '');

  // Split on commas, but be careful of nested commas in values
  // PostgREST or-filters have the format: col.op.value,col.op.value
  // We need to split smartly -- each segment is col.op.rest
  const segments: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') parenDepth++;
    if (ch === ')') parenDepth--;
    if (ch === ',' && parenDepth === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current.trim());

  const clauses: string[] = [];
  const allParams: (string | number | null)[] = [];

  for (const segment of segments) {
    // Parse col.op.value -- first dot separates column, rest is op.value
    const firstDot = segment.indexOf('.');
    if (firstDot === -1) continue;

    const column = segment.slice(0, firstDot);
    const opValue = segment.slice(firstDot + 1);

    const result = parseFilterOp(column, opValue, tableName);
    clauses.push(result.clause);
    allParams.push(...result.params);
  }

  if (clauses.length === 0) {
    return { clause: '1=1', params: [] };
  }

  return { clause: `(${clauses.join(' OR ')})`, params: allParams };
}

/**
 * Parse the `select` parameter to extract column names and embedded resources.
 *
 * Examples:
 *   "*" -> columns: ['*'], embeds: []
 *   "id,title" -> columns: ['id','title'], embeds: []
 *   "*,builds:build_id(id,external_id,job_name)" -> columns: ['*'], embeds: [...]
 */
function parseSelect(
  selectParam: string
): { columns: string[]; embeds: EmbeddedResource[] } {
  const columns: string[] = [];
  const embeds: EmbeddedResource[] = [];

  if (!selectParam || selectParam === '*') {
    return { columns: ['*'], embeds: [] };
  }

  // Tokenize: split on commas, but not inside parentheses
  const tokens: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < selectParam.length; i++) {
    const ch = selectParam[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());

  for (const token of tokens) {
    // Check for embedded resource pattern: alias:fk_column(col1,col2,...)
    const embedMatch = token.match(/^(\w+):(\w+)\(([^)]+)\)$/);
    if (embedMatch) {
      const [, alias, fkColumn, colsStr] = embedMatch;
      const key = `${alias}:${fkColumn}`;
      const mapping = FK_MAP[key];
      if (mapping) {
        embeds.push({
          alias,
          fkColumn: mapping.fk,
          targetTable: mapping.table,
          columns: colsStr.split(',').map(c => c.trim()),
        });
      }
      continue;
    }

    columns.push(token);
  }

  if (columns.length === 0) {
    columns.push('*');
  }

  return { columns, embeds };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseRequest(req: Request, tableName: string): ParsedQuery {
  const query = req.query as Record<string, string | string[] | undefined>;
  const headers = req.headers;

  // Parse select
  const selectParam = typeof query.select === 'string' ? query.select : '*';
  const { columns, embeds } = parseSelect(selectParam);

  // Parse filters
  const whereClauses: string[] = [];
  const whereParams: (string | number | null)[] = [];

  for (const [key, rawVal] of Object.entries(query)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (rawVal === undefined) continue;

    const values = Array.isArray(rawVal) ? rawVal : [rawVal];
    for (const val of values) {
      const { clause, params } = parseFilterOp(key, val, tableName);
      whereClauses.push(clause);
      whereParams.push(...params);
    }
  }

  // Parse OR filters
  const orValues = query.or;
  if (orValues) {
    const orList = Array.isArray(orValues) ? orValues : [orValues];
    for (const orVal of orList) {
      const { clause, params } = parseOrFilter(orVal, tableName);
      whereClauses.push(clause);
      whereParams.push(...params);
    }
  }

  // Parse order
  const orderClauses: string[] = [];
  const orderParam = typeof query.order === 'string' ? query.order : null;
  if (orderParam) {
    const parts = orderParam.split(',');
    for (const part of parts) {
      const [col, dir] = part.split('.');
      const direction = dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      // For views/tables, qualify column to avoid ambiguity
      orderClauses.push(`"${tableName}"."${col}" ${direction}`);
    }
  }

  // Parse limit and offset
  let limit: number | null = query.limit ? parseInt(query.limit as string, 10) : null;
  let offset: number | null = query.offset ? parseInt(query.offset as string, 10) : null;

  // Parse Range header (overrides limit/offset)
  const rangeHeader = headers['range'] as string | undefined;
  if (rangeHeader) {
    const match = rangeHeader.match(/^(\d+)-(\d+)$/);
    if (match) {
      const from = parseInt(match[1], 10);
      const to = parseInt(match[2], 10);
      offset = from;
      limit = to - from + 1;
    }
  }

  // Parse Prefer header
  const preferHeader = (headers['prefer'] as string) || '';
  const wantCount = preferHeader.includes('count=exact');
  const returnRepresentation = preferHeader.includes('return=representation');
  const isMergeDuplicates = preferHeader.includes('resolution=merge-duplicates');

  // Parse Accept header
  const acceptHeader = (headers['accept'] as string) || '';
  const wantSingleObject = acceptHeader.includes('application/vnd.pgrst.object+json');

  // HEAD request
  const isHead = req.method === 'HEAD';

  // on_conflict
  const onConflict = typeof query.on_conflict === 'string' ? query.on_conflict : null;

  return {
    columns,
    embeds,
    whereClauses,
    whereParams,
    orderClauses,
    limit,
    offset,
    wantCount,
    returnRepresentation,
    isMergeDuplicates,
    wantSingleObject,
    isHead,
    onConflict,
  };
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

export interface BuiltQuery {
  sql: string;
  params: (string | number | null)[];
  countSql: string | null;
  countParams: (string | number | null)[];
}

/**
 * Build a SELECT query from parsed PostgREST params.
 */
export function buildSelectQuery(
  tableName: string,
  parsed: ParsedQuery
): BuiltQuery {
  // Build column list
  let selectColumns: string;

  if (parsed.embeds.length > 0) {
    // When we have joins, we need to carefully alias columns
    // Main table columns
    const mainCols = parsed.columns.includes('*')
      ? `"${tableName}".*`
      : parsed.columns.map(c => `"${tableName}"."${c}"`).join(', ');

    // Joined table columns (aliased to avoid conflicts)
    const joinCols = parsed.embeds.map(e =>
      e.columns.map(c => `"${e.alias}"."${c}" AS "${e.alias}__${c}"`).join(', ')
    ).join(', ');

    selectColumns = `${mainCols}, ${joinCols}`;
  } else {
    selectColumns = parsed.columns.includes('*')
      ? '*'
      : parsed.columns.map(c => `"${c}"`).join(', ');
  }

  // Build FROM + JOINs
  let fromClause = `"${tableName}"`;
  if (parsed.embeds.length > 0) {
    for (const embed of parsed.embeds) {
      fromClause += ` LEFT JOIN "${embed.targetTable}" AS "${embed.alias}" ON "${embed.alias}"."id" = "${tableName}"."${embed.fkColumn}"`;
    }
  }

  // Build WHERE
  const whereClause = parsed.whereClauses.length > 0
    ? `WHERE ${parsed.whereClauses.join(' AND ')}`
    : '';

  // Build ORDER BY
  const orderClause = parsed.orderClauses.length > 0
    ? `ORDER BY ${parsed.orderClauses.join(', ')}`
    : '';

  // Build LIMIT/OFFSET
  const limitClause = parsed.limit !== null ? `LIMIT ${parsed.limit}` : '';
  const offsetClause = parsed.offset !== null ? `OFFSET ${parsed.offset}` : '';

  const sql = [
    `SELECT ${selectColumns}`,
    `FROM ${fromClause}`,
    whereClause,
    orderClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  // Count query (uses same WHERE but no LIMIT/OFFSET/ORDER)
  let countSql: string | null = null;
  const countParams = [...parsed.whereParams];
  if (parsed.wantCount || parsed.isHead) {
    countSql = [
      `SELECT count(*) AS total`,
      `FROM ${fromClause}`,
      whereClause,
    ].filter(Boolean).join(' ');
  }

  return { sql, params: [...parsed.whereParams], countSql, countParams };
}

/**
 * Reshape flat row results to nest embedded resource columns under their alias key.
 *
 * Columns like "builds__id", "builds__job_name" get moved into a "builds" sub-object.
 */
export function nestEmbeddedResults(
  rows: Record<string, unknown>[],
  embeds: EmbeddedResource[]
): Record<string, unknown>[] {
  if (embeds.length === 0) return rows;

  return rows.map(row => {
    const result: Record<string, unknown> = {};
    const embedData: Record<string, Record<string, unknown>> = {};

    // Initialize embed containers
    for (const embed of embeds) {
      embedData[embed.alias] = {};
    }

    for (const [key, value] of Object.entries(row)) {
      let isEmbed = false;
      for (const embed of embeds) {
        const prefix = `${embed.alias}__`;
        if (key.startsWith(prefix)) {
          const realCol = key.slice(prefix.length);
          embedData[embed.alias][realCol] = parseJsonValue(realCol, value);
          isEmbed = true;
          break;
        }
      }
      if (!isEmbed) {
        result[key] = value;
      }
    }

    // Attach embedded data (null if the joined row was empty)
    for (const embed of embeds) {
      const data = embedData[embed.alias];
      const hasData = Object.values(data).some(v => v !== null);
      result[embed.alias] = hasData ? data : null;
    }

    return result;
  });
}
