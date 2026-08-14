/**
 * Unit tests for the PostgREST-compatible query parser and SQL builder.
 *
 * These are pure logic tests -- no database or HTTP server needed.
 * We construct minimal Express-like Request objects to exercise
 * parseRequest() and buildSelectQuery().
 */

import { describe, it, expect } from 'vitest';
import { parseRequest, buildSelectQuery, nestEmbeddedResults } from '../api/postgrest-compat.js';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Helper: build a minimal Express-like Request for testing
// ---------------------------------------------------------------------------

interface MockRequestOpts {
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  method?: string;
}

function mockRequest(opts: MockRequestOpts = {}): Request {
  return {
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    method: opts.method ?? 'GET',
  } as unknown as Request;
}

// ===================================================================
// parseRequest
// ===================================================================

describe('parseRequest', () => {
  // -----------------------------------------------------------------
  // Filter operators
  // -----------------------------------------------------------------

  describe('filter operators', () => {
    it('parses eq filter', () => {
      const req = mockRequest({ query: { status: 'eq.failure' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses).toHaveLength(1);
      expect(parsed.whereClauses[0]).toBe('"builds"."status" = ?');
      expect(parsed.whereParams).toEqual(['failure']);
    });

    it('parses neq filter', () => {
      const req = mockRequest({ query: { status: 'neq.success' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."status" != ?');
      expect(parsed.whereParams).toEqual(['success']);
    });

    it('parses gt filter', () => {
      const req = mockRequest({ query: { fail_count: 'gt.5' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."fail_count" > ?');
      expect(parsed.whereParams).toEqual(['5']);
    });

    it('parses gte filter', () => {
      const req = mockRequest({ query: { fail_count: 'gte.10' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."fail_count" >= ?');
      expect(parsed.whereParams).toEqual(['10']);
    });

    it('parses lt filter', () => {
      const req = mockRequest({ query: { fail_count: 'lt.3' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."fail_count" < ?');
      expect(parsed.whereParams).toEqual(['3']);
    });

    it('parses lte filter', () => {
      const req = mockRequest({ query: { fail_count: 'lte.0' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."fail_count" <= ?');
      expect(parsed.whereParams).toEqual(['0']);
    });

    it('parses in filter with multiple values', () => {
      const req = mockRequest({ query: { status: 'in.(failure,aborted,unstable)' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."status" IN (?, ?, ?)');
      expect(parsed.whereParams).toEqual(['failure', 'aborted', 'unstable']);
    });

    it('parses in filter with single value', () => {
      const req = mockRequest({ query: { status: 'in.(failure)' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."status" IN (?)');
      expect(parsed.whereParams).toEqual(['failure']);
    });

    it('parses ilike filter', () => {
      const req = mockRequest({ query: { job_name: 'ilike.%nightly%' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."job_name" LIKE ? COLLATE NOCASE');
      expect(parsed.whereParams).toEqual(['%nightly%']);
    });

    it('parses is.null filter', () => {
      const req = mockRequest({ query: { resolved_at: 'is.null' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses[0]).toBe('"support_tickets"."resolved_at" IS NULL');
      expect(parsed.whereParams).toEqual([]);
    });

    it('parses is.true filter', () => {
      const req = mockRequest({ query: { log_fetched: 'is.true' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."log_fetched" = 1');
      expect(parsed.whereParams).toEqual([]);
    });

    it('parses is.false filter', () => {
      const req = mockRequest({ query: { log_fetched: 'is.false' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."log_fetched" = 0');
      expect(parsed.whereParams).toEqual([]);
    });

    it('parses not.in filter', () => {
      const req = mockRequest({ query: { status: 'not.in.(resolved,verified)' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses[0]).toBe('NOT ("support_tickets"."status" IN (?, ?))');
      expect(parsed.whereParams).toEqual(['resolved', 'verified']);
    });

    it('parses not.is.null filter', () => {
      const req = mockRequest({ query: { resolved_at: 'not.is.null' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses[0]).toBe('NOT ("support_tickets"."resolved_at" IS NULL)');
      expect(parsed.whereParams).toEqual([]);
    });

    it('parses not.eq filter', () => {
      const req = mockRequest({ query: { status: 'not.eq.success' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('NOT ("builds"."status" = ?)');
      expect(parsed.whereParams).toEqual(['success']);
    });

    it('handles multiple filters as AND', () => {
      const req = mockRequest({
        query: { status: 'eq.failure', source: 'eq.prow' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses).toHaveLength(2);
      expect(parsed.whereParams).toEqual(['failure', 'prow']);
    });

    it('treats unknown operator as eq fallback', () => {
      const req = mockRequest({ query: { status: 'failure' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses[0]).toBe('"builds"."status" = ?');
      expect(parsed.whereParams).toEqual(['failure']);
    });
  });

  // -----------------------------------------------------------------
  // OR filter
  // -----------------------------------------------------------------

  describe('or filter', () => {
    it('parses or=(col1.op.val,col2.op.val)', () => {
      const req = mockRequest({
        query: { or: '(title.ilike.%cluster%,ticket_number.eq.42)' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses).toHaveLength(1);
      expect(parsed.whereClauses[0]).toContain('OR');
      expect(parsed.whereParams).toEqual(['%cluster%', '42']);
    });

    it('produces valid OR clause structure', () => {
      const req = mockRequest({
        query: { or: '(status.eq.new,status.eq.investigating)' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses[0]).toBe(
        '("support_tickets"."status" = ? OR "support_tickets"."status" = ?)'
      );
    });

    it('handles or filter combined with regular filters', () => {
      const req = mockRequest({
        query: {
          severity: 'eq.nightly_blocker',
          or: '(status.eq.new,status.eq.investigating)',
        },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.whereClauses).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------
  // Order
  // -----------------------------------------------------------------

  describe('order', () => {
    it('parses order=col.desc', () => {
      const req = mockRequest({ query: { order: 'created_at.desc' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.orderClauses).toEqual(['"builds"."created_at" DESC']);
    });

    it('parses order=col.asc', () => {
      const req = mockRequest({ query: { order: 'ticket_number.asc' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.orderClauses).toEqual(['"support_tickets"."ticket_number" ASC']);
    });

    it('defaults to ASC when direction is omitted', () => {
      const req = mockRequest({ query: { order: 'title' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.orderClauses).toEqual(['"support_tickets"."title" ASC']);
    });

    it('parses multiple order columns', () => {
      const req = mockRequest({
        query: { order: 'severity.desc,created_at.desc' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.orderClauses).toHaveLength(2);
      expect(parsed.orderClauses[0]).toContain('DESC');
      expect(parsed.orderClauses[1]).toContain('DESC');
    });
  });

  // -----------------------------------------------------------------
  // Select column selection
  // -----------------------------------------------------------------

  describe('select', () => {
    it('parses select=col1,col2', () => {
      const req = mockRequest({ query: { select: 'id,title,status' } });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.columns).toEqual(['id', 'title', 'status']);
      expect(parsed.embeds).toHaveLength(0);
    });

    it('parses select=* as all columns', () => {
      const req = mockRequest({ query: { select: '*' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.columns).toEqual(['*']);
    });

    it('defaults to all columns when select is absent', () => {
      const req = mockRequest({ query: {} });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.columns).toEqual(['*']);
    });
  });

  // -----------------------------------------------------------------
  // Range header pagination
  // -----------------------------------------------------------------

  describe('Range header', () => {
    it('parses Range: 0-19 into limit=20 offset=0', () => {
      const req = mockRequest({ headers: { range: '0-19' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.limit).toBe(20);
      expect(parsed.offset).toBe(0);
    });

    it('parses Range: 20-39 into limit=20 offset=20', () => {
      const req = mockRequest({ headers: { range: '20-39' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.limit).toBe(20);
      expect(parsed.offset).toBe(20);
    });

    it('parses Range: 0-0 into limit=1 offset=0 (single row)', () => {
      const req = mockRequest({ headers: { range: '0-0' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.limit).toBe(1);
      expect(parsed.offset).toBe(0);
    });

    it('overrides query limit/offset with Range header', () => {
      const req = mockRequest({
        query: { limit: '50', offset: '10' },
        headers: { range: '0-9' },
      });
      const parsed = parseRequest(req, 'builds');

      // Range header should win
      expect(parsed.limit).toBe(10);
      expect(parsed.offset).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  // Prefer header
  // -----------------------------------------------------------------

  describe('Prefer header', () => {
    it('sets wantCount=true for count=exact', () => {
      const req = mockRequest({ headers: { prefer: 'count=exact' } });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.wantCount).toBe(true);
    });

    it('sets returnRepresentation=true for return=representation', () => {
      const req = mockRequest({
        headers: { prefer: 'return=representation' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.returnRepresentation).toBe(true);
    });

    it('sets isMergeDuplicates=true for resolution=merge-duplicates', () => {
      const req = mockRequest({
        headers: { prefer: 'resolution=merge-duplicates' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.isMergeDuplicates).toBe(true);
    });

    it('parses multiple Prefer directives', () => {
      const req = mockRequest({
        headers: { prefer: 'return=representation, count=exact' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.wantCount).toBe(true);
      expect(parsed.returnRepresentation).toBe(true);
    });

    it('defaults to all false when no Prefer header', () => {
      const req = mockRequest({});
      const parsed = parseRequest(req, 'builds');

      expect(parsed.wantCount).toBe(false);
      expect(parsed.returnRepresentation).toBe(false);
      expect(parsed.isMergeDuplicates).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // Embedded resources
  // -----------------------------------------------------------------

  describe('embedded resources', () => {
    it('parses select=*,builds:build_id(id,job_name)', () => {
      const req = mockRequest({
        query: { select: '*,builds:build_id(id,job_name)' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.columns).toEqual(['*']);
      expect(parsed.embeds).toHaveLength(1);
      expect(parsed.embeds[0]).toEqual({
        alias: 'builds',
        fkColumn: 'build_id',
        targetTable: 'builds',
        columns: ['id', 'job_name'],
      });
    });

    it('parses embedded resource with multiple columns', () => {
      const req = mockRequest({
        query: { select: 'id,title,builds:build_id(id,external_id,job_name,status)' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      expect(parsed.columns).toEqual(['id', 'title']);
      expect(parsed.embeds[0].columns).toEqual(['id', 'external_id', 'job_name', 'status']);
    });

    it('ignores unknown FK mappings', () => {
      const req = mockRequest({
        query: { select: '*,unknown:unknown_id(id)' },
      });
      const parsed = parseRequest(req, 'support_tickets');

      // Unknown embed is silently dropped; columns remain ['*']
      expect(parsed.embeds).toHaveLength(0);
      expect(parsed.columns).toEqual(['*']);
    });
  });

  // -----------------------------------------------------------------
  // Accept header
  // -----------------------------------------------------------------

  describe('Accept header', () => {
    it('sets wantSingleObject for pgrst.object+json', () => {
      const req = mockRequest({
        headers: { accept: 'application/vnd.pgrst.object+json' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.wantSingleObject).toBe(true);
    });

    it('defaults to false for regular Accept', () => {
      const req = mockRequest({
        headers: { accept: 'application/json' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.wantSingleObject).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // HEAD request
  // -----------------------------------------------------------------

  describe('HEAD request', () => {
    it('sets isHead=true for HEAD method', () => {
      const req = mockRequest({ method: 'HEAD' });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.isHead).toBe(true);
    });

    it('sets isHead=false for GET method', () => {
      const req = mockRequest({ method: 'GET' });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.isHead).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // on_conflict
  // -----------------------------------------------------------------

  describe('on_conflict', () => {
    it('parses on_conflict query param', () => {
      const req = mockRequest({
        query: { on_conflict: 'source,external_id,job_name' },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.onConflict).toBe('source,external_id,job_name');
    });

    it('defaults to null when absent', () => {
      const req = mockRequest({});
      const parsed = parseRequest(req, 'builds');

      expect(parsed.onConflict).toBeNull();
    });
  });

  // -----------------------------------------------------------------
  // Reserved keys are not treated as filters
  // -----------------------------------------------------------------

  describe('reserved keys', () => {
    it('does not create filters for select, order, limit, offset', () => {
      const req = mockRequest({
        query: {
          select: 'id,title',
          order: 'created_at.desc',
          limit: '10',
          offset: '5',
        },
      });
      const parsed = parseRequest(req, 'builds');

      expect(parsed.whereClauses).toHaveLength(0);
      expect(parsed.whereParams).toHaveLength(0);
    });
  });
});

// ===================================================================
// buildSelectQuery
// ===================================================================

describe('buildSelectQuery', () => {
  it('builds a simple SELECT * FROM table', () => {
    const req = mockRequest({});
    const parsed = parseRequest(req, 'builds');
    const { sql, params } = buildSelectQuery('builds', parsed);

    expect(sql).toBe('SELECT * FROM "builds"');
    expect(params).toEqual([]);
  });

  it('builds SELECT with specific columns', () => {
    const req = mockRequest({ query: { select: 'id,job_name,status' } });
    const parsed = parseRequest(req, 'builds');
    const { sql } = buildSelectQuery('builds', parsed);

    expect(sql).toBe('SELECT "id", "job_name", "status" FROM "builds"');
  });

  it('builds SELECT with WHERE clause', () => {
    const req = mockRequest({ query: { status: 'eq.failure' } });
    const parsed = parseRequest(req, 'builds');
    const { sql, params } = buildSelectQuery('builds', parsed);

    expect(sql).toBe('SELECT * FROM "builds" WHERE "builds"."status" = ?');
    expect(params).toEqual(['failure']);
  });

  it('builds SELECT with multiple WHERE clauses joined by AND', () => {
    const req = mockRequest({
      query: { status: 'eq.failure', source: 'eq.prow' },
    });
    const parsed = parseRequest(req, 'builds');
    const { sql, params } = buildSelectQuery('builds', parsed);

    expect(sql).toContain('WHERE');
    expect(sql).toContain('AND');
    expect(params).toEqual(['failure', 'prow']);
  });

  it('builds SELECT with ORDER BY', () => {
    const req = mockRequest({ query: { order: 'created_at.desc' } });
    const parsed = parseRequest(req, 'builds');
    const { sql } = buildSelectQuery('builds', parsed);

    expect(sql).toContain('ORDER BY "builds"."created_at" DESC');
  });

  it('builds SELECT with LIMIT and OFFSET', () => {
    const req = mockRequest({ headers: { range: '10-19' } });
    const parsed = parseRequest(req, 'builds');
    const { sql } = buildSelectQuery('builds', parsed);

    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('OFFSET 10');
  });

  it('builds a count query when wantCount is true', () => {
    const req = mockRequest({ headers: { prefer: 'count=exact' } });
    const parsed = parseRequest(req, 'builds');
    const { countSql, countParams } = buildSelectQuery('builds', parsed);

    expect(countSql).toBe('SELECT count(*) AS total FROM "builds"');
    expect(countParams).toEqual([]);
  });

  it('builds a count query when isHead is true', () => {
    const req = mockRequest({ method: 'HEAD' });
    const parsed = parseRequest(req, 'builds');
    const { countSql } = buildSelectQuery('builds', parsed);

    expect(countSql).not.toBeNull();
    expect(countSql).toContain('count(*)');
  });

  it('includes WHERE in count query but not LIMIT/OFFSET', () => {
    const req = mockRequest({
      query: { status: 'eq.failure' },
      headers: { range: '0-9', prefer: 'count=exact' },
    });
    const parsed = parseRequest(req, 'builds');
    const { countSql } = buildSelectQuery('builds', parsed);

    expect(countSql).toContain('WHERE');
    expect(countSql).not.toContain('LIMIT');
    expect(countSql).not.toContain('OFFSET');
  });

  it('builds LEFT JOIN for embedded resources', () => {
    const req = mockRequest({
      query: { select: '*,builds:build_id(id,job_name)' },
    });
    const parsed = parseRequest(req, 'support_tickets');
    const { sql } = buildSelectQuery('support_tickets', parsed);

    expect(sql).toContain('LEFT JOIN "builds" AS "builds"');
    expect(sql).toContain('ON "builds"."id" = "support_tickets"."build_id"');
    expect(sql).toContain('"builds"."id" AS "builds__id"');
    expect(sql).toContain('"builds"."job_name" AS "builds__job_name"');
  });

  it('does not include count query when neither wantCount nor isHead', () => {
    const req = mockRequest({});
    const parsed = parseRequest(req, 'builds');
    const { countSql } = buildSelectQuery('builds', parsed);

    expect(countSql).toBeNull();
  });
});

// ===================================================================
// nestEmbeddedResults
// ===================================================================

describe('nestEmbeddedResults', () => {
  it('returns rows unchanged when no embeds', () => {
    const rows = [{ id: '1', title: 'Test' }];
    const result = nestEmbeddedResults(rows, []);

    expect(result).toEqual(rows);
  });

  it('nests aliased columns under the embed key', () => {
    const rows = [
      {
        id: 't1',
        title: 'Ticket',
        builds__id: 'b1',
        builds__job_name: 'nightly-e2e',
      },
    ];

    const embeds = [
      {
        alias: 'builds',
        fkColumn: 'build_id',
        targetTable: 'builds',
        columns: ['id', 'job_name'],
      },
    ];

    const result = nestEmbeddedResults(rows, embeds);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
    expect(result[0].title).toBe('Ticket');
    expect(result[0]).not.toHaveProperty('builds__id');
    expect(result[0]).not.toHaveProperty('builds__job_name');
    expect(result[0].builds).toEqual({
      id: 'b1',
      job_name: 'nightly-e2e',
    });
  });

  it('sets embed to null when all joined columns are null (LEFT JOIN miss)', () => {
    const rows = [
      {
        id: 't1',
        title: 'Orphan ticket',
        builds__id: null,
        builds__job_name: null,
      },
    ];

    const embeds = [
      {
        alias: 'builds',
        fkColumn: 'build_id',
        targetTable: 'builds',
        columns: ['id', 'job_name'],
      },
    ];

    const result = nestEmbeddedResults(rows, embeds);

    expect(result[0].builds).toBeNull();
  });

  it('handles multiple rows with mixed null and present embeds', () => {
    const rows = [
      { id: 't1', builds__id: 'b1', builds__job_name: 'job1' },
      { id: 't2', builds__id: null, builds__job_name: null },
    ];

    const embeds = [
      {
        alias: 'builds',
        fkColumn: 'build_id',
        targetTable: 'builds',
        columns: ['id', 'job_name'],
      },
    ];

    const result = nestEmbeddedResults(rows, embeds);

    expect(result[0].builds).toEqual({ id: 'b1', job_name: 'job1' });
    expect(result[1].builds).toBeNull();
  });

  it('parses JSON columns in embedded results', () => {
    const rows = [
      {
        id: 't1',
        builds__id: 'b1',
        builds__test_failures: '[{"name":"test1"}]',
      },
    ];

    const embeds = [
      {
        alias: 'builds',
        fkColumn: 'build_id',
        targetTable: 'builds',
        columns: ['id', 'test_failures'],
      },
    ];

    const result = nestEmbeddedResults(rows, embeds);

    // test_failures is in JSON_COLUMNS, so it should be parsed
    expect(result[0].builds).toEqual({
      id: 'b1',
      test_failures: [{ name: 'test1' }],
    });
  });
});
