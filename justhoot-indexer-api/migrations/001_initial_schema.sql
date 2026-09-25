CREATE TABLE tokens (
  contract_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pools (
  pool_id TEXT PRIMARY KEY,
  token_x TEXT NOT NULL REFERENCES tokens(contract_id),
  token_y TEXT NOT NULL REFERENCES tokens(contract_id),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (token_x <> token_y)
);

CREATE TABLE swaps (
  id BIGSERIAL PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL CHECK (event_index >= 0),
  block_height BIGINT NOT NULL CHECK (block_height >= 0),
  timestamp TIMESTAMPTZ NOT NULL,
  pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  token_in TEXT NOT NULL REFERENCES tokens(contract_id),
  token_out TEXT NOT NULL REFERENCES tokens(contract_id),
  amount_in_raw NUMERIC(78, 0) NOT NULL CHECK (amount_in_raw > 0),
  amount_out_raw NUMERIC(78, 0) NOT NULL CHECK (amount_out_raw > 0),
  amount_in NUMERIC(38, 18) NOT NULL CHECK (amount_in > 0),
  amount_out NUMERIC(38, 18) NOT NULL CHECK (amount_out > 0),
  price NUMERIC(38, 18) NOT NULL CHECK (price > 0),
  swapper TEXT,
  total_fee NUMERIC(78, 0) CHECK (total_fee >= 0),
  protocol_fee NUMERIC(78, 0) CHECK (protocol_fee >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_hash, event_index),
  CHECK (token_in <> token_out)
);

CREATE INDEX swaps_pool_timestamp_idx
  ON swaps (pool_id, timestamp DESC);

CREATE INDEX swaps_block_height_idx
  ON swaps (block_height);

CREATE TABLE candles (
  pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  interval TEXT NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '4h', '1d')),
  timestamp TIMESTAMPTZ NOT NULL,
  open NUMERIC(38, 18) NOT NULL CHECK (open > 0),
  high NUMERIC(38, 18) NOT NULL CHECK (high > 0),
  low NUMERIC(38, 18) NOT NULL CHECK (low > 0),
  close NUMERIC(38, 18) NOT NULL CHECK (close > 0),
  volume NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (volume >= 0),
  trade_count INTEGER NOT NULL DEFAULT 0 CHECK (trade_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, interval, timestamp),
  CHECK (high >= low),
  CHECK (high >= open AND high >= close),
  CHECK (low <= open AND low <= close)
);

CREATE INDEX candles_interval_timestamp_idx
  ON candles (interval, timestamp DESC);

CREATE TABLE near_usd_prices (
  timestamp TIMESTAMPTZ PRIMARY KEY,
  near_usd_price NUMERIC(38, 18) NOT NULL CHECK (near_usd_price > 0),
  source_pool_id TEXT NOT NULL REFERENCES pools(pool_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
