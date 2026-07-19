package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/farrellm/aisle-flow/backend/internal/api"
	"github.com/farrellm/aisle-flow/backend/internal/store"
	"github.com/farrellm/aisle-flow/backend/internal/testdb"
)

// newServer starts a test server and returns the items URL of the "Groceries"
// list the migration seeds.
func newServer(t *testing.T) (srv *httptest.Server, itemsURL string) {
	t.Helper()
	srv = httptest.NewServer(api.NewRouter(store.New(testdb.New(t)), nil))
	t.Cleanup(srv.Close)
	return srv, srv.URL + "/api/lists/" + seededListID(t, srv) + "/items"
}

func seededListID(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	res, body := do(t, "GET", srv.URL+"/api/lists", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list lists status = %d, want 200", res.StatusCode)
	}
	lists := body["lists"].([]any)
	if len(lists) != 1 {
		t.Fatalf("seeded lists = %d, want 1", len(lists))
	}
	return lists[0].(map[string]any)["id"].(string)
}

func do(t *testing.T, method, url string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })

	var decoded map[string]any
	if res.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
			t.Fatalf("%s %s: decode body: %v", method, url, err)
		}
	}
	return res, decoded
}

func assertErrorEnvelope(t *testing.T, body map[string]any, wantCode string) {
	t.Helper()
	env, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("body %v lacks error envelope", body)
	}
	if env["code"] != wantCode {
		t.Fatalf("error code = %v, want %v", env["code"], wantCode)
	}
	if msg, _ := env["message"].(string); msg == "" {
		t.Fatal("error envelope has no message")
	}
}

func TestItemLifecycle(t *testing.T) {
	_, itemsURL := newServer(t)

	res, body := do(t, "POST", itemsURL, map[string]string{"name": "  Milk  "})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", res.StatusCode)
	}
	item := body["item"].(map[string]any)
	if item["name"] != "Milk" { // trimmed server-side
		t.Fatalf("name = %v, want Milk", item["name"])
	}
	if body["revived"] != false {
		t.Fatalf("revived = %v, want false", body["revived"])
	}
	id := item["id"].(string)

	// Duplicate while unchecked → 200, revived=false.
	res, body = do(t, "POST", itemsURL, map[string]string{"name": "milk"})
	if res.StatusCode != http.StatusOK || body["revived"] != false {
		t.Fatalf("dup add: status=%d revived=%v, want 200/false", res.StatusCode, body["revived"])
	}

	// Check, then re-add → 200, revived=true.
	res, _ = do(t, "PATCH", itemsURL+"/"+id, map[string]any{"checked": true})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("check status = %d, want 200", res.StatusCode)
	}
	res, body = do(t, "POST", itemsURL, map[string]string{"name": "MILK"})
	if res.StatusCode != http.StatusOK || body["revived"] != true {
		t.Fatalf("revive: status=%d revived=%v, want 200/true", res.StatusCode, body["revived"])
	}

	res, body = do(t, "GET", itemsURL, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want 200", res.StatusCode)
	}
	if items := body["items"].([]any); len(items) != 1 {
		t.Fatalf("list has %d items, want 1", len(items))
	}

	res, _ = do(t, "DELETE", itemsURL+"/"+id, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", res.StatusCode)
	}
}

func TestCreateWithClientID(t *testing.T) {
	_, itemsURL := newServer(t)
	clientID := "5f0c9a2e-4b7d-4c3a-9e1f-2a6b8d4c7e10"

	res, body := do(t, "POST", itemsURL,
		map[string]string{"id": clientID, "name": "Milk"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", res.StatusCode)
	}
	if got := body["item"].(map[string]any)["id"]; got != clientID {
		t.Fatalf("id = %v, want the client-supplied %v", got, clientID)
	}

	// Offline replay of the same create: existing row wins, same id.
	res, body = do(t, "POST", itemsURL,
		map[string]string{"id": clientID, "name": "Milk"})
	if res.StatusCode != http.StatusOK || body["revived"] != false {
		t.Fatalf("replay: status=%d revived=%v, want 200/false", res.StatusCode, body["revived"])
	}
	if got := body["item"].(map[string]any)["id"]; got != clientID {
		t.Fatalf("replay id = %v, want %v", got, clientID)
	}

	// Same id, different name → conflict, not a 500.
	res, body = do(t, "POST", itemsURL,
		map[string]string{"id": clientID, "name": "Bread"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("id collision status = %d, want 409", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "conflict")

	res, body = do(t, "POST", itemsURL,
		map[string]string{"id": "not-a-uuid", "name": "Eggs"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad id status = %d, want 400", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "bad_request")
}

func TestErrorResponses(t *testing.T) {
	_, itemsURL := newServer(t)

	res, body := do(t, "POST", itemsURL, map[string]string{"name": "   "})
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("blank name status = %d, want 422", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "invalid")

	res, body = do(t, "PATCH", itemsURL+"/not-a-uuid", map[string]any{"checked": true})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad uuid status = %d, want 400", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "bad_request")

	res, body = do(t, "PATCH", itemsURL+"/6c1f3d1e-0000-0000-0000-000000000000",
		map[string]any{"checked": true})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown id status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")

	// Bulk delete without the guard param (§6).
	res, body = do(t, "DELETE", itemsURL, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("guardless bulk delete status = %d, want 400", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "bad_request")

	// Rename collision → 409.
	do(t, "POST", itemsURL, map[string]string{"name": "Milk"})
	_, second := do(t, "POST", itemsURL, map[string]string{"name": "Bread"})
	secondID := second["item"].(map[string]any)["id"].(string)
	res, body = do(t, "PATCH", itemsURL+"/"+secondID, map[string]any{"name": "milk"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("rename conflict status = %d, want 409", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "conflict")
}

func TestClearChecked(t *testing.T) {
	_, itemsURL := newServer(t)

	_, a := do(t, "POST", itemsURL, map[string]string{"name": "A"})
	do(t, "POST", itemsURL, map[string]string{"name": "B"})
	aID := a["item"].(map[string]any)["id"].(string)
	do(t, "PATCH", itemsURL+"/"+aID, map[string]any{"checked": true})

	res, body := do(t, "DELETE", itemsURL+"?checked=true", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("clear status = %d, want 200", res.StatusCode)
	}
	if body["deleted"] != float64(1) {
		t.Fatalf("deleted = %v, want 1", body["deleted"])
	}
}

func TestListLifecycle(t *testing.T) {
	srv, _ := newServer(t)
	listsURL := srv.URL + "/api/lists"

	res, body := do(t, "POST", listsURL, map[string]string{"name": "  Hardware  "})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create list status = %d, want 201", res.StatusCode)
	}
	list := body["list"].(map[string]any)
	if list["name"] != "Hardware" { // trimmed server-side
		t.Fatalf("name = %v, want Hardware", list["name"])
	}
	id := list["id"].(string)

	// Duplicate name (case-insensitive) → 409.
	res, body = do(t, "POST", listsURL, map[string]string{"name": "hardware"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("dup list status = %d, want 409", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "conflict")

	// Client-generated list id (offline create-list chains, §13).
	clientID := "7a1b9c3d-5e2f-4a6b-8c0d-1e3f5a7b9c1d"
	res, body = do(t, "POST", listsURL, map[string]string{"id": clientID, "name": "Pharmacy"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create with client id status = %d, want 201", res.StatusCode)
	}
	if got := body["list"].(map[string]any)["id"]; got != clientID {
		t.Fatalf("id = %v, want the client-supplied %v", got, clientID)
	}

	res, body = do(t, "PATCH", listsURL+"/"+id, map[string]string{"name": "Tools"})
	if res.StatusCode != http.StatusOK || body["list"].(map[string]any)["name"] != "Tools" {
		t.Fatalf("rename: status=%d body=%v", res.StatusCode, body)
	}
	res, body = do(t, "PATCH", listsURL+"/"+id, map[string]string{"name": "groceries"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("rename conflict status = %d, want 409", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "conflict")

	res, _ = do(t, "DELETE", listsURL+"/"+id, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete list status = %d, want 204", res.StatusCode)
	}
	res, body = do(t, "DELETE", listsURL+"/"+id, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("double delete list status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")

	res, body = do(t, "GET", listsURL, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list lists status = %d, want 200", res.StatusCode)
	}
	if lists := body["lists"].([]any); len(lists) != 2 { // Groceries + Pharmacy
		t.Fatalf("lists = %d, want 2", len(lists))
	}
}

func TestDeleteLastList(t *testing.T) {
	srv, _ := newServer(t)
	id := seededListID(t, srv)

	res, body := do(t, "DELETE", srv.URL+"/api/lists/"+id, nil)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("delete only list status = %d, want 409", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "last_list")
}

func TestItemsUnknownList(t *testing.T) {
	srv, _ := newServer(t)
	missing := srv.URL + "/api/lists/00000000-0000-0000-0000-000000000000/items"

	res, body := do(t, "GET", missing, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("items of unknown list status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")

	res, body = do(t, "POST", missing, map[string]string{"name": "Milk"})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("create in unknown list status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")
}

func TestItemWrongList(t *testing.T) {
	srv, itemsURL := newServer(t)

	_, body := do(t, "POST", srv.URL+"/api/lists", map[string]string{"name": "Hardware"})
	otherID := body["list"].(map[string]any)["id"].(string)

	_, created := do(t, "POST", itemsURL, map[string]string{"name": "Milk"})
	itemID := created["item"].(map[string]any)["id"].(string)

	// The item addressed through the wrong list's prefix is not found.
	wrongURL := srv.URL + "/api/lists/" + otherID + "/items/" + itemID
	res, body := do(t, "PATCH", wrongURL, map[string]any{"checked": true})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("patch via wrong list status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")

	res, body = do(t, "DELETE", wrongURL, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("delete via wrong list status = %d, want 404", res.StatusCode)
	}
	assertErrorEnvelope(t, body, "not_found")
}

func TestHealthz(t *testing.T) {
	srv, _ := newServer(t)
	res, body := do(t, "GET", srv.URL+"/api/healthz", nil)
	if res.StatusCode != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("healthz: status=%d body=%v", res.StatusCode, body)
	}
}
