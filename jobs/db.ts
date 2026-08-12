// db.ts -- Shared database connection module for all CronJob scripts.
// Uses pg Pool with DATABASE_URL from environment.

import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  log('ERROR', 'db', `Unexpected pool error: ${err.message}`);
});

export { pool };

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

// Structured logging helper used across all job scripts
export function log(level: 'INFO' | 'WARN' | 'ERROR', component: string, message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// Record an agent run in the agent_runs table
export async function recordAgentRun(opts: {
  agentName: string;
  trigger: string;
  inputPayload: unknown;
  outputPayload: unknown;
  success: boolean;
  errorMessage?: string | null;
  durationMs: number;
}) {
  try {
    await query(
      `INSERT INTO agent_runs (agent_name, trigger, input_payload, output_payload, success, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        opts.agentName,
        opts.trigger,
        JSON.stringify(opts.inputPayload),
        JSON.stringify(opts.outputPayload),
        opts.success,
        opts.errorMessage ?? null,
        opts.durationMs,
      ]
    );
  } catch (err) {
    log('ERROR', opts.agentName, `Failed to record agent run: ${(err as Error).message}`);
  }
}
