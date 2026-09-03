/**
 * ingest-floor -- shared ingest floor-date logic
 *
 * The tracker only wants CI builds from a configurable floor date onward.
 * Jenkins retains ~20 builds of history and Prow returns a rolling window,
 * so without a floor the ingest agents backfill old builds that predate the
 * desired start. This module centralises the floor date and the pure
 * comparison predicate so both ingest agents (and the prune script) agree.
 *
 * Floor is INCLUSIVE: a build whose start timestamp is exactly at
 * INGEST_FLOOR_DATE (00:00:00Z) is kept; only strictly-earlier builds are
 * skipped/pruned.
 */

// Default floor. Overridable via INGEST_FLOOR_DATE (ISO date, e.g. 2026-08-31).
// Set INGEST_FLOOR_DATE='' (empty) to disable the floor entirely.
const DEFAULT_INGEST_FLOOR_DATE = '2026-08-31';

/**
 * Resolve the configured floor as an epoch-ms UTC value, or null when the
 * floor is disabled (INGEST_FLOOR_DATE explicitly set to empty) or unparseable.
 *
 * A bare ISO date like '2026-08-31' is interpreted by Date as UTC midnight,
 * which is exactly the inclusive floor we want.
 */
export function resolveFloorMs(raw: string | undefined): number | null {
  // Explicit empty string disables the floor.
  if (raw === '') return null;
  const value = raw ?? DEFAULT_INGEST_FLOOR_DATE;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    console.warn(
      `[ingest-floor] Invalid INGEST_FLOOR_DATE="${value}" -- floor disabled`,
    );
    return null;
  }
  return ms;
}

/**
 * True when a build's start timestamp is strictly before the floor (i.e. it
 * should be skipped / pruned). Comparison is in UTC epoch-ms.
 *
 * @param startedAt build start timestamp. Accepts an ISO string (Prow
 *   startTime, Jenkins ISO) or an epoch-ms number (Jenkins raw `timestamp`).
 * @param floorMs   floor as epoch-ms, or null to disable (nothing is before).
 */
export function isBeforeFloor(
  startedAt: string | number | null | undefined,
  floorMs: number | null,
): boolean {
  if (floorMs === null) return false;
  if (startedAt === null || startedAt === undefined) return false;
  const startMs =
    typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime();
  // Unparseable timestamp -> don't skip (fail open, keep the build).
  if (!Number.isFinite(startMs)) return false;
  return startMs < floorMs;
}

/** The resolved floor for the current process, read once from the env. */
export const INGEST_FLOOR_MS = resolveFloorMs(process.env.INGEST_FLOOR_DATE);

/** Human-readable floor for log lines. */
export const INGEST_FLOOR_LABEL =
  INGEST_FLOOR_MS === null
    ? 'disabled'
    : new Date(INGEST_FLOOR_MS).toISOString();
