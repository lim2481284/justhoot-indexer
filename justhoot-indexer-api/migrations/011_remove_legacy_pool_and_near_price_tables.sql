INSERT INTO asset_usd_prices (
  asset_id,
  timestamp,
  price_usd,
  source,
  source_pair_id,
  liquidity_usd,
  source_timestamp
)
SELECT
  'near',
  timestamp,
  near_usd_price,
  source,
  source_pool_id,
  NULL,
  source_timestamp
FROM near_usd_prices
ON CONFLICT (asset_id, timestamp) DO NOTHING;

DROP TABLE near_usd_prices;
DROP TABLE pools;
