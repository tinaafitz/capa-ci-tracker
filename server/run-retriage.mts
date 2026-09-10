/**
 * Re-derive ocp_version and failure classification on an already-ingested build
 * using the current rules, drop any ticket it produced, and re-run triage so
 * the ticket is rebuilt with the current title/description/diagnosis logic.
 *
 * Usage: tsx run-retriage.mts <external_id>
 */
import { db } from './db/connection.js';
import { extractOcpVersion } from './agents/ingest-jenkins.js';
import { classifyFailure } from './agents/classify-failure.js';
import { run as triage } from './agents/triage.js';

const externalId = process.argv[2];
if (!externalId) {
  console.error('usage: tsx run-retriage.mts <external_id>');
  process.exit(1);
}

const build = db
  .prepare(
    `SELECT id, parameters, ocp_version, status, job_name, fail_count, test_failures,
            failure_class, is_infra
     FROM builds WHERE external_id = ?`,
  )
  .get(externalId) as
  | {
      id: string;
      parameters: string;
      ocp_version: string | null;
      status: string;
      job_name: string;
      fail_count: number;
      test_failures: string;
      failure_class: string | null;
      is_infra: number;
    }
  | undefined;

if (!build) {
  console.error(`No build with external_id ${externalId}`);
  process.exit(1);
}

const ocp = extractOcpVersion(JSON.parse(build.parameters || '{}'));
if (ocp && ocp !== build.ocp_version) {
  db.prepare('UPDATE builds SET ocp_version = ?, updated_at = ? WHERE id = ?').run(
    ocp,
    new Date().toISOString(),
    build.id,
  );
  console.log(`ocp_version: ${JSON.stringify(build.ocp_version)} -> ${ocp}`);
}

// Re-classify with the current rules. Ingest deliberately preserves an existing
// build's classification, so a rule added after ingest never reaches old rows.
const testFailures = JSON.parse(build.test_failures || '[]') as {
  name?: string;
  errorMessage?: string;
}[];
const classification = classifyFailure({
  status: build.status,
  jobName: build.job_name,
  reason: testFailures[0]?.errorMessage || testFailures[0]?.name,
  failCount: build.fail_count,
});
if (
  classification.failure_class !== build.failure_class ||
  classification.is_infra !== build.is_infra
) {
  db.prepare(
    'UPDATE builds SET failure_class = ?, failure_reason = ?, is_infra = ?, updated_at = ? WHERE id = ?',
  ).run(
    classification.failure_class,
    classification.failure_reason,
    classification.is_infra,
    new Date().toISOString(),
    build.id,
  );
  console.log(
    `failure_class: ${JSON.stringify(build.failure_class)} -> ${classification.failure_class} (is_infra ${build.is_infra} -> ${classification.is_infra})`,
  );
}

const removed = db
  .prepare('DELETE FROM support_tickets WHERE build_id = ?')
  .run(build.id);
console.log(`removed ${removed.changes} existing ticket(s)`);

const result = await triage({ build_id: build.id });
console.log('Triage result:', JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
