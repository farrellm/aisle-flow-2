package store_test

import (
	"context"
	"sync"
	"testing"

	"github.com/farrellm/aisle-flow/backend/internal/store"
	"github.com/farrellm/aisle-flow/backend/internal/testdb"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	return store.New(testdb.New(t))
}

func mustAdd(t *testing.T, s *store.Store, name string) store.Item {
	t.Helper()
	item, _, _, err := s.CreateOrRevive(context.Background(), name)
	if err != nil {
		t.Fatalf("add %q: %v", name, err)
	}
	return item
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

func setChecked(t *testing.T, s *store.Store, id string, checked bool) store.Item {
	t.Helper()
	item, err := s.Update(context.Background(), id, store.UpdateParams{Checked: &checked})
	if err != nil {
		t.Fatalf("set checked: %v", err)
	}
	return item
}

func TestCreateOrRevive(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	milk, created, revived, err := s.CreateOrRevive(ctx, "Milk")
	if err != nil || !created || revived {
		t.Fatalf("first add: created=%v revived=%v err=%v", created, revived, err)
	}
	if milk.Position != 1024 {
		t.Fatalf("first item position = %v, want 1024", milk.Position)
	}

	bread := mustAdd(t, s, "Bread")
	if bread.Position != 2048 {
		t.Fatalf("second item position = %v, want 2048", bread.Position)
	}

	// Existing and unchecked: no-op, case-insensitive (citext).
	again, created, revived, err := s.CreateOrRevive(ctx, "milk")
	if err != nil || created || revived {
		t.Fatalf("dup add: created=%v revived=%v err=%v", created, revived, err)
	}
	if again.ID != milk.ID || again.Name != "Milk" {
		t.Fatalf("dup add returned %+v, want the original Milk row", again)
	}

	// Existing and checked: revived (unchecked), position preserved.
	setChecked(t, s, milk.ID, true)
	rev, created, revived, err := s.CreateOrRevive(ctx, "MILK")
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
	s := newStore(t)
	ctx := context.Background()

	milk := mustAdd(t, s, "Milk")    // 1024
	bread := mustAdd(t, s, "Bread")  // 2048
	eggs := mustAdd(t, s, "Eggs")    // 3072
	jam := mustAdd(t, s, "Jam")      // 4096

	setChecked(t, s, bread.ID, true)

	// Drag Jam between Milk and Eggs → midpoint 2048, tied with Bread.
	moved, err := s.Update(ctx, jam.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &milk.ID, Before: &eggs.ID},
	})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if moved.Position != 2048 {
		t.Fatalf("moved position = %v, want 2048", moved.Position)
	}

	setChecked(t, s, bread.ID, false)

	items, err := s.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, unchecked(items), "Milk", "Bread", "Jam", "Eggs")
}

func TestReorderToEdges(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, "A") // 1024
	b := mustAdd(t, s, "B") // 2048
	c := mustAdd(t, s, "C") // 3072

	// Move C to the top: no row above, B ends up below... the first visible
	// row before the move is A.
	moved, err := s.Update(ctx, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: nil, Before: &a.ID},
	})
	if err != nil {
		t.Fatalf("reorder to top: %v", err)
	}
	if moved.Position != 1024-1024 {
		t.Fatalf("top position = %v, want %v", moved.Position, 1024-1024)
	}

	// Move C to the bottom: lands after B.
	moved, err = s.Update(ctx, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &b.ID, Before: nil},
	})
	if err != nil {
		t.Fatalf("reorder to bottom: %v", err)
	}
	if moved.Position != 2048+1024 {
		t.Fatalf("bottom position = %v, want %v", moved.Position, 2048+1024)
	}

	items, _ := s.List(ctx)
	assertNames(t, unchecked(items), "A", "B", "C")
}

func TestReorderAgainstDeletedNeighbor(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, "A")
	b := mustAdd(t, s, "B")
	if err := s.Delete(ctx, a.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, err := s.Update(ctx, b.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: nil, Before: &a.ID},
	})
	if err != store.ErrNotFound {
		t.Fatalf("reorder against deleted neighbor: err=%v, want ErrNotFound", err)
	}
}

// Seed a nearly-exhausted gap and force a renormalization (§3): all
// positions are rewritten to 1024·n and relative order is preserved.
func TestRenormalization(t *testing.T) {
	pool := testdb.New(t)
	s := store.New(pool)
	ctx := context.Background()

	a := mustAdd(t, s, "A")
	b := mustAdd(t, s, "B")
	c := mustAdd(t, s, "C")
	checked := mustAdd(t, s, "Checked")
	setChecked(t, s, checked.ID, true)

	for id, pos := range map[string]float64{a.ID: 1.0, b.ID: 1.0 + 1e-7, c.ID: 5000} {
		if _, err := pool.Exec(ctx,
			`UPDATE items SET position = $2 WHERE id = $1::uuid`, id, pos); err != nil {
			t.Fatalf("seed position: %v", err)
		}
	}

	// Insert C between A and B: midpoint would land within 1e-6 of both.
	moved, err := s.Update(ctx, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &a.ID, Before: &b.ID},
	})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}

	items, err := s.List(ctx)
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
}

// Two clients adding the same name simultaneously converge to one row (§6).
func TestConcurrentAdd(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	const workers = 8
	var wg sync.WaitGroup
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, _, errs[i] = s.CreateOrRevive(ctx, "Milk")
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("worker %d: %v", i, err)
		}
	}

	items, err := s.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d rows, want 1", len(items))
	}
}

func TestRenameConflictAndBlank(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	mustAdd(t, s, "Milk")
	bread := mustAdd(t, s, "Bread")

	name := "milk" // collides case-insensitively
	_, err := s.Update(ctx, bread.ID, store.UpdateParams{Name: &name})
	if err != store.ErrNameConflict {
		t.Fatalf("rename conflict: err=%v, want ErrNameConflict", err)
	}
}

func TestDeleteAndClearChecked(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	a := mustAdd(t, s, "A")
	b := mustAdd(t, s, "B")
	c := mustAdd(t, s, "C")
	setChecked(t, s, b.ID, true)
	setChecked(t, s, c.ID, true)

	if err := s.Delete(ctx, a.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := s.Delete(ctx, a.ID); err != store.ErrNotFound {
		t.Fatalf("double delete: err=%v, want ErrNotFound", err)
	}

	deleted, err := s.ClearChecked(ctx)
	if err != nil || deleted != 2 {
		t.Fatalf("clear checked: deleted=%d err=%v, want 2", deleted, err)
	}
	items, _ := s.List(ctx)
	if len(items) != 0 {
		t.Fatalf("got %d rows after clear, want 0", len(items))
	}
}
