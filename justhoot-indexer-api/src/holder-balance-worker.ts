import type { FastifyBaseLogger } from "fastify";
import { db } from "./db.js";

const PROCESS_INTERVAL_MS = 5_000;
const BATCH_SIZE = 250;

type BalanceEvent = {
  event_id: string;
  token_id: string;
  account_id: string;
  delta_raw: string;
  block_height: string;
  timestamp: string;
};

async function processBalanceEventBatch(log: FastifyBaseLogger): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const events = await client.query<BalanceEvent>(
      `
        SELECT event_id, token_id, account_id, delta_raw, block_height, timestamp
        FROM token_balance_events
        WHERE processed_at IS NULL
        ORDER BY block_height ASC, event_index ASC, event_id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      [BATCH_SIZE],
    );

    for (const event of events.rows) {
      await client.query(
        `
          INSERT INTO token_balances (
            token_id,
            account_id,
            balance_raw,
            updated_block_height,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (token_id, account_id) DO UPDATE SET
            balance_raw = (
              token_balances.balance_raw::numeric
              + EXCLUDED.balance_raw::numeric
            )::text,
            updated_block_height = EXCLUDED.updated_block_height,
            updated_at = EXCLUDED.updated_at
        `,
        [
          event.token_id,
          event.account_id,
          event.delta_raw,
          event.block_height,
          event.timestamp,
        ],
      );

      await client.query(
        "UPDATE token_balance_events SET processed_at = NOW() WHERE event_id = $1",
        [event.event_id],
      );
    }

    await client.query("COMMIT");

    if (events.rows.length > 0) {
      log.info({ count: events.rows.length }, "Applied token balance events");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function startHolderBalanceWorker(log: FastifyBaseLogger): () => void {
  let processing = false;

  const run = async (): Promise<void> => {
    if (processing) return;
    processing = true;

    try {
      await processBalanceEventBatch(log);
    } catch (error) {
      log.error(error, "Failed to apply token balance events");
    } finally {
      processing = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), PROCESS_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
