.PHONY: dev build lint supabase-start supabase-stop db-reset deploy

dev:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

lint:
	cd frontend && npm run lint

supabase-start:
	supabase start

supabase-stop:
	supabase stop

db-reset:
	supabase db reset

deploy: build
	supabase db push
	supabase functions deploy ingest-jenkins --no-verify-jwt
	supabase functions deploy ingest-prow --no-verify-jwt
	supabase functions deploy triage --no-verify-jwt
	supabase functions deploy diagnosis --no-verify-jwt
	supabase functions deploy resolution-tracker --no-verify-jwt
	supabase functions deploy notify --no-verify-jwt
