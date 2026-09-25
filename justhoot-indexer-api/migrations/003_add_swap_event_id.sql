ALTER TABLE swaps
  ADD COLUMN event_id TEXT;

UPDATE swaps
SET event_id = transaction_hash || ':' || event_index::TEXT
WHERE event_id IS NULL;

ALTER TABLE swaps
  ALTER COLUMN event_id SET NOT NULL;

ALTER TABLE swaps
  ADD CONSTRAINT swaps_event_id_key UNIQUE (event_id);
