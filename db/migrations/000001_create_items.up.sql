CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       citext NOT NULL,
    checked    boolean NOT NULL DEFAULT false,
    position   double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT items_name_unique UNIQUE (name),
    CONSTRAINT items_name_not_blank CHECK (btrim(name) <> '')
);

-- Serves the two display orderings.
CREATE INDEX items_position_idx ON items (position);
CREATE INDEX items_checked_name_idx ON items (checked, name);
