package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// List returns all items in display order: unchecked by position, created_at,
// id, then checked by name (citext, case-insensitive).
func (s *Store) List(ctx context.Context) ([]Item, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+itemColumns+` FROM items
		ORDER BY checked,
		         CASE WHEN NOT checked THEN position END,
		         CASE WHEN checked THEN name END,
		         created_at, id`)
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
	return items, rows.Err()
}

// CreateOrRevive implements the POST semantics (§6): insert a new item at the
// bottom of the list; if the name already exists and is checked, uncheck it
// (revived=true); if it exists unchecked, no-op. All in one transaction so
// concurrent adds of the same name converge to one row. A nil id lets the
// database generate one; offline clients pass their own uuid.
func (s *Store) CreateOrRevive(ctx context.Context, name string, id *string) (item Item, created, revived bool, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// New item: max(position) over ALL items + 1024 (§3).
		row := tx.QueryRow(ctx, `
			INSERT INTO items (id, name, position)
			VALUES (COALESCE($3::uuid, gen_random_uuid()), $1,
			        (SELECT COALESCE(MAX(position), 0) + $2 FROM items))
			ON CONFLICT (name) DO NOTHING
			RETURNING `+itemColumns, name, float64(positionGap), id)
		item, err = scanItem(row)
		if err == nil {
			created = true
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}

		row = tx.QueryRow(ctx,
			`SELECT `+itemColumns+` FROM items WHERE name = $1 FOR UPDATE`, name)
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
		if item.Checked {
			row = tx.QueryRow(ctx, `
				UPDATE items SET checked = false, updated_at = now()
				WHERE id = $1::uuid RETURNING `+itemColumns, item.ID)
			item, err = scanItem(row)
			revived = true
		}
		return err
	})
	if isUniqueViolation(err) {
		// A client-supplied id colliding with an existing row under a
		// different name escapes ON CONFLICT (name) as a PK violation.
		return Item{}, false, false, ErrNameConflict
	}
	return item, created, revived, err
}

type UpdateParams struct {
	Name    *string
	Checked *bool
	Reorder *ReorderTarget
}

// Update applies rename, check/uncheck, and/or reorder atomically. Checking
// or unchecking never modifies position (§3); only a reorder does.
func (s *Store) Update(ctx context.Context, id string, p UpdateParams) (Item, error) {
	var item Item
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx,
			`SELECT `+itemColumns+` FROM items WHERE id = $1::uuid FOR UPDATE`, id)
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
		position := current.Position
		if p.Reorder != nil {
			position, err = computePosition(ctx, tx, id, *p.Reorder)
			if err != nil {
				return err
			}
		}

		row = tx.QueryRow(ctx, `
			UPDATE items SET name = $2, checked = $3, position = $4, updated_at = now()
			WHERE id = $1::uuid RETURNING `+itemColumns, id, name, checked, position)
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
func (s *Store) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM items WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ClearChecked deletes all checked items and reports how many were removed.
func (s *Store) ClearChecked(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM items WHERE checked`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
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
