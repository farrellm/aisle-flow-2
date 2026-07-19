CREATE TABLE lists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       citext NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT lists_name_unique UNIQUE (name),
    CONSTRAINT lists_name_not_blank CHECK (btrim(name) <> '')
);

-- The pre-existing single list becomes a named list owning all items (§5).
INSERT INTO lists (name) VALUES ('Groceries');

ALTER TABLE items ADD COLUMN list_id uuid;
UPDATE items SET list_id = (SELECT id FROM lists WHERE name = 'Groceries');
ALTER TABLE items
    ALTER COLUMN list_id SET NOT NULL,
    ADD CONSTRAINT items_list_fk FOREIGN KEY (list_id)
        REFERENCES lists (id) ON DELETE CASCADE,
    DROP CONSTRAINT items_name_unique,
    ADD CONSTRAINT items_list_name_unique UNIQUE (list_id, name);

-- Serves the two display orderings, now per list.
DROP INDEX items_position_idx;
DROP INDEX items_checked_name_idx;
CREATE INDEX items_list_position_idx     ON items (list_id, position);
CREATE INDEX items_list_checked_name_idx ON items (list_id, checked, name);
