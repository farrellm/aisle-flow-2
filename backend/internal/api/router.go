package api

import (
	"net/http"

	"github.com/farrellm/aisle-flow/backend/internal/store"
)

// NewRouter wires the API endpoints (§6). webui may be nil in development,
// where Vite serves the frontend and proxies /api here.
func NewRouter(s *store.Store, webui http.Handler) http.Handler {
	h := &handlers{store: s}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/items", h.listItems)
	mux.HandleFunc("POST /api/items", h.createItem)
	mux.HandleFunc("PATCH /api/items/{id}", h.updateItem)
	mux.HandleFunc("DELETE /api/items/{id}", h.deleteItem)
	mux.HandleFunc("DELETE /api/items", h.clearChecked)
	mux.HandleFunc("GET /api/healthz", h.healthz)

	if webui != nil {
		mux.Handle("/", webui)
	}

	return withRecovery(withRequestLog(mux))
}
