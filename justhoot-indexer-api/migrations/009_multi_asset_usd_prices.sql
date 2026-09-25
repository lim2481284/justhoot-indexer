CREATE TABLE tracked_assets (
  asset_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, token_address)
);

CREATE TABLE asset_usd_prices (
  asset_id TEXT NOT NULL REFERENCES tracked_assets(asset_id),
  timestamp TIMESTAMPTZ NOT NULL,
  price_usd NUMERIC(38, 18) NOT NULL CHECK (price_usd > 0),
  source TEXT NOT NULL,
  source_pair_id TEXT,
  liquidity_usd NUMERIC(38, 8),
  source_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, timestamp)
);

CREATE INDEX asset_usd_prices_timestamp_idx
  ON asset_usd_prices (timestamp DESC);

INSERT INTO tracked_assets (asset_id, chain_id, token_address)
VALUES
  ('near', 'near', 'wrap.near'),
  ('eth', 'ethereum', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  ('btc', 'ethereum', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  ('sol', 'solana', 'So11111111111111111111111111111111111111112')
ON CONFLICT (asset_id) DO NOTHING;

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
