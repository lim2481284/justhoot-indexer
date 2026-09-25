ALTER TABLE near_usd_prices
  ALTER COLUMN source_pool_id DROP NOT NULL,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'ref-dcl-usdc-wnear',
  ADD COLUMN source_timestamp TIMESTAMPTZ;

COMMENT ON COLUMN near_usd_prices.source IS
  'Provider used for this observation, such as binance-nearusdt.';

COMMENT ON COLUMN near_usd_prices.source_timestamp IS
  'Time at which the provider price was observed.';
