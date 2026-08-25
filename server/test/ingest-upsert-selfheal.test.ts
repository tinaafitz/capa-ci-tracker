/**
 * Integration tests for the self-heal upsert semantics.
 *
 * Regression guard for the bug where a build first classified as infra_* by an
 * older classifier could never be corrected on re-ingest: the reclassify gate
 * skipped infra_* rows and the upsert's don't-downgrade CASE vetoed the fix,
 * so a real product test failure stayed hidden as infra until a manual backfill.
 *
 * These tests exercise the two upsert SQL forms against an in-memory DB:
 *   - Jenkins upsert (authoritative: takes excluded.* unconditionally)
 *   - Prow don't-downgrade upsert (bare-feed re-ingest must not clobber infra)
 *   - Prow authoritative upsert (GCS pass may overwrite a stale infra label)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// The exact upsert bodies used by the ingest agents. Kept in sync with
// server/agents/ingest-jenkins.ts and ingest-prow.ts.
const COLUMNS = `id, source, external_id, job_name, job_url, status,
  pass_count, fail_count, skip_count, total_count, duration_ms,
  started_at, finished_at, ocp_version, parameters, test_failures,
  raw_payload, failure_class, failure_reason, is_infra, created_at, updated_at`;
const PLACEHOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

// Authoritative: fresh classification wins unconditionally (Jenkins always,
// Prow when GCS-enriched this pass).
const AUTHORITATIVE_UPSERT = `
  INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})
  ON CONFLICT (source, external_id, job_name) DO UPDATE SET
    status=excluded.status, fail_count=excluded.fail_count,
    updated_at=excluded.updated_at,
    failure_class = excluded.failure_class,
    failure_reason = excluded.failure_reason,
    is_infra = excluded.is_infra
`;

// Don't-downgrade: a stored infra label survives a weaker incoming class
// (Prow bare-feed re-ingest).
const DONT_DOWNGRADE_UPSERT = `
  INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})
  ON CONFLICT (source, external_id, job_name) DO UPDATE SET
    status=excluded.status, fail_count=excluded.fail_count,
    updated_at=excluded.updated_at,
    failure_class = CASE
      WHEN excluded.is_infra = 1 THEN excluded.failure_class
      WHEN builds.is_infra = 1   THEN builds.failure_class
      ELSE excluded.failure_class
    END,
    failure_reason = CASE
      WHEN excluded.is_infra = 1 THEN excluded.failure_reason
      WHEN builds.is_infra = 1   THEN builds.failure_reason
      ELSE excluded.failure_reason
    END,
    is_infra = CASE
      WHEN excluded.is_infra = 1 THEN 1
      WHEN builds.is_infra = 1   THEN 1
      ELSE excluded.is_infra
    END
`;

let db: DatabaseSync;

type SqlVal = string | number | null;

function row(overrides: Record<string, SqlVal> = {}): SqlVal[] {
  const base: Record<string, SqlVal> = {
    id: 'b1', source: 'x', external_id: '330', job_name: 'capi_tests',
    job_url: null, status: 'failure', pass_count: 0, fail_count: 0,
    skip_count: 0, total_count: 0, duration_ms: null, started_at: null,
    finished_at: null, ocp_version: null, parameters: '{}', test_failures: '[]',
    raw_payload: '{}', failure_class: null, failure_reason: null, is_infra: 0,
    created_at: 't0', updated_at: 't0',
  };
  const merged = { ...base, ...overrides };
  return [
    merged.id, merged.source, merged.external_id, merged.job_name, merged.job_url,
    merged.status, merged.pass_count, merged.fail_count, merged.skip_count,
    merged.total_count, merged.duration_ms, merged.started_at, merged.finished_at,
    merged.ocp_version, merged.parameters, merged.test_failures, merged.raw_payload,
    merged.failure_class, merged.failure_reason, merged.is_infra,
    merged.created_at, merged.updated_at,
  ];
}

function getBuild(): { failure_class: string | null; is_infra: number } {
  return db.prepare(
    `SELECT failure_class, is_infra FROM builds WHERE external_id='330'`,
  ).get() as { failure_class: string | null; is_infra: number };
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE builds (
      id TEXT PRIMARY KEY, source TEXT, external_id TEXT, job_name TEXT,
      job_url TEXT, status TEXT, pass_count INTEGER, fail_count INTEGER,
      skip_count INTEGER, total_count INTEGER, duration_ms INTEGER,
      started_at TEXT, finished_at TEXT, ocp_version TEXT, parameters TEXT,
      test_failures TEXT, raw_payload TEXT, failure_class TEXT,
      failure_reason TEXT, is_infra INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, updated_at TEXT,
      UNIQUE (source, external_id, job_name)
    );
  `);
});

describe('authoritative upsert (Jenkins / Prow-with-GCS)', () => {
  it('downgrades a stale infra_auth label to product_test_failure', () => {
    // Row was written by an old classifier: infra_auth, null reason (the #330 case).
    db.prepare(`INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})`).run(
      ...row({ source: 'jenkins', failure_class: 'infra_auth', is_infra: 1 }),
    );
    // Re-ingest with the corrected classification.
    db.prepare(AUTHORITATIVE_UPSERT).run(
      ...row({
        source: 'jenkins', id: 'b2', fail_count: 4,
        failure_class: 'product_test_failure', failure_reason: null, is_infra: 0,
        updated_at: 't1',
      }),
    );
    expect(getBuild()).toEqual({ failure_class: 'product_test_failure', is_infra: 0 });
  });

  it('still records a genuine infra classification', () => {
    db.prepare(`INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})`).run(
      ...row({ source: 'jenkins', failure_class: 'product_test_failure', is_infra: 0 }),
    );
    db.prepare(AUTHORITATIVE_UPSERT).run(
      ...row({
        source: 'jenkins', id: 'b2',
        failure_class: 'infra_lease', failure_reason: 'boskos', is_infra: 1,
        updated_at: 't1',
      }),
    );
    expect(getBuild()).toEqual({ failure_class: 'infra_lease', is_infra: 1 });
  });
});

describe('dont-downgrade upsert (Prow bare-feed re-ingest)', () => {
  it('preserves a GCS-confirmed infra label against a weaker bare-feed class', () => {
    // Prior GCS pass confirmed infra_lease (has a reason).
    db.prepare(`INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})`).run(
      ...row({ source: 'prow', failure_class: 'infra_lease', failure_reason: 'boskos', is_infra: 1 }),
    );
    // Bare-feed re-ingest sees only "Job failed." → would classify unknown/product.
    db.prepare(DONT_DOWNGRADE_UPSERT).run(
      ...row({
        source: 'prow', id: 'b2',
        failure_class: 'unknown', failure_reason: null, is_infra: 0,
        updated_at: 't1',
      }),
    );
    expect(getBuild()).toEqual({ failure_class: 'infra_lease', is_infra: 1 });
  });

  it('lets a fresh infra class overwrite (upgrade path)', () => {
    db.prepare(`INSERT INTO builds (${COLUMNS}) VALUES (${PLACEHOLDERS})`).run(
      ...row({ source: 'prow', failure_class: 'unknown', is_infra: 0 }),
    );
    db.prepare(DONT_DOWNGRADE_UPSERT).run(
      ...row({
        source: 'prow', id: 'b2',
        failure_class: 'infra_timeout', failure_reason: 'context deadline exceeded', is_infra: 1,
        updated_at: 't1',
      }),
    );
    expect(getBuild()).toEqual({ failure_class: 'infra_timeout', is_infra: 1 });
  });
});
