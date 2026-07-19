package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ListLists returns all lists, oldest first (stable across renames).
func (s *Store) ListLists(ctx context.Context) ([]List, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+listColumns+` FROM lists ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	lists := []List{}
	for rows.Next() {
		l, err := scanList(rows)
		if err != nil {
			return nil, err
		}
		lists = append(lists, l)
	}
	return lists, rows.Err()
}

// CreateList creates a list. A nil id lets the database generate one; offline
// clients pass their own uuid so a queued create-list → add-items chain can
// reference the list before the response arrives (§13).
func (s *Store) CreateList(ctx context.Context, name string, id *string) (List, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO lists (id, name)
		VALUES (COALESCE($2::uuid, gen_random_uuid()), $1)
		RETURNING `+listColumns, name, id)
	list, err := scanList(row)
	if isUniqueViolation(err) {
		return List{}, ErrNameConflict
	}
	return list, err
}

// RenameList changes a list's name.
func (s *Store) RenameList(ctx context.Context, id, name string) (List, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE lists SET name = $2, updated_at = now()
		WHERE id = $1::uuid RETURNING `+listColumns, id, name)
	list, err := scanList(row)
	if err == pgx.ErrNoRows {
		return List{}, ErrListNotFound
	}
	if isUniqueViolation(err) {
		return List{}, ErrNameConflict
	}
	return list, err
}

// DeleteList removes a list and (via FK cascade) all its items. Deleting the
// only remaining list is refused; all list rows are locked first so two
// concurrent deletes of the two remaining lists cannot both succeed.
func (s *Store) DeleteList(ctx context.Context, id string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var count int
		err := tx.QueryRow(ctx, `
			SELECT count(*) FROM (SELECT id FROM lists FOR UPDATE) locked`).Scan(&count)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM lists WHERE id = $1::uuid`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrListNotFound
		}
		if count <= 1 {
			return ErrLastList
		}
		return nil
	})
}

// listExists reports whether a list row exists (used to distinguish an empty
// list from a deleted one — the frontend's redirect relies on the 404).
func (s *Store) listExists(ctx context.Context, listID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM lists WHERE id = $1::uuid)`, listID).Scan(&exists)
	return exists, err
}
