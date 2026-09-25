ALTER TABLE swaps
  DROP CONSTRAINT IF EXISTS swaps_amount_in_raw_check,
  DROP CONSTRAINT IF EXISTS swaps_amount_out_raw_check,
  DROP CONSTRAINT IF EXISTS swaps_amount_in_check,
  DROP CONSTRAINT IF EXISTS swaps_amount_out_check,
  DROP CONSTRAINT IF EXISTS swaps_price_check,
  DROP CONSTRAINT IF EXISTS swaps_total_fee_check,
  DROP CONSTRAINT IF EXISTS swaps_protocol_fee_check;

ALTER TABLE swaps
  ALTER COLUMN event_index TYPE BIGINT,
  ALTER COLUMN timestamp TYPE TEXT USING timestamp::text,
  ALTER COLUMN amount_in_raw TYPE TEXT USING amount_in_raw::text,
  ALTER COLUMN amount_out_raw TYPE TEXT USING amount_out_raw::text,
  ALTER COLUMN amount_in TYPE TEXT USING amount_in::text,
  ALTER COLUMN amount_out TYPE TEXT USING amount_out::text,
  ALTER COLUMN price TYPE TEXT USING price::text,
  ALTER COLUMN total_fee TYPE TEXT USING total_fee::text,
  ALTER COLUMN protocol_fee TYPE TEXT USING protocol_fee::text;

COMMENT ON COLUMN swaps.timestamp IS
  'UTC ISO-8601 timestamp emitted by the Goldsky TypeScript transform.';

COMMENT ON COLUMN swaps.amount_in_raw IS
  'Exact raw token amount stored as decimal text to preserve arbitrary precision.';

COMMENT ON COLUMN swaps.amount_out_raw IS
  'Exact raw token amount stored as decimal text to preserve arbitrary precision.';

COMMENT ON COLUMN swaps.price IS
  'Canonical USDC per wNEAR price stored as fixed-point decimal text.';
