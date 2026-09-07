package store_test

import (
	"context"
	"testing"

	"github.com/farrellm/aisle-flow/backend/internal/store"
	"github.com/farrellm/aisle-flow/backend/internal/testdb"
)

func setNote(t *testing.T, s *store.Store, listID, id string, note bool) store.Item {
	t.Helper()
	item, err := s.Update(context.Background(), listID, id, store.UpdateParams{Note: &note})
	if err != nil {
		t.Fatalf("set note: %v", err)
	}
	return item
}

// buyable is the unchecked section as the user sees it: notes pin above it, so
// they are not part of it even though they are unchecked.
func buyable(items []store.Item) []store.Item {
	var out []store.Item
	for _, it := range items {
		if !it.Checked && !it.Note {
			out = append(out, it)
		}
	}
	return out
}

func notesOf(items []store.Item) []store.Item {
	var out []store.Item
	for _, it := range items {
		if it.Note {
			out = append(out, it)
		}
	}
	return out
}

// Converting to a note and back must leave position alone, exactly as
// check/uncheck does (§3) — that is what returns the row to its old slot.
func TestNoteRoundTripPreservesPosition(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	mustAdd(t, s, list, "Milk")
	bread := mustAdd(t, s, list, "Bread")
	mustAdd(t, s, list, "Coffee")

	note := setNote(t, s, list, bread.ID, true)
	if !note.Note || note.Position != bread.Position {
		t.Fatalf("convert: note=%v position=%v, want true and %v",
			note.Note, note.Position, bread.Position)
	}

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, notesOf(items), "Bread")
	assertNames(t, buyable(items), "Milk", "Coffee")

	back := setNote(t, s, list, bread.ID, false)
	if back.Note || back.Position != bread.Position {
		t.Fatalf("convert back: note=%v position=%v", back.Note, back.Position)
	}
	items, err = s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, buyable(items), "Milk", "Bread", "Coffee")
}

// A note is never checked: converting a checked item unchecks it, and the
// position it kept while checked still applies when it converts back.
func TestNoteUnchecksCheckedItem(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	mustAdd(t, s, list, "Milk")
	apples := mustAdd(t, s, list, "Apples")
	mustAdd(t, s, list, "Coffee")
	setChecked(t, s, list, apples.ID, true)

	note := setNote(t, s, list, apples.ID, true)
	if note.Checked {
		t.Fatalf("converting a checked item left it checked")
	}
	if note.Position != apples.Position {
		t.Fatalf("position %v, want %v", note.Position, apples.Position)
	}

	back := setNote(t, s, list, apples.ID, false)
	if back.Checked {
		t.Fatalf("converting back re-checked the item")
	}
	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, buyable(items), "Milk", "Apples", "Coffee")
}

// Display order (§3): notes by position, then unchecked by position, then
// checked by name. sort.ts splitItems mirrors this.
func TestListItemsOrdersNotesFirst(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	mustAdd(t, s, list, "Milk")
	bread := mustAdd(t, s, list, "Bread")
	zucchini := mustAdd(t, s, list, "Zucchini")
	apples := mustAdd(t, s, list, "Apples")
	coffee := mustAdd(t, s, list, "Coffee")

	// Two notes, converted out of order so position (not conversion time)
	// decides how they stack.
	setNote(t, s, list, coffee.ID, true)
	setNote(t, s, list, bread.ID, true)
	setChecked(t, s, list, zucchini.ID, true)
	setChecked(t, s, list, apples.ID, true)

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, items, "Bread", "Coffee", "Milk", "Apples", "Zucchini")
}

// Adding a name that already lives on the list as a note means the user wants
// to buy it after all: the note converges back to a plain unchecked item.
func TestCreateOrReviveConvertsNote(t *testing.T) {
	s, list := newStore(t)
	ctx := context.Background()

	milk := mustAdd(t, s, list, "Milk")
	setNote(t, s, list, milk.ID, true)

	item, created, revived, err := s.CreateOrRevive(ctx, list, "milk", nil)
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if created || !revived {
		t.Fatalf("created=%v revived=%v, want false/true", created, revived)
	}
	if item.Note || item.Checked || item.ID != milk.ID {
		t.Fatalf("revived note not restored as an item: %+v", item)
	}
}

// Renormalization needs no note-awareness: it renumbers monotonically in
// position, which preserves relative order inside the notes group and inside
// the unchecked group alike (§3).
func TestRenormalizationWithNotes(t *testing.T) {
	pool := testdb.New(t)
	s := store.New(pool)
	ctx := context.Background()
	list := seededList(t, s)

	a := mustAdd(t, s, list, "A")
	b := mustAdd(t, s, list, "B")
	c := mustAdd(t, s, list, "C")
	n1 := mustAdd(t, s, list, "Note one")
	n2 := mustAdd(t, s, list, "Note two")
	setNote(t, s, list, n1.ID, true)
	setNote(t, s, list, n2.ID, true)

	for id, pos := range map[string]float64{
		a.ID: 1.0, b.ID: 1.0 + 1e-7, c.ID: 5000,
		n1.ID: 2.0, n2.ID: 2.0 + 1e-7,
	} {
		if _, err := pool.Exec(ctx,
			`UPDATE items SET position = $2 WHERE id = $1::uuid`, id, pos); err != nil {
			t.Fatalf("seed position: %v", err)
		}
	}

	if _, err := s.Update(ctx, list, c.ID, store.UpdateParams{
		Reorder: &store.ReorderTarget{After: &a.ID, Before: &b.ID},
	}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	items, err := s.ListItems(ctx, list)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	assertNames(t, notesOf(items), "Note one", "Note two")
	assertNames(t, buyable(items), "A", "C", "B")
	for _, it := range items {
		if it.Position < 1 {
			t.Fatalf("%s not renormalized: %v", it.Name, it.Position)
		}
	}
}
