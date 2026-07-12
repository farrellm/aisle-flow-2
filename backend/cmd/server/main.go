package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/farrellm/aisle-flow/backend/internal/api"
	"github.com/farrellm/aisle-flow/backend/internal/store"
	"github.com/farrellm/aisle-flow/backend/internal/webui"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL := envOr("DATABASE_URL",
		"postgres://aisleflow:aisleflow@localhost:5434/aisleflow?sslmode=disable")
	port := envOr("PORT", "8081")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	st := store.New(pool)
	// Fail fast if the DB is unreachable or the schema is missing (§8);
	// migrations are an explicit `make db-migrate` step.
	if err := st.Ping(ctx); err != nil {
		return errors.New("database not ready (run `make db-create db-migrate`?): " + err.Error())
	}

	server := &http.Server{
		Addr:    ":" + port,
		Handler: api.NewRouter(st, webui.Handler()),
	}

	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", server.Addr)
		errc <- server.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
