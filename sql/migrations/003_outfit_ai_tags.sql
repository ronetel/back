ALTER TABLE outfits
  ADD COLUMN IF NOT EXISTS ai_tags JSONB;

CREATE INDEX IF NOT EXISTS idx_outfits_ai_tags ON outfits USING gin(ai_tags);
