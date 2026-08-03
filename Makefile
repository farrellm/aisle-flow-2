AISLEFLOW_DB_PORT ?= 5434
export AISLEFLOW_DB_PORT
DATABASE_URL ?= postgres://aisleflow:aisleflow@localhost:$(AISLEFLOW_DB_PORT)/aisleflow?sslmode=disable
export DATABASE_URL

# The e2e suite runs the production binary against its own throwaway database
# and its own port, so it never touches the real list in the dev DB (§11).
E2E_DB ?= aisleflow_e2e
E2E_DATABASE_URL = postgres://aisleflow:aisleflow@localhost:$(AISLEFLOW_DB_PORT)/$(E2E_DB)?sslmode=disable
E2E_PORT ?= 8082
export E2E_DATABASE_URL
export E2E_PORT

.PHONY: db-create db-start db-migrate db-stop db-destroy backend backend-watch frontend dev test build e2e e2e-db

db-create:
	docker compose up -d --wait db

db-start:
	docker compose up -d db

db-migrate:
	docker run --rm -v $(CURDIR)/db/migrations:/migrations --network host \
	  migrate/migrate -path=/migrations -database "$(DATABASE_URL)" up

db-stop:
	docker compose stop db

db-destroy:
	docker compose down -v

backend:
	cd backend && go run ./cmd/server

# Live-reload: wgo reruns `go run` whenever a .go file under backend/ changes.
backend-watch:
	cd backend && wgo run ./cmd/server

frontend:
	cd frontend && npm run dev

dev: db-create db-migrate
	$(MAKE) -j2 backend frontend

test:
	cd backend && go test ./...
	cd frontend && npm test -- --run

# Production: one binary serving both /api and the built frontend (§4).
build:
	cd frontend && npm run build
	rm -rf backend/internal/webui/dist
	cp -r frontend/dist backend/internal/webui/dist
	cd backend && go build -tags embedui -o server ./cmd/server

# Recreate the e2e database from scratch so every run starts from a known
# empty schema. Deliberately a *different* database from the dev one.
e2e-db: db-create
	docker compose exec -T db psql -U aisleflow -d postgres \
	  -c 'DROP DATABASE IF EXISTS $(E2E_DB) WITH (FORCE)' -c 'CREATE DATABASE $(E2E_DB)'
	docker run --rm -v $(CURDIR)/db/migrations:/migrations --network host \
	  migrate/migrate -path=/migrations -database "$(E2E_DATABASE_URL)" up

# Offline/PWA end-to-end (§11, §13). Needs the production build: the service
# worker is disabled in dev, so the Vite dev server cannot exercise any of it.
e2e: build e2e-db
	cd frontend && npx playwright test
