import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { db } from "./db.js";

const PROCESS_INTERVAL_MS = 5_000;
const BATCH_SIZE = 100;
const LAUNCHPAD_SUFFIX = ".launchpad.hoot.near";
const NEAR_RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";
const USD_STABLE_QUOTES = new Set([
  "usdt.near",
  "usdt.tether-token.near",
  "usdc.circle-token.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
]);
const INTERVALS = [
  ["1m", 1], ["5m", 5], ["15m", 15], ["1h", 60], ["4h", 240], ["1d", 1440],
] as const;

type RawSwap = {
  event_id: string;
  pool_id: string;
  token_in: string;
  token_out: string;
  amount_in_raw: string;
  amount_out_raw: string;
  timestamp: string;
};

type TokenMetadata = { symbol: string; name: string; decimals: number };

function bucketStart(timestamp: string, minutes: number): Date {
  const date = new Date(timestamp);
  const size = minutes * 60_000;
  return new Date(Math.floor(date.getTime() / size) * size);
}

async function fetchTokenMetadata(tokenId: string): Promise<TokenMetadata> {
  const response = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `ft-metadata:${tokenId}`,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: tokenId,
        method_name: "ft_metadata",
        args_base64: "e30=",
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned ${response.status}`);

  const payload = await response.json() as {
    result?: { result?: number[] };
    error?: unknown;
  };
  if (!Array.isArray(payload.result?.result)) {
    throw new Error(`ft_metadata unavailable for ${tokenId}`);
  }
  const metadata = JSON.parse(
    Buffer.from(payload.result.result).toString("utf8"),
  ) as Partial<TokenMetadata>;
  if (
    typeof metadata.symbol !== "string" ||
    typeof metadata.name !== "string" ||
    !Number.isInteger(metadata.decimals) ||
    (metadata.decimals as number) < 0 ||
    (metadata.decimals as number) > 38
  ) {
    throw new Error(`Invalid ft_metadata for ${tokenId}`);
  }
  return metadata as TokenMetadata;
}

async function ensureTokenMetadata(
  client: PoolClient,
  tokenId: string,
): Promise<TokenMetadata> {
  const existing = await client.query<TokenMetadata>(
    "SELECT symbol, name, decimals FROM tokens WHERE contract_id = $1",
    [tokenId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const metadata = await fetchTokenMetadata(tokenId);
  await client.query(
    `INSERT INTO tokens (contract_id, symbol, name, decimals)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (contract_id) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       name = EXCLUDED.name,
       decimals = EXCLUDED.decimals,
       updated_at = NOW()`,
    [tokenId, metadata.symbol, metadata.name, metadata.decimals],
  );
  return metadata;
}

async function usdFactor(
  client: PoolClient,
  quoteToken: string,
  timestamp: string,
): Promise<string | null> {
  if (USD_STABLE_QUOTES.has(quoteToken)) return "1";
  if (quoteToken !== "wrap.near") return null;

  const result = await client.query<{ price_usd: string }>(
    `SELECT price_usd
     FROM asset_usd_prices
     WHERE asset_id = 'near' AND timestamp <= $1::timestamptz
     ORDER BY timestamp DESC
     LIMIT 1`,
    [timestamp],
  );
  return result.rows[0]?.price_usd ?? null;
}

async function rebuildCandles(
  client: PoolClient,
  swap: RawSwap,
  baseToken: string,
  quoteToken: string,
): Promise<void> {
  for (const [interval, minutes] of INTERVALS) {
    const start = bucketStart(swap.timestamp, minutes);
    const end = new Date(start.getTime() + minutes * 60_000);
    await client.query(
      `
        INSERT INTO candles (
          pool_id, interval, timestamp, base_token, quote_token,
          open, high, low, close, volume, trade_count,
          open_usd, high_usd, low_usd, close_usd, updated_at
        )
        SELECT
          $1, $2, $3, $4, $5,
          (array_agg(price::numeric ORDER BY timestamp::timestamptz, event_id))[1],
          MAX(price::numeric), MIN(price::numeric),
          (array_agg(price::numeric ORDER BY timestamp::timestamptz DESC, event_id DESC))[1],
          SUM(CASE WHEN token_in = $4 THEN amount_in::numeric ELSE amount_out::numeric END),
          COUNT(*)::integer,
          (array_agg(price_usd::numeric ORDER BY timestamp::timestamptz, event_id)
            FILTER (WHERE price_usd IS NOT NULL))[1],
          MAX(price_usd::numeric), MIN(price_usd::numeric),
          (array_agg(price_usd::numeric ORDER BY timestamp::timestamptz DESC, event_id DESC)
            FILTER (WHERE price_usd IS NOT NULL))[1],
          NOW()
        FROM swaps
        WHERE pool_id = $1
          AND price IS NOT NULL
          AND timestamp::timestamptz >= $3
          AND timestamp::timestamptz < $6
        ON CONFLICT (pool_id, interval, timestamp) DO UPDATE SET
          base_token = EXCLUDED.base_token,
          quote_token = EXCLUDED.quote_token,
          open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
          close = EXCLUDED.close, volume = EXCLUDED.volume,
          trade_count = EXCLUDED.trade_count,
          open_usd = EXCLUDED.open_usd, high_usd = EXCLUDED.high_usd,
          low_usd = EXCLUDED.low_usd, close_usd = EXCLUDED.close_usd,
          updated_at = NOW()
      `,
      [swap.pool_id, interval, start, baseToken, quoteToken, end],
    );
  }
}

async function processCandleBatch(log: FastifyBaseLogger): Promise<void> {
  const client = await db.connect();
  try {
    const swaps = await client.query<RawSwap>(
      `SELECT event_id, pool_id, token_in, token_out,
              amount_in_raw, amount_out_raw, timestamp
       FROM swaps
       WHERE candle_processed_at IS NULL
         AND (token_in LIKE $1 OR token_out LIKE $1)
       ORDER BY block_height, event_index, event_id
       LIMIT $2`,
      [`%${LAUNCHPAD_SUFFIX}`, BATCH_SIZE],
    );

    for (const swap of swaps.rows) {
      try {
        const baseToken = swap.token_in.endsWith(LAUNCHPAD_SUFFIX)
          ? swap.token_in : swap.token_out;
        const quoteToken = baseToken === swap.token_in ? swap.token_out : swap.token_in;
        const inMetadata = await ensureTokenMetadata(client, swap.token_in);
        const outMetadata = await ensureTokenMetadata(client, swap.token_out);
        const factor = await usdFactor(client, quoteToken, swap.timestamp);

        await client.query("BEGIN");
        await client.query(
          `UPDATE swaps SET
             amount_in = (amount_in_raw::numeric / power(10::numeric, $2))::text,
             amount_out = (amount_out_raw::numeric / power(10::numeric, $3))::text,
             base_token = $4,
             quote_token = $5,
             price = (
               (CASE WHEN token_in = $5 THEN amount_in_raw::numeric / power(10::numeric, $2)
                     ELSE amount_out_raw::numeric / power(10::numeric, $3) END) /
               (CASE WHEN token_in = $4 THEN amount_in_raw::numeric / power(10::numeric, $2)
                     ELSE amount_out_raw::numeric / power(10::numeric, $3) END)
             )::text,
             price_usd = CASE WHEN $6::numeric IS NULL THEN NULL ELSE (
               ((CASE WHEN token_in = $5 THEN amount_in_raw::numeric / power(10::numeric, $2)
                      ELSE amount_out_raw::numeric / power(10::numeric, $3) END) /
                (CASE WHEN token_in = $4 THEN amount_in_raw::numeric / power(10::numeric, $2)
                      ELSE amount_out_raw::numeric / power(10::numeric, $3) END)) * $6::numeric
             )::text END,
             candle_processed_at = NOW()
           WHERE event_id = $1`,
          [swap.event_id, inMetadata.decimals, outMetadata.decimals, baseToken, quoteToken, factor],
        );
        await rebuildCandles(client, swap, baseToken, quoteToken);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        log.warn({ err: error, event_id: swap.event_id }, "Candle swap processing deferred");
      }
    }
    if (swaps.rows.length > 0) log.info({ count: swaps.rows.length }, "Processed candle swaps");
  } finally {
    client.release();
  }
}

export function startCandleWorker(log: FastifyBaseLogger): () => void {
  let processing = false;
  const run = async () => {
    if (processing) return;
    processing = true;
    try { await processCandleBatch(log); }
    catch (error) { log.error(error, "Failed to process candles"); }
    finally { processing = false; }
  };
  void run();
  const timer = setInterval(() => void run(), PROCESS_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
