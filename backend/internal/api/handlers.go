package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/farrellm/aisle-flow/backend/internal/store"
)

type handlers struct {
	store *store.Store
}

func (h *handlers) listItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.store.List(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *handlers) createItem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "malformed JSON body")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		invalid(w, "name must not be blank")
		return
	}

	item, created, revived, err := h.store.CreateOrRevive(r.Context(), name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"item": item, "revived": revived})
}

func (h *handlers) updateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}

	// before/after use RawMessage to distinguish absent (no reorder) from
	// explicit null (edge of the unchecked section).
	var req struct {
		Name    *string         `json:"name"`
		Checked *bool           `json:"checked"`
		Before  json.RawMessage `json:"before"`
		After   json.RawMessage `json:"after"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "malformed JSON body")
		return
	}

	params := store.UpdateParams{Checked: req.Checked}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			invalid(w, "name must not be blank")
			return
		}
		params.Name = &name
	}
	if req.Before != nil || req.After != nil {
		target := store.ReorderTarget{}
		var ok bool
		if target.Before, ok = neighborID(w, req.Before); !ok {
			return
		}
		if target.After, ok = neighborID(w, req.After); !ok {
			return
		}
		params.Reorder = &target
	}

	item, err := h.store.Update(r.Context(), id, params)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (h *handlers) deleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) clearChecked(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("checked") != "true" {
		badRequest(w, "bulk delete requires ?checked=true")
		return
	}
	deleted, err := h.store.ClearChecked(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func (h *handlers) healthz(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Ping(r.Context()); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// pathUUID extracts and validates the {id} path segment.
func pathUUID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		badRequest(w, "invalid item id")
		return "", false
	}
	return id, true
}

// neighborID parses a before/after value: JSON null → nil (section edge),
// otherwise a uuid string.
func neighborID(w http.ResponseWriter, raw json.RawMessage) (*string, bool) {
	if raw == nil || string(raw) == "null" {
		return nil, true
	}
	var id string
	if err := json.Unmarshal(raw, &id); err != nil {
		badRequest(w, "before/after must be an item id or null")
		return nil, false
	}
	if _, err := uuid.Parse(id); err != nil {
		badRequest(w, "before/after must be a valid item id")
		return nil, false
	}
	return &id, true
}
