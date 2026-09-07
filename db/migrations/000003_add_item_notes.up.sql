-- A note is an item that is a reminder rather than something to buy
-- ("skip the paprika, there's a full jar in the back"). Notes pin to the top
-- of the list and are never checked (DESIGN.md §2, §3).
ALTER TABLE items ADD COLUMN note boolean NOT NULL DEFAULT false;

-- The invariant the display order relies on: a note never sorts into the
-- checked section, because it can never be checked. Enforced here as well as
-- in store.Update so no path can violate it.
ALTER TABLE items ADD CONSTRAINT items_note_not_checked CHECK (NOT (note AND checked));
