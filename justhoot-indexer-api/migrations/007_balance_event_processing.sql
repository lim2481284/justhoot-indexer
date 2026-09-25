ALTER TABLE token_balance_events
  ADD COLUMN processed_at TIMESTAMPTZ;

CREATE INDEX token_balance_events_unprocessed_idx
  ON token_balance_events (block_height, event_index, event_id)
  WHERE processed_at IS NULL;
