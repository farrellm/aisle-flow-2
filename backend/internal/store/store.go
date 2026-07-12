// Package store owns all SQL and the position algorithm (DESIGN.md §3, §8).
package store

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound     = errors.New("item not found")
	ErrNameConflict = errors.New("an item with that name already exists")
)

type Item struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Checked   bool      `json:"checked"`
	Position  float64   `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

const itemColumns = `id::text, name::text, checked, position, created_at, updated_at`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanItem(row rowScanner) (Item, error) {
	var it Item
	err := row.Scan(&it.ID, &it.Name, &it.Checked, &it.Position, &it.CreatedAt, &it.UpdatedAt)
	return it, err
}
