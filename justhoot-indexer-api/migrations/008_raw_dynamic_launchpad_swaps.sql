ALTER TABLE swaps
  DROP CONSTRAINT IF EXISTS swaps_pool_id_fkey,
  DROP CONSTRAINT IF EXISTS swaps_token_in_fkey,
  DROP CONSTRAINT IF EXISTS swaps_token_out_fkey,
  ALTER COLUMN amount_in DROP NOT NULL,
  ALTER COLUMN amount_out DROP NOT NULL,
  ALTER COLUMN price DROP NOT NULL;

COMMENT ON COLUMN swaps.pool_id IS
  'Ref DCL pool identifier parsed directly from the on-chain swap event.';

COMMENT ON COLUMN swaps.token_in IS
  'Input token contract from the on-chain swap event; no tokens-table row is required.';

COMMENT ON COLUMN swaps.token_out IS
  'Output token contract from the on-chain swap event; no tokens-table row is required.';

COMMENT ON COLUMN swaps.amount_in_raw IS
  'Original token_in amount in the token smallest unit, before decimal normalization.';

COMMENT ON COLUMN swaps.amount_out_raw IS
  'Original token_out amount in the token smallest unit, before decimal normalization.';

COMMENT ON COLUMN swaps.amount_in IS
  'Legacy optional normalized amount. New dynamic JustHoot swaps leave this null.';

COMMENT ON COLUMN swaps.amount_out IS
  'Legacy optional normalized amount. New dynamic JustHoot swaps leave this null.';

COMMENT ON COLUMN swaps.price IS
  'Legacy optional normalized price. New dynamic JustHoot swaps leave this null.';
