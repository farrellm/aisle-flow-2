// Package testdb provisions a throwaway database per test against the
// docker-compose Postgres (§11), applying the real migrations.
package testdb

import (
	"context"
	"fmt"
	"math/rand"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultURL = "postgres://aisleflow:aisleflow@localhost:5434/aisleflow?sslmode=disable"

func baseURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return defaultURL
}

// New creates a fresh database with the schema applied and returns a pool
// connected to it. The database is dropped when the test finishes. Skips the
// test if Postgres is unreachable.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, baseURL())
	if err != nil {
		t.Skipf("postgres unavailable (run `make db-create`?): %v", err)
	}

	name := fmt.Sprintf("aisleflow_test_%d", rand.Int63())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close(ctx)
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE "+name+" WITH (FORCE)")
		admin.Close(context.Background())
	})

	u, err := url.Parse(baseURL())
	if err != nil {
		t.Fatalf("parse database url: %v", err)
	}
	u.Path = "/" + name

	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	t.Cleanup(pool.Close)

	migration, err := os.ReadFile(migrationPath(t))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("apply migration: %v", err)
	}
	return pool
}

func migrationPath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate testdb source file")
	}
	// backend/internal/testdb/testdb.go → db/migrations/…
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(thisFile))))
	return filepath.Join(root, "db", "migrations", "000001_create_items.up.sql")
}
