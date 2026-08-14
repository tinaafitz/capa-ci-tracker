# Stage 1: Build frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build server (TypeScript -> JavaScript)
FROM node:22-slim AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Production image
FROM node:22-slim
WORKDIR /app

# Copy built frontend static files
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy compiled server code (includes dist/db/schema.sql from build step)
COPY --from=server-builder /app/server/dist ./server/dist

# Copy server package files for production dependency install
COPY server/package*.json ./server/

# Install production dependencies only (no devDependencies)
RUN cd server && npm ci --omit=dev

# Data directory for SQLite database file
RUN mkdir -p /data
ENV DB_PATH=/data/capa-ci-tracker.db
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

# Health check — verify the API responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]
