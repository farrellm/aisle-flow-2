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

func (h *handlers) listLists(w http.ResponseWriter, r *http.Request) {
	lists, err := h.store.ListLists(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lists": lists})
}

func (h *handlers) createList(w http.ResponseWriter, r *http.Request) {
	name, id, ok := decodeNameAndID(w, r, "list")
	if !ok {
		return
	}
	list, err := h.store.CreateList(r.Context(), name, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"list": list})
}

func (h *handlers) updateList(w http.ResponseWriter, r *http.Request) {
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
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
	list, err := h.store.RenameList(r.Context(), listID, name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"list": list})
}

func (h *handlers) deleteList(w http.ResponseWriter, r *http.Request) {
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
	if err := h.store.DeleteList(r.Context(), listID); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) listItems(w http.ResponseWriter, r *http.Request) {
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
	items, err := h.store.ListItems(r.Context(), listID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *handlers) createItem(w http.ResponseWriter, r *http.Request) {
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
	name, id, ok := decodeNameAndID(w, r, "item")
	if !ok {
		return
	}
	item, created, revived, err := h.store.CreateOrRevive(r.Context(), listID, name, id)
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
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "id", "item")
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

	item, err := h.store.Update(r.Context(), listID, id, params)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (h *handlers) deleteItem(w http.ResponseWriter, r *http.Request) {
	listID, ok := pathUUID(w, r, "listId", "list")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "id", "item")
	if !ok {
		return
	}
	if err := h.store.Delete(r.Context(), listID, id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) healthz(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Ping(r.Context()); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// pathUUID extracts and validates a uuid path segment; what names the entity
// in the error message ("list", "item").
func pathUUID(w http.ResponseWriter, r *http.Request, segment, what string) (string, bool) {
	id := r.PathValue(segment)
	if _, err := uuid.Parse(id); err != nil {
		badRequest(w, "invalid "+what+" id")
		return "", false
	}
	return id, true
}

// decodeNameAndID parses the shared create body: a required name (trimmed,
// not blank) and an optional client-generated uuid — offline clients supply
// their own id so mutations queued behind the create can reference the row
// before the response arrives (§13).
func decodeNameAndID(w http.ResponseWriter, r *http.Request, what string) (string, *string, bool) {
	var req struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "malformed JSON body")
		return "", nil, false
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		invalid(w, "name must not be blank")
		return "", nil, false
	}
	var id *string
	if req.ID != "" {
		if _, err := uuid.Parse(req.ID); err != nil {
			badRequest(w, "invalid "+what+" id")
			return "", nil, false
		}
		id = &req.ID
	}
	return name, id, true
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
