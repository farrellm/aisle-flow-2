package store

import (
	"context"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
)

// positionGap is the spacing between freshly assigned positions.
const positionGap = 1024

// minPositionGap is the smallest tolerated distance between a computed
// position and its neighbors; below this the table is renormalized (§3).
const minPositionGap = 1e-6

// ReorderTarget names the unchecked neighbors at the drop location.
// After is the item the moved row lands after (the row above it);
// Before is the item it lands before (the row below it).
// nil means the corresponding edge of the unchecked section.
type ReorderTarget struct {
	Before *string
	After  *string
}

// neighborPosition returns the position of the neighbor with the given id,
// locked FOR UPDATE. ErrNotFound if the id has vanished (§6 race notes).
func neighborPosition(ctx context.Context, tx pgx.Tx, id string) (float64, error) {
	var pos float64
	err := tx.QueryRow(ctx,
		`SELECT position FROM items WHERE id = $1::uuid FOR UPDATE`, id).Scan(&pos)
	if err == pgx.ErrNoRows {
		return 0, ErrNotFound
	}
	return pos, err
}

// computePosition derives the moved item's new position from its neighbors,
// renormalizing the whole table first if the gap is exhausted.
func computePosition(ctx context.Context, tx pgx.Tx, itemID string, target ReorderTarget) (float64, error) {
	pos, ok, err := tryComputePosition(ctx, tx, itemID, target)
	if err != nil {
		return 0, err
	}
	if ok {
		return pos, nil
	}
	if err := renormalize(ctx, tx); err != nil {
		return 0, err
	}
	pos, ok, err = tryComputePosition(ctx, tx, itemID, target)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, fmt.Errorf("position gap exhausted even after renormalization")
	}
	return pos, nil
}

// tryComputePosition returns (position, false, nil) when the midpoint would
// land too close to a neighbor and a renormalization is required.
func tryComputePosition(ctx context.Context, tx pgx.Tx, itemID string, target ReorderTarget) (float64, bool, error) {
	switch {
	case target.After != nil && target.Before != nil:
		above, err := neighborPosition(ctx, tx, *target.After)
		if err != nil {
			return 0, false, err
		}
		below, err := neighborPosition(ctx, tx, *target.Before)
		if err != nil {
			return 0, false, err
		}
		mid := (above + below) / 2
		if math.Abs(mid-above) < minPositionGap || math.Abs(mid-below) < minPositionGap {
			return 0, false, nil
		}
		return mid, true, nil
	case target.After != nil: // dropped at the bottom of the unchecked section
		above, err := neighborPosition(ctx, tx, *target.After)
		if err != nil {
			return 0, false, err
		}
		return above + positionGap, true, nil
	case target.Before != nil: // dropped at the top of the unchecked section
		below, err := neighborPosition(ctx, tx, *target.Before)
		if err != nil {
			return 0, false, err
		}
		return below - positionGap, true, nil
	default:
		// Only item in the unchecked section: keep its current position.
		pos, err := neighborPosition(ctx, tx, itemID)
		return pos, err == nil, err
	}
}

// renormalize rewrites every item's position to 1024, 2048, 3072, … following
// the current canonical order: unchecked by position first, then checked by
// position, ties broken by created_at, id (§3). Relative order of all items,
// checked included, is preserved.
func renormalize(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		WITH ordered AS (
			SELECT id, row_number() OVER (
				ORDER BY checked, position, created_at, id
			) AS rn
			FROM items
		)
		UPDATE items SET position = ordered.rn * $1::double precision
		FROM ordered WHERE items.id = ordered.id`, float64(positionGap))
	return err
}
