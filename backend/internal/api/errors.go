package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/farrellm/aisle-flow/backend/internal/store"
)

// errorBody is the uniform error envelope (§6):
// { "error": { "code": "not_found", "message": "item not found" } }
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

func badRequest(w http.ResponseWriter, message string) {
	writeError(w, http.StatusBadRequest, "bad_request", message)
}

func invalid(w http.ResponseWriter, message string) {
	writeError(w, http.StatusUnprocessableEntity, "invalid", message)
}

// writeStoreError maps store errors to the envelope; unexpected errors are
// logged server-side and never leaked (§6).
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "item not found")
	case errors.Is(err, store.ErrNameConflict):
		writeError(w, http.StatusConflict, "conflict", "an item with that name already exists")
	default:
		slog.Error("internal error", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal server error")
	}
}
