AISLEFLOW_DB_PORT ?= 5434
export AISLEFLOW_DB_PORT
DATABASE_URL ?= postgres://aisleflow:aisleflow@localhost:$(AISLEFLOW_DB_PORT)/aisleflow?sslmode=disable
export DATABASE_URL

.PHONY: db-create db-start db-migrate db-stop db-destroy backend frontend dev test build

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
