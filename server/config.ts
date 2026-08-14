export const config = {
  port: parseInt(process.env.PORT ?? '3001'),
  dbPath: process.env.DB_PATH ?? './capa-ci-tracker.db',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiKey: process.env.API_KEY ?? '',
}
