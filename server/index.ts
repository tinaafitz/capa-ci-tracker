import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';

// Import db (triggers schema initialization)
import './db/connection.js';

// Import routers
import { tableRouter } from './api/router.js';
import { rpcRouter } from './api/rpc.js';

// Import trigger event bus and wire agent handlers
import { dbEvents } from './triggers.js';
import { run as runTriage } from './agents/triage.js';
import { run as runNotify } from './agents/notify.js';

dbEvents.on('build_failure', async (event) => {
  console.log('[event] build_failure:', event.job_name);
  await runTriage({ build_id: event.build_id }).catch(err =>
    console.error('[triage] error:', err instanceof Error ? err.message : err)
  );
});

dbEvents.on('new_activity', async (event) => {
  console.log('[event] new_activity:', event.activity_type);
  await runNotify({ event_type: 'new_activity', activity_id: event.activity_id }).catch(err =>
    console.error('[notify] error:', err instanceof Error ? err.message : err)
  );
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Mount API routes
app.use('/api/rpc', rpcRouter);
app.use('/api', tableRouter);

// Serve static frontend in production
// __dirname is server/dist/ in production, so go up two levels to reach frontend/dist/
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback: all non-API routes serve index.html
// Express 5 requires named wildcards instead of bare *
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      // Frontend not built yet -- return a helpful message
      res.status(200).send('CAPA CI Tracker API is running. Build the frontend with `cd frontend && npm run build` to serve it here.');
    }
  });
});

// Start server
app.listen(config.port, () => {
  console.log(`[server] CAPA CI Tracker server listening on port ${config.port}`);
  console.log(`[server] Database: ${config.dbPath}`);
  console.log(`[server] Environment: ${config.nodeEnv}`);
  startScheduler();
});
