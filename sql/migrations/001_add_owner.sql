-- Migration: add owner_id to clothes and outfits
ALTER TABLE clothes
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);

ALTER TABLE outfits
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);

-- Optional: set owner_id for existing rows to NULL (no-op)
UPDATE clothes SET owner_id = NULL WHERE owner_id IS NULL;
UPDATE outfits SET owner_id = NULL WHERE owner_id IS NULL;
