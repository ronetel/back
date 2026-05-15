-- Add weather range and "where to wear" fields to outfits
ALTER TABLE outfits
  ADD COLUMN IF NOT EXISTS temp_min INTEGER,
  ADD COLUMN IF NOT EXISTS temp_max INTEGER,
  ADD COLUMN IF NOT EXISTS where_to_wear TEXT[] DEFAULT '{}';
