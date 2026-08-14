/**
 * Shared constants for the CAPA CI Tracker server.
 */

/** Column names that store JSON strings in SQLite and need parse/serialize handling. */
export const JSON_COLUMNS = new Set([
  'parameters', 'test_failures', 'raw_payload', 'metadata',
  'labels', 'phases', 'upstream_commits', 'error_lines',
  'input_payload', 'output_payload',
]);
