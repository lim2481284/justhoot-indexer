import type { FastifyBaseLogger } from "fastify";
import { db } from "./db.js";

const PRICE_URL =
  "https://api.dexscreener.com/token-pairs/v1/near/wrap.near";
const COLLECTION_INTERVAL_MS = 60_000;

type DexscreenerPair = {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  priceUsd?: unknown;
  liquidity?: {
    usd?: unknown;
  };
};

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d+(\.\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0;
}

async function collectNearUsdPrice(log: FastifyBaseLogger): Promise<void> {
  const response = await fetch(PRICE_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Dexscreener price request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;

  if (!Array.isArray(payload)) {
    throw new Error("Dexscreener returned an invalid pair list");
  }

  const pair = (payload as DexscreenerPair[])
    .filter((candidate) =>
      candidate.chainId === "near" &&
      typeof candidate.dexId === "string" &&
      typeof candidate.pairAddress === "string" &&
      isPositiveDecimal(candidate.priceUsd) &&
      typeof candidate.liquidity?.usd === "number" &&
      Number.isFinite(candidate.liquidity.usd) &&
      candidate.liquidity.usd > 0
    )
    .sort((left, right) =>
      (right.liquidity?.usd as number) - (left.liquidity?.usd as number)
    )[0];

  if (!pair || !isPositiveDecimal(pair.priceUsd)) {
    throw new Error("Dexscreener returned no liquid NEAR pair with a USD price");
  }

  const price = pair.priceUsd;
  const source = `dexscreener:${pair.dexId}:${pair.pairAddress}`;

  await db.query(
    `
      INSERT INTO near_usd_prices (
        timestamp,
        near_usd_price,
        source_pool_id,
        source,
        source_timestamp
      )
      VALUES (date_trunc('minute', NOW()), $1, NULL, $2, NOW())
      ON CONFLICT (timestamp) DO UPDATE SET
        near_usd_price = EXCLUDED.near_usd_price,
        source_pool_id = EXCLUDED.source_pool_id,
        source = EXCLUDED.source,
        source_timestamp = EXCLUDED.source_timestamp
    `,
    [price, source],
  );

  log.info(
    { price, source, liquidity_usd: pair.liquidity?.usd },
    "Stored NEAR/USD price",
  );
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
