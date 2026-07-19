package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ListItems returns a list's items in display order: unchecked by position,
// created_at, id, then checked by name (citext, case-insensitive).
// ErrListNotFound distinguishes a missing list from an empty one.
func (s *Store) ListItems(ctx context.Context, listID string) ([]Item, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+itemColumns+` FROM items
		WHERE list_id = $1::uuid
		ORDER BY checked,
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
// bottom of the list; if the name already exists in this list and is checked,
// uncheck it (revived=true); if it exists unchecked, no-op. All in one
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
		if item.Checked {
			row = tx.QueryRow(ctx, `
				UPDATE items SET checked = false, updated_at = now()
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
	Reorder *ReorderTarget
}

// Update applies rename, check/uncheck, and/or reorder atomically. Checking
// or unchecking never modifies position (§3); only a reorder does. An id that
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
		position := current.Position
		if p.Reorder != nil {
			position, err = computePosition(ctx, tx, listID, id, *p.Reorder)
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

// ClearChecked deletes a list's checked items and reports how many were
// removed. ErrListNotFound if the list itself is gone.
func (s *Store) ClearChecked(ctx context.Context, listID string) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM items WHERE checked AND list_id = $1::uuid`, listID)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		exists, err := s.listExists(ctx, listID)
		if err != nil {
			return 0, err
		}
		if !exists {
			return 0, ErrListNotFound
		}
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

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
