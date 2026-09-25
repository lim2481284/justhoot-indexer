CREATE TABLE token_balance_events (
  event_id TEXT PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  event_index BIGINT NOT NULL CHECK (event_index >= 0),
  token_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  delta_raw TEXT NOT NULL CHECK (delta_raw ~ '^-?[0-9]+$'),
  event_type TEXT NOT NULL CHECK (event_type IN ('mint', 'transfer', 'burn')),
  block_height BIGINT NOT NULL CHECK (block_height >= 0),
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX token_balance_events_token_block_idx
  ON token_balance_events (token_id, block_height DESC);

CREATE TABLE token_balances (
  token_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  balance_raw TEXT NOT NULL CHECK (balance_raw ~ '^[0-9]+$'),
  updated_block_height BIGINT NOT NULL CHECK (updated_block_height >= 0),
  updated_at TEXT NOT NULL,
  is_excluded BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (token_id, account_id)
);

CREATE INDEX token_balances_holders_idx
  ON token_balances (token_id, is_excluded);

COMMENT ON COLUMN token_balances.is_excluded IS
  'True for accounts omitted from public holder statistics, such as liquidity pools or burn accounts.';
