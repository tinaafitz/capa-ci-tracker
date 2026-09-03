/**
 * Unit tests for the shared ingest floor-date predicate.
 *
 * Pure-function tests -- no network, no database. Covers the three cases that
 * matter for the 2026-08-31 inclusive floor:
 *   - a build BEFORE the floor is skipped
 *   - a build EXACTLY on 2026-08-31T00:00:00Z is kept (floor is inclusive)
 *   - a build AFTER the floor is kept
 * Plus the timestamp-format robustness (ISO string vs Jenkins epoch-ms) and
 * the disable/resolve behaviour.
 */

import { describe, it, expect } from 'vitest';
import { isBeforeFloor, resolveFloorMs } from '../agents/ingest-floor.js';

const FLOOR = '2026-08-31';
const floorMs = resolveFloorMs(FLOOR)!;

describe('resolveFloorMs', () => {
  it('resolves the default (undefined) floor to 2026-08-31T00:00:00Z', () => {
    expect(resolveFloorMs(undefined)).toBe(Date.parse('2026-08-31T00:00:00Z'));
  });

  it('interprets a bare ISO date as UTC midnight', () => {
    expect(resolveFloorMs('2026-08-31')).toBe(Date.parse('2026-08-31T00:00:00Z'));
  });

  it('disables the floor for an explicit empty string', () => {
    expect(resolveFloorMs('')).toBeNull();
  });

  it('disables the floor for an unparseable value', () => {
    expect(resolveFloorMs('not-a-date')).toBeNull();
  });
});

describe('isBeforeFloor (ISO string timestamps -- Prow)', () => {
  it('skips a build before the floor', () => {
    expect(isBeforeFloor('2026-08-27T12:00:00Z', floorMs)).toBe(true);
  });

  it('keeps a build exactly on 2026-08-31T00:00:00Z (inclusive floor)', () => {
    expect(isBeforeFloor('2026-08-31T00:00:00Z', floorMs)).toBe(false);
  });

  it('keeps a build after the floor', () => {
    expect(isBeforeFloor('2026-09-01T04:00:00Z', floorMs)).toBe(false);
  });

  it('skips a build one millisecond before the floor', () => {
    expect(isBeforeFloor('2026-08-30T23:59:59.999Z', floorMs)).toBe(true);
  });
});

describe('isBeforeFloor (epoch-ms timestamps -- Jenkins)', () => {
  it('skips a build before the floor', () => {
    expect(isBeforeFloor(Date.parse('2026-08-16T00:00:00Z'), floorMs)).toBe(true);
  });

  it('keeps a build exactly on the floor', () => {
    expect(isBeforeFloor(Date.parse('2026-08-31T00:00:00Z'), floorMs)).toBe(false);
  });

  it('keeps a build after the floor', () => {
    expect(isBeforeFloor(Date.parse('2026-09-02T00:00:00Z'), floorMs)).toBe(false);
  });
});

describe('isBeforeFloor (edge cases)', () => {
  it('keeps everything when the floor is disabled (null)', () => {
    expect(isBeforeFloor('2020-01-01T00:00:00Z', null)).toBe(false);
  });

  it('keeps a build with a null/undefined timestamp (fail open)', () => {
    expect(isBeforeFloor(null, floorMs)).toBe(false);
    expect(isBeforeFloor(undefined, floorMs)).toBe(false);
  });

  it('keeps a build with an unparseable timestamp (fail open)', () => {
    expect(isBeforeFloor('garbage', floorMs)).toBe(false);
  });
});
