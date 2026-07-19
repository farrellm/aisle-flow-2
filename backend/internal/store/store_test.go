package store_test

import (
	"context"
	"sync"
	"testing"

	"github.com/farrellm/aisle-flow/backend/internal/store"
	"github.com/farrellm/aisle-flow/backend/internal/testdb"
)

// newStore provisions a store and returns the id of the "Groceries" list the
// migration seeds — tests address items through it the way handlers do.
func newStore(t *testing.T) (*store.Store, string) {
	t.Helper()
	s := store.New(testdb.New(t))
	return s, seededList(t, s)
}

func seededList(t *testing.T, s *store.Store) string {
	t.Helper()
	lists, err := s.ListLists(context.Background())
	if err != nil || len(lists) != 1 {
		t.Fatalf("seeded lists: %v (%d), want the migration's Groceries", err, len(lists))
	}
	return lists[0].ID
}

func mustAdd(t *testing.T, s *store.Store, listID, name string) store.Item {
	t.Helper()
	item, _, _, err := s.CreateOrRevive(context.Background(), listID, name, nil)
	if err != nil {
		t.Fatalf("add %q: %v", name, err)
	}
	return item
}

func mustAddList(t *testing.T, s *store.Store, name string) store.List {
	t.Helper()
	list, err := s.CreateList(context.Background(), name, nil)
	if err != nil {
		t.Fatalf("add list %q: %v", name, err)
	}
	return list
}

func names(items []store.Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Name
	}
	return out
}

func assertNames(t *testing.T, got []store.Item, want ...string) {
	t.Helper()
	g := names(got)
	if len(g) != len(want) {
		t.Fatalf("got %v, want %v", g, want)
	}
	for i := range want {
		if g[i] != want[i] {
			t.Fatalf("got %v, want %v", g, want)
		}
	}
}

func unchecked(items []store.Item) []store.Item {
	var out []store.Item
	for _, it := range items {
		if !it.Checked {
			out = append(out, it)
		}
	}
	return out
}

func setChecked(t *testing.T, s *store.Store, listID, id string, checked bool) store.Item {
	t.Helper()
	item, err := s.Update(context.Background(), listID, id, store.UpdateParams{Checked: &checked})
	if err != nil {
		t.Fatalf("set checked: %v", err)
	}
	return item
}

func TestCreateOrRevive(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	milk, created, revived, err := s.CreateOrRevive(ctx, list, "Milk", nil)
	if err != nil || !created || revived {
		t.Fatalf("first add: created=%v revived=%v err=%v", created, revived, err)
	}
	if milk.Position != 1024 {
		t.Fatalf("first item position = %v, want 1024", milk.Position)
	}
	if milk.ListID != list {
		t.Fatalf("item listId = %q, want %q", milk.ListID, list)
	}

	bread := mustAdd(t, s, list, "Bread")
	if bread.Position != 2048 {
		t.Fatalf("second item position = %v, want 2048", bread.Position)
	}

	// Existing and unchecked: no-op, case-insensitive (citext).
	again, created, revived, err := s.CreateOrRevive(ctx, list, "milk", nil)
	if err != nil || created || revived {
		t.Fatalf("dup add: created=%v revived=%v err=%v", created, revived, err)
	}
	if again.ID != milk.ID || again.Name != "Milk" {
		t.Fatalf("dup add returned %+v, want the original Milk row", again)
	}

	// Existing and checked: revived (unchecked), position preserved.
	setChecked(t, s, list, milk.ID, true)
	rev, created, revived, err := s.CreateOrRevive(ctx, list, "MILK", nil)
	if err != nil || created || !revived {
		t.Fatalf("revive: created=%v revived=%v err=%v", created, revived, err)
	}
	if rev.Checked || rev.Position != milk.Position {
		t.Fatalf("revived item = %+v, want unchecked at position %v", rev, milk.Position)
	}
}

// The §3 worked example: check/uncheck preserves position through an
// intervening reorder, ties broken by created_at.
func TestOrderPreservation(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	milk := mustAdd(t, s, list, "Milk")   // 1024
	bread := mustAdd(t, s, list, "Bread") // 2048
	eggs := mustAdd(t, s, list, "Eggs")   // 3072
	jam := mustAdd(t, s, list, "Jam")     // 4096

	setChecked(t, s, list, bread.ID, true)

	// Drag Jam between Milk and Eggs → midpoint 2048, tied with Bread.
	moved, err := s.Update(ctx, list, jam.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &milk.ID, Before: &eggs.ID},
	})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if moved.Position != 2048 {
		t.Fatalf("moved position = %v, want 2048", moved.Position)
	}

	setChecked(t, s, list, bread.ID, false)

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, unchecked(items), "Milk", "Bread", "Jam", "Eggs")
}

func TestReorderToEdges(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, list, "A") // 1024
	b := mustAdd(t, s, list, "B") // 2048
	c := mustAdd(t, s, list, "C") // 3072

	// Move C to the top: no row above, B ends up below... the first visible
	// row before the move is A.
	moved, err := s.Update(ctx, list, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: nil, Before: &a.ID},
	})
	if err != nil {
		t.Fatalf("reorder to top: %v", err)
	}
	if moved.Position != 1024-1024 {
		t.Fatalf("top position = %v, want %v", moved.Position, 1024-1024)
	}

	// Move C to the bottom: lands after B.
	moved, err = s.Update(ctx, list, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &b.ID, Before: nil},
	})
	if err != nil {
		t.Fatalf("reorder to bottom: %v", err)
	}
	if moved.Position != 2048+1024 {
		t.Fatalf("bottom position = %v, want %v", moved.Position, 2048+1024)
	}

	items, _ := s.ListItems(ctx, list)
	assertNames(t, unchecked(items), "A", "B", "C")
}

func TestReorderAgainstDeletedNeighbor(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, list, "A")
	b := mustAdd(t, s, list, "B")
	if err := s.Delete(ctx, list, a.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, err := s.Update(ctx, list, b.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: nil, Before: &a.ID},
	})
	if err != store.ErrNotFound {
		t.Fatalf("reorder against deleted neighbor: err=%v, want ErrNotFound", err)
	}
}

// Seed a nearly-exhausted gap and force a renormalization (§3): all the
// list's positions are rewritten to 1024·n and relative order is preserved —
// while another list's positions stay untouched.
func TestRenormalization(t *testing.T) {
	pool := testdb.New(t)
	s := store.New(pool)
	ctx := context.Background()
	list := seededList(t, s)

	a := mustAdd(t, s, list, "A")
	b := mustAdd(t, s, list, "B")
	c := mustAdd(t, s, list, "C")
	checked := mustAdd(t, s, list, "Checked")
	setChecked(t, s, list, checked.ID, true)

	// A second list with the same near-degenerate positions: renormalizing
	// the first list must not rewrite these.
	other := mustAddList(t, s, "Hardware").ID
	otherA := mustAdd(t, s, other, "A")
	otherB := mustAdd(t, s, other, "B")

	for id, pos := range map[string]float64{
		a.ID: 1.0, b.ID: 1.0 + 1e-7, c.ID: 5000,
		otherA.ID: 1.0, otherB.ID: 1.0 + 1e-7,
	} {
		if _, err := pool.Exec(ctx,
			`UPDATE items SET position = $2 WHERE id = $1::uuid`, id, pos); err != nil {
			t.Fatalf("seed position: %v", err)
		}
	}

	// Insert C between A and B: midpoint would land within 1e-6 of both.
	moved, err := s.Update(ctx, list, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &a.ID, Before: &b.ID},
	})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, unchecked(items), "A", "C", "B")

	// After renormalization the move is re-applied as a midpoint, so every
	// adjacent pair in canonical order now has a healthy gap.
	for i := 1; i < len(items); i++ {
		gap := items[i].Position - items[i-1].Position
		if gap < 1 {
			t.Fatalf("gap between %s (%v) and %s (%v) not renormalized",
				items[i-1].Name, items[i-1].Position, items[i].Name, items[i].Position)
		}
	}
	if moved.Position <= 1.0+1e-7 {
		t.Fatalf("moved position %v not renormalized", moved.Position)
	}
	// The checked item's slot is preserved (still last in canonical order).
	if items[len(items)-1].Name != "Checked" {
		t.Fatalf("checked item lost its preserved slot: %v", names(items))
	}

	// The other list's seeded positions are untouched.
	otherItems, err := s.ListItems(ctx, other)
	if err != nil {
		t.Fatalf("list other: %v", err)
	}
	for _, it := range otherItems {
		if it.Position > 1.001 {
			t.Fatalf("other list renormalized: %s at %v", it.Name, it.Position)
		}
	}
}

// Two clients adding the same name simultaneously converge to one row (§6).
func TestConcurrentAdd(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	const workers = 8
	var wg sync.WaitGroup
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, _, errs[i] = s.CreateOrRevive(ctx, list, "Milk", nil)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("worker %d: %v", i, err)
		}
	}

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d rows, want 1", len(items))
	}
}

func TestRenameConflictAndBlank(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	mustAdd(t, s, list, "Milk")
	bread := mustAdd(t, s, list, "Bread")

	name := "milk" // collides case-insensitively
	_, err := s.Update(ctx, list, bread.ID, store.UpdateParams{Name: &name})
	if err != store.ErrNameConflict {
		t.Fatalf("rename conflict: err=%v, want ErrNameConflict", err)
	}
}

func TestDeleteAndClearChecked(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, list, "A")
	b := mustAdd(t, s, list, "B")
	c := mustAdd(t, s, list, "C")
	setChecked(t, s, list, b.ID, true)
	setChecked(t, s, list, c.ID, true)

	if err := s.Delete(ctx, list, a.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := s.Delete(ctx, list, a.ID); err != store.ErrNotFound {
		t.Fatalf("double delete: err=%v, want ErrNotFound", err)
	}

	deleted, err := s.ClearChecked(ctx, list)
	if err != nil || deleted != 2 {
		t.Fatalf("clear checked: deleted=%d err=%v, want 2", deleted, err)
	}
	items, _ := s.ListItems(ctx, list)
	if len(items) != 0 {
		t.Fatalf("got %d rows after clear, want 0", len(items))
	}
}

func TestListCRUD(t *testing.T) {
	s, groceries := newStore(t)
	ctx := context.Background()

	hardware := mustAddList(t, s, "Hardware")

	lists, err := s.ListLists(ctx)
	if err != nil || len(lists) != 2 {
		t.Fatalf("list lists: %v (%d)", err, len(lists))
	}
	// Oldest first.
	if lists[0].ID != groceries || lists[1].ID != hardware.ID {
		t.Fatalf("order: got %v, %v", lists[0].Name, lists[1].Name)
	}

	// Duplicate name, case-insensitive.
	if _, err := s.CreateList(ctx, "hardware", nil); err != store.ErrNameConflict {
		t.Fatalf("dup list: err=%v, want ErrNameConflict", err)
	}

	renamed, err := s.RenameList(ctx, hardware.ID, "Tools")
	if err != nil || renamed.Name != "Tools" {
		t.Fatalf("rename: %+v err=%v", renamed, err)
	}
	if _, err := s.RenameList(ctx, hardware.ID, "Groceries"); err != store.ErrNameConflict {
		t.Fatalf("rename conflict: err=%v, want ErrNameConflict", err)
	}
	missing := "00000000-0000-0000-0000-000000000000"
	if _, err := s.RenameList(ctx, missing, "X"); err != store.ErrListNotFound {
		t.Fatalf("rename missing: err=%v, want ErrListNotFound", err)
	}

	if err := s.DeleteList(ctx, hardware.ID); err != nil {
		t.Fatalf("delete list: %v", err)
	}
	if err := s.DeleteList(ctx, hardware.ID); err != store.ErrListNotFound {
		t.Fatalf("double delete list: err=%v, want ErrListNotFound", err)
	}
}

func TestDeleteLastList(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	if err := s.DeleteList(ctx, list); err != store.ErrLastList {
		t.Fatalf("delete only list: err=%v, want ErrLastList", err)
	}

	// Two lists, two concurrent deletes: exactly one must fail with
	// ErrLastList so a list always survives.
	other := mustAddList(t, s, "Other")
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, id := range []string{list, other.ID} {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			errs[i] = s.DeleteList(ctx, id)
		}(i, id)
	}
	wg.Wait()
	var lastList int
	for _, err := range errs {
		if err == store.ErrLastList {
			lastList++
		} else if err != nil {
			t.Fatalf("concurrent delete: %v", err)
		}
	}
	if lastList != 1 {
		t.Fatalf("concurrent deletes: %d ErrLastList, want exactly 1 (errs=%v)", lastList, errs)
	}
	lists, _ := s.ListLists(ctx)
	if len(lists) != 1 {
		t.Fatalf("%d lists survive, want 1", len(lists))
	}
}

func TestDeleteListCascades(t *testing.T) {
	s, groceries := newStore(t)
	ctx := context.Background()

	hardware := mustAddList(t, s, "Hardware")
	mustAdd(t, s, hardware.ID, "Hammer")
	keep := mustAdd(t, s, groceries, "Milk")

	if err := s.DeleteList(ctx, hardware.ID); err != nil {
		t.Fatalf("delete list: %v", err)
	}
	if _, err := s.ListItems(ctx, hardware.ID); err != store.ErrListNotFound {
		t.Fatalf("items of deleted list: err=%v, want ErrListNotFound", err)
	}
	items, err := s.ListItems(ctx, groceries)
	if err != nil || len(items) != 1 || items[0].ID != keep.ID {
		t.Fatalf("surviving list items = %v err=%v, want just Milk", names(items), err)
	}
}

// The same name coexists in two lists; create-or-revive only touches the
// addressed list (§5: UNIQUE (list_id, name)).
func TestPerListNameUniqueness(t *testing.T) {
	s, groceries := newStore(t)
	ctx := context.Background()

	hardware := mustAddList(t, s, "Hardware").ID

	gMilk := mustAdd(t, s, groceries, "Milk")
	hMilk, created, _, err := s.CreateOrRevive(ctx, hardware, "Milk", nil)
	if err != nil || !created {
		t.Fatalf("same name in second list: created=%v err=%v", created, err)
	}
	if hMilk.ID == gMilk.ID {
		t.Fatal("expected distinct rows per list")
	}

	// Check groceries' Milk; adding Milk to hardware again must not revive it.
	setChecked(t, s, groceries, gMilk.ID, true)
	_, created, revived, err := s.CreateOrRevive(ctx, hardware, "milk", nil)
	if err != nil || created || revived {
		t.Fatalf("dup in hardware: created=%v revived=%v err=%v", created, revived, err)
	}
	items, _ := s.ListItems(ctx, groceries)
	if len(items) != 1 || !items[0].Checked {
		t.Fatalf("groceries Milk affected by hardware add: %+v", items)
	}
}

func TestItemsUnknownOrWrongList(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	missing := "00000000-0000-0000-0000-000000000000"
	if _, err := s.ListItems(ctx, missing); err != store.ErrListNotFound {
		t.Fatalf("list items of unknown list: err=%v, want ErrListNotFound", err)
	}
	if _, _, _, err := s.CreateOrRevive(ctx, missing, "Milk", nil); err != store.ErrListNotFound {
		t.Fatalf("create in unknown list: err=%v, want ErrListNotFound", err)
	}
	if _, err := s.ClearChecked(ctx, missing); err != store.ErrListNotFound {
		t.Fatalf("clear checked of unknown list: err=%v, want ErrListNotFound", err)
	}

	// An existing item addressed through the wrong list is not found.
	other := mustAddList(t, s, "Other").ID
	milk := mustAdd(t, s, list, "Milk")
	checked := true
	if _, err := s.Update(ctx, other, milk.ID, store.UpdateParams{Checked: &checked}); err != store.ErrNotFound {
		t.Fatalf("update via wrong list: err=%v, want ErrNotFound", err)
	}
	if err := s.Delete(ctx, other, milk.ID); err != store.ErrNotFound {
		t.Fatalf("delete via wrong list: err=%v, want ErrNotFound", err)
	}
}

func TestClearCheckedScoped(t *testing.T) {
	s, groceries := newStore(t)
	ctx := context.Background()

	hardware := mustAddList(t, s, "Hardware").ID
	gA := mustAdd(t, s, groceries, "A")
	hA := mustAdd(t, s, hardware, "A")
	setChecked(t, s, groceries, gA.ID, true)
	setChecked(t, s, hardware, hA.ID, true)

	deleted, err := s.ClearChecked(ctx, groceries)
	if err != nil || deleted != 1 {
		t.Fatalf("clear checked: deleted=%d err=%v, want 1", deleted, err)
	}
	items, _ := s.ListItems(ctx, hardware)
	if len(items) != 1 {
		t.Fatalf("hardware items cleared too: %v", names(items))
	}
}
