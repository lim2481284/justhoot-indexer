import type { FastifyBaseLogger } from "fastify";
import { db } from "./db.js";

const PRICE_URL =
  "https://data-api.binance.vision/api/v3/ticker/price?symbol=NEARUSDT";
const COLLECTION_INTERVAL_MS = 60_000;

type BinanceTickerResponse = {
  symbol?: unknown;
  price?: unknown;
};

async function collectNearUsdPrice(log: FastifyBaseLogger): Promise<void> {
  const response = await fetch(PRICE_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Binance price request failed with status ${response.status}`);
  }

  const ticker = (await response.json()) as BinanceTickerResponse;
  const price = ticker.price;

  if (
    ticker.symbol !== "NEARUSDT" ||
    typeof price !== "string" ||
    !/^\d+(\.\d+)?$/.test(price) ||
    !Number.isFinite(Number(price)) ||
    Number(price) <= 0
  ) {
    throw new Error("Binance returned an invalid NEARUSDT price");
  }

  await db.query(
    `
      INSERT INTO near_usd_prices (
        timestamp,
        near_usd_price,
        source_pool_id,
        source,
        source_timestamp
      )
      VALUES (date_trunc('minute', NOW()), $1, NULL, 'binance-nearusdt', NOW())
      ON CONFLICT (timestamp) DO UPDATE SET
        near_usd_price = EXCLUDED.near_usd_price,
        source_pool_id = EXCLUDED.source_pool_id,
        source = EXCLUDED.source,
        source_timestamp = EXCLUDED.source_timestamp
    `,
    [price],
  );

  log.info({ price, source: "binance-nearusdt" }, "Stored NEAR/USD price");
}

export function startNearUsdCollector(log: FastifyBaseLogger): () => void {
  let collectionInProgress = false;

  const run = async (): Promise<void> => {
    if (collectionInProgress) return;
    collectionInProgress = true;

    try {
      await collectNearUsdPrice(log);
    } catch (error) {
      log.error(error, "Failed to collect NEAR/USD price");
    } finally {
      collectionInProgress = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), COLLECTION_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
