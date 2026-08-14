.PHONY: dev build start install seed db-reset deploy lint

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
