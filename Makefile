.PHONY: dev build start install seed db-reset deploy lint image image-run

# Development: start both servers concurrently
dev:
	@echo "Starting frontend and backend dev servers..."
	@(cd server && npm run dev) &
	@(cd frontend && npm run dev)

# Build: frontend then server
build:
	cd frontend && npm run build
	cd server && npm run build

# Production start (after build)
start:
	cd server && npm start

# Install all dependencies
install:
	cd frontend && npm install
	cd server && npm install

# Lint frontend
lint:
	cd frontend && npm run lint

# Seed the database with sample data
seed:
	cd server && npm run seed

# Reset DB (re-apply schema + seed)
db-reset:
	rm -f server/*.db server/*.db-wal server/*.db-shm
	cd server && npm run seed

# Deploy (build + start — for simple deployments)
deploy: build
	@echo "Build complete. Run 'make start' to start the production server."

# Build container image with Podman
image:
	podman build -t capa-ci-tracker:latest .

# Run container locally (mounts ./data for persistent SQLite)
image-run:
	mkdir -p data
	podman run --rm -p 3001:3001 -v ./data:/data:Z \
		-e NODE_ENV=production \
		capa-ci-tracker:latest
