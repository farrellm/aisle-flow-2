package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ListItems returns a list's items in display order (§3): notes first by
// position, then unchecked by position, then checked by name (citext,
// case-insensitive), all tie-broken by created_at, id. The client mirrors this
// exact order in sort.ts splitItems — change the two together.
// ErrListNotFound distinguishes a missing list from an empty one.
func (s *Store) ListItems(ctx context.Context, listID string) ([]Item, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+itemColumns+` FROM items
		WHERE list_id = $1::uuid
		ORDER BY CASE WHEN note THEN 0 WHEN NOT checked THEN 1 ELSE 2 END,
		         CASE WHEN NOT checked THEN position END,
		         CASE WHEN checked THEN name END,
		         created_at, id`, listID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		exists, err := s.listExists(ctx, listID)
		if err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrListNotFound
		}
	}
	return items, nil
}

// CreateOrRevive implements the POST semantics (§6): insert a new item at the
// bottom of the list; if the name already exists in this list and is checked
// or is a note, turn it back into a plain unchecked item (revived=true); if it
// already is a plain unchecked item, no-op. All in one
// transaction so concurrent adds of the same name converge to one row. A nil
// id lets the database generate one; offline clients pass their own uuid.
func (s *Store) CreateOrRevive(ctx context.Context, listID, name string, id *string) (item Item, created, revived bool, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// New item: max(position) over ALL items in the list + 1024 (§3).
		row := tx.QueryRow(ctx, `
			INSERT INTO items (id, list_id, name, position)
			VALUES (COALESCE($4::uuid, gen_random_uuid()), $1::uuid, $2,
			        (SELECT COALESCE(MAX(position), 0) + $3 FROM items WHERE list_id = $1::uuid))
			ON CONFLICT (list_id, name) DO NOTHING
			RETURNING `+itemColumns, listID, name, float64(positionGap), id)
		item, err = scanItem(row)
		if err == nil {
			created = true
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}

		row = tx.QueryRow(ctx, `
			SELECT `+itemColumns+` FROM items
			WHERE list_id = $1::uuid AND name = $2 FOR UPDATE`, listID, name)
		item, err = scanItem(row)
		if err == pgx.ErrNoRows {
			// The conflicting row was deleted between the two statements;
			// extremely unlikely at household scale. Surface as not found so
			// the client simply retries.
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// Revive covers both ways an existing row can be "not on the buy
		// list": checked, or turned into a note. Adding the name means the
		// user wants to buy it, so either state converges back to a plain
		// unchecked item.
		if item.Checked || item.Note {
			row = tx.QueryRow(ctx, `
				UPDATE items SET checked = false, note = false, updated_at = now()
				WHERE id = $1::uuid RETURNING `+itemColumns, item.ID)
			item, err = scanItem(row)
			revived = true
		}
		return err
	})
	if isForeignKeyViolation(err) {
		return Item{}, false, false, ErrListNotFound
	}
	if isUniqueViolation(err) {
		// A client-supplied id colliding with an existing row under a
		// different name escapes ON CONFLICT (list_id, name) as a PK violation.
		return Item{}, false, false, ErrNameConflict
	}
	return item, created, revived, err
}

type UpdateParams struct {
	Name    *string
	Checked *bool
	Note    *bool
	Reorder *ReorderTarget
}

// Update applies rename, check/uncheck, note/unnote, and/or reorder
// atomically. Checking, unchecking and converting to or from a note never
// modify position (§3); only a reorder does — which is what lets a note
// converted back to an item return to the slot it held before. A note is
// never checked; turning a checked item into a note unchecks it. An id that
// exists under a different list is ErrNotFound (§6: list membership check).
func (s *Store) Update(ctx context.Context, listID, id string, p UpdateParams) (Item, error) {
	var item Item
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			SELECT `+itemColumns+` FROM items
			WHERE id = $1::uuid AND list_id = $2::uuid FOR UPDATE`, id, listID)
		current, err := scanItem(row)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		name := current.Name
		if p.Name != nil {
			name = *p.Name
		}
		checked := current.Checked
		if p.Checked != nil {
			checked = *p.Checked
		}
		note := current.Note
		if p.Note != nil {
			note = *p.Note
		}
		if note {
			// The invariant behind the display order: a note is never checked
			// (also a CHECK constraint, migration 000003).
			checked = false
		}
		position := current.Position
		if p.Reorder != nil {
			position, err = computePosition(ctx, tx, listID, id, *p.Reorder)
			if err != nil {
				return err
			}
		}

		row = tx.QueryRow(ctx, `
			UPDATE items SET name = $2, checked = $3, note = $4, position = $5, updated_at = now()
			WHERE id = $1::uuid RETURNING `+itemColumns, id, name, checked, note, position)
		item, err = scanItem(row)
		return err
	})
	if isUniqueViolation(err) {
		return Item{}, ErrNameConflict
	}
	if err != nil {
		return Item{}, err
	}
	return item, nil
}

// Delete removes one item permanently.
func (s *Store) Delete(ctx context.Context, listID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM items WHERE id = $1::uuid AND list_id = $2::uuid`, id, listID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Ping verifies connectivity and that the schema is present (§8: fail fast).
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var n int
	return s.pool.QueryRow(ctx, `SELECT count(*) FROM items WHERE false`).Scan(&n)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
