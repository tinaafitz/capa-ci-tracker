import { db } from './db/connection.js';
import { run as triage } from './agents/triage.js';

const buildId = process.argv[2];
if (!buildId) {
  console.error('usage: tsx run-triage.mts <build_id>');
  process.exit(1);
}

const result = await triage({ build_id: buildId });
console.log('Triage result:', JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
