ALTER TABLE swaps
  ADD COLUMN IF NOT EXISTS base_token TEXT,
  ADD COLUMN IF NOT EXISTS quote_token TEXT,
  ADD COLUMN IF NOT EXISTS price_usd TEXT,
  ADD COLUMN IF NOT EXISTS candle_processed_at TIMESTAMPTZ;

ALTER TABLE candles
  DROP CONSTRAINT IF EXISTS candles_pool_id_fkey,
  ALTER COLUMN open TYPE NUMERIC,
  ALTER COLUMN high TYPE NUMERIC,
  ALTER COLUMN low TYPE NUMERIC,
  ALTER COLUMN close TYPE NUMERIC,
  ALTER COLUMN volume TYPE NUMERIC,
  ADD COLUMN IF NOT EXISTS base_token TEXT,
  ADD COLUMN IF NOT EXISTS quote_token TEXT,
  ADD COLUMN IF NOT EXISTS open_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS high_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS low_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS close_usd NUMERIC;

CREATE INDEX IF NOT EXISTS swaps_candle_pending_idx
  ON swaps (block_height, event_index)
  WHERE candle_processed_at IS NULL;

COMMENT ON COLUMN candles.open IS 'Opening price denominated in quote_token.';
COMMENT ON COLUMN candles.volume IS 'Normalized base-token trading volume.';
COMMENT ON COLUMN candles.open_usd IS 'Opening USD price when quote-token conversion is available.';
