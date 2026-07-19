-- Lossy: folds every list's items back into one global namespace. Where the
-- same name exists in several lists, only the oldest row (created_at, id)
-- survives so the global unique constraint can be restored.
DELETE FROM items a USING items b
 WHERE a.name = b.name AND a.id <> b.id
   AND (a.created_at, a.id) > (b.created_at, b.id);

ALTER TABLE items
    DROP CONSTRAINT items_list_name_unique,
    DROP COLUMN list_id,
    ADD CONSTRAINT items_name_unique UNIQUE (name);

CREATE INDEX items_position_idx ON items (position);
CREATE INDEX items_checked_name_idx ON items (checked, name);

DROP TABLE lists;
