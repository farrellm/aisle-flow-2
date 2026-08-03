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
	mux.HandleFunc("GET /api/lists", h.listLists)
	mux.HandleFunc("POST /api/lists", h.createList)
	mux.HandleFunc("PATCH /api/lists/{listId}", h.updateList)
	mux.HandleFunc("DELETE /api/lists/{listId}", h.deleteList)
	mux.HandleFunc("GET /api/lists/{listId}/items", h.listItems)
	mux.HandleFunc("POST /api/lists/{listId}/items", h.createItem)
	mux.HandleFunc("PATCH /api/lists/{listId}/items/{id}", h.updateItem)
	mux.HandleFunc("DELETE /api/lists/{listId}/items/{id}", h.deleteItem)
	mux.HandleFunc("GET /api/healthz", h.healthz)

	// Without this, an unmatched or wrong-method /api path falls through to the
	// SPA catch-all below and answers index.html with a 200, which the client's
	// fetch wrapper parses as a successful response. Keep /api answering in the
	// error envelope (§6).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})

	if webui != nil {
		mux.Handle("/", webui)
	}

	return withRecovery(withRequestLog(mux))
}
