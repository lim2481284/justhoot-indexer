INSERT INTO tokens (contract_id, symbol, name, decimals)
VALUES
  (
    '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    'USDC',
    'USDC',
    6
  ),
  (
    'wrap.near',
    'wNEAR',
    'Wrapped NEAR fungible token',
    24
  )
ON CONFLICT (contract_id) DO UPDATE SET
  symbol = EXCLUDED.symbol,
  name = EXCLUDED.name,
  decimals = EXCLUDED.decimals,
  updated_at = NOW();

INSERT INTO pools (pool_id, token_x, token_y, fee)
VALUES (
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1|wrap.near|100',
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  'wrap.near',
  100
)
ON CONFLICT (pool_id) DO UPDATE SET
  token_x = EXCLUDED.token_x,
  token_y = EXCLUDED.token_y,
  fee = EXCLUDED.fee,
  updated_at = NOW();

COMMENT ON COLUMN swaps.price IS
  'Canonical token_x per token_y execution price, independent of swap direction';
