import Fastify from "fastify";
import { db } from "./db.js";
import { startCandleWorker } from "./candle-worker.js";
import { startHolderBalanceWorker } from "./holder-balance-worker.js";
import { startAssetUsdCollector } from "./near-usd-collector.js";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => ({
  status: "ok",
  service: "justhoot-indexer-api",
}));

app.get("/health/db", async (_request, reply) => {
  if (!process.env.DATABASE_URL) {
    return reply.status(503).send({
      status: "error",
      database: "not_configured",
    });
  }

  try {
    const result = await db.query<{
      database: string;
      checked_at: Date;
      schema_ready: boolean;
    }>(`
      SELECT
        current_database() AS database,
        NOW() AS checked_at,
        to_regclass('public.tokens') IS NOT NULL
          AND to_regclass('public.swaps') IS NOT NULL
          AND to_regclass('public.candles') IS NOT NULL
          AND to_regclass('public.tracked_assets') IS NOT NULL
          AND to_regclass('public.asset_usd_prices') IS NOT NULL
          AND to_regclass('public.token_balance_events') IS NOT NULL
          AND to_regclass('public.token_balances') IS NOT NULL
          AS schema_ready
    `);

    return {
      status: "ok",
      database: "connected",
      database_name: result.rows[0]?.database,
      checked_at: result.rows[0]?.checked_at,
      schema_ready: result.rows[0]?.schema_ready ?? false,
    };
  } catch (error) {
    app.log.error(error, "Database health check failed");

    return reply.status(503).send({
      status: "error",
      database: "unavailable",
    });
  }
});

type SwapRow = {
  event_id: string;
  transaction_hash: string;
  event_index: string;
  block_height: string;
  timestamp: string;
  pool_id: string;
  token_in: string;
  token_out: string;
  amount_in_raw: string;
  amount_out_raw: string;
  swapper: string | null;
  total_fee: string | null;
  protocol_fee: string | null;
};

const launchpadTokenSuffix = ".launchpad.hoot.near";

function describePool(poolId: string) {
  const [tokenX, tokenY, feeTier] = poolId.split("|");
  const launchpadToken = tokenX?.endsWith(launchpadTokenSuffix)
    ? tokenX
    : tokenY?.endsWith(launchpadTokenSuffix)
      ? tokenY
      : null;

  return {
    token_x: tokenX ?? null,
    token_y: tokenY ?? null,
    fee_tier: feeTier ?? null,
    launchpad_token: launchpadToken,
    counter_token: launchpadToken === null
      ? null
      : launchpadToken === tokenX
        ? tokenY ?? null
        : tokenX ?? null,
  };
}

function formatTokenAmount(rawAmount: string, decimals: number): string {
  const padded = rawAmount.padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0
    ? ""
    : padded.slice(-decimals).replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole;
}

app.get<{ Params: { poolId: string }; Querystring: { limit?: string } }>(
  "/api/pools/:poolId/swaps",
  async (request, reply) => {
    const parsedLimit = Number(request.query.limit ?? 50);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return reply.status(400).send({
        error: "invalid_limit",
        message: "limit must be an integer between 1 and 200",
      });
    }

    try {
      const result = await db.query<SwapRow>(
        `
          SELECT
            event_id,
            transaction_hash,
            event_index,
            block_height,
            timestamp,
            pool_id,
            token_in,
            token_out,
            amount_in_raw,
            amount_out_raw,
            swapper,
            total_fee,
            protocol_fee
          FROM swaps
          WHERE pool_id = $1
          ORDER BY timestamp DESC, event_id DESC
          LIMIT $2
        `,
        [request.params.poolId, parsedLimit],
      );

      return {
        pool_id: request.params.poolId,
        ...describePool(request.params.poolId),
        amounts_are_raw: true,
        count: result.rowCount ?? result.rows.length,
        swaps: result.rows,
      };
    } catch (error) {
      app.log.error(error, "Failed to fetch pool swaps");

      return reply.status(503).send({
        error: "database_unavailable",
        message: "Unable to fetch swaps",
      });
    }
  },
);

app.get<{
  Params: { poolId: string };
  Querystring: { interval?: string; from?: string; to?: string; limit?: string };
}>("/api/pools/:poolId/candles", async (request, reply) => {
  const interval = request.query.interval ?? "1m";
  const parsedLimit = Number(request.query.limit ?? 500);
  const from = request.query.from;
  const to = request.query.to;
  const allowedIntervals = ["1m", "5m", "15m", "1h", "4h", "1d"];

  if (!allowedIntervals.includes(interval)) {
    return reply.status(400).send({ error: "invalid_interval" });
  }
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000) {
    return reply.status(400).send({ error: "invalid_limit" });
  }
  if (from !== undefined && Number.isNaN(Date.parse(from))) {
    return reply.status(400).send({ error: "invalid_from" });
  }
  if (to !== undefined && Number.isNaN(Date.parse(to))) {
    return reply.status(400).send({ error: "invalid_to" });
  }

  try {
    const result = await db.query(
      `SELECT pool_id, interval, timestamp, base_token, quote_token,
              open, high, low, close, volume, trade_count,
              open_usd, high_usd, low_usd, close_usd
       FROM (
         SELECT pool_id, interval, timestamp, base_token, quote_token,
                open, high, low, close, volume, trade_count,
                open_usd, high_usd, low_usd, close_usd
         FROM candles
         WHERE pool_id = $1 AND interval = $2
           AND ($3::timestamptz IS NULL OR timestamp >= $3::timestamptz)
           AND ($4::timestamptz IS NULL OR timestamp <= $4::timestamptz)
         ORDER BY timestamp DESC
         LIMIT $5
       ) recent
       ORDER BY timestamp ASC`,
      [request.params.poolId, interval, from ?? null, to ?? null, parsedLimit],
    );
    return {
      pool_id: request.params.poolId,
      interval,
      count: result.rowCount ?? result.rows.length,
      candles: result.rows,
    };
  } catch (error) {
    app.log.error(error, "Failed to fetch candles");
    return reply.status(503).send({ error: "database_unavailable" });
  }
});

app.get("/api/prices/near-usd/latest", async (_request, reply) => {
  try {
    const result = await db.query<{
      timestamp: Date;
      near_usd_price: string;
      source: string;
      source_timestamp: Date;
      stale: boolean;
    }>(`
      SELECT
        timestamp,
        price_usd AS near_usd_price,
        source,
        source_timestamp,
        NOW() - source_timestamp > INTERVAL '2 minutes' AS stale
      FROM asset_usd_prices
      WHERE asset_id = 'near'
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const price = result.rows[0];

    if (!price) {
      return reply.status(404).send({
        error: "price_unavailable",
        message: "No NEAR/USD price has been collected yet",
      });
    }

    return price;
  } catch (error) {
    app.log.error(error, "Failed to fetch the latest NEAR/USD price");

    return reply.status(503).send({
      error: "database_unavailable",
      message: "Unable to fetch the latest NEAR/USD price",
    });
  }
});

app.get<{
  Querystring: { from?: string; to?: string; limit?: string };
}>("/api/prices/near-usd/history", async (request, reply) => {
  const parsedLimit = Number(request.query.limit ?? 1440);
  const from = request.query.from;
  const to = request.query.to;

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 10_080) {
    return reply.status(400).send({
      error: "invalid_limit",
      message: "limit must be an integer between 1 and 10080",
    });
  }

  if (from !== undefined && Number.isNaN(Date.parse(from))) {
    return reply.status(400).send({
      error: "invalid_from",
      message: "from must be a valid ISO-8601 timestamp",
    });
  }

  if (to !== undefined && Number.isNaN(Date.parse(to))) {
    return reply.status(400).send({
      error: "invalid_to",
      message: "to must be a valid ISO-8601 timestamp",
    });
  }

  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    return reply.status(400).send({
      error: "invalid_range",
      message: "from must be earlier than or equal to to",
    });
  }

  try {
    const result = await db.query<{
      timestamp: Date;
      near_usd_price: string;
      source: string;
      source_timestamp: Date;
    }>(
      `
        SELECT timestamp, price_usd AS near_usd_price, source, source_timestamp
        FROM (
          SELECT timestamp, price_usd, source, source_timestamp
          FROM asset_usd_prices
          WHERE asset_id = 'near'
            AND ($1::timestamptz IS NULL OR timestamp >= $1::timestamptz)
            AND ($2::timestamptz IS NULL OR timestamp <= $2::timestamptz)
          ORDER BY timestamp DESC
          LIMIT $3
        ) AS recent_prices
        ORDER BY timestamp ASC
      `,
      [from ?? null, to ?? null, parsedLimit],
    );

    return {
      count: result.rowCount ?? result.rows.length,
      from: from ?? null,
      to: to ?? null,
      prices: result.rows,
    };
  } catch (error) {
    app.log.error(error, "Failed to fetch NEAR/USD price history");

    return reply.status(503).send({
      error: "database_unavailable",
      message: "Unable to fetch NEAR/USD price history",
    });
  }
});

app.get("/api/prices/assets/latest", async (_request, reply) => {
  try {
    const result = await db.query<{
      asset_id: string;
      chain_id: string;
      token_address: string;
      timestamp: Date;
      price_usd: string;
      source: string;
      source_pair_id: string | null;
      liquidity_usd: string | null;
      source_timestamp: Date;
      stale: boolean;
    }>(`
      SELECT DISTINCT ON (prices.asset_id)
        prices.asset_id,
        assets.chain_id,
        assets.token_address,
        prices.timestamp,
        prices.price_usd,
        prices.source,
        prices.source_pair_id,
        prices.liquidity_usd,
        prices.source_timestamp,
        NOW() - prices.source_timestamp > INTERVAL '2 minutes' AS stale
      FROM asset_usd_prices AS prices
      INNER JOIN tracked_assets AS assets ON assets.asset_id = prices.asset_id
      WHERE assets.enabled = true
      ORDER BY prices.asset_id, prices.timestamp DESC
    `);

    return {
      count: result.rowCount ?? result.rows.length,
      prices: result.rows,
    };
  } catch (error) {
    app.log.error(error, "Failed to fetch latest asset/USD prices");
    return reply.status(503).send({
      error: "database_unavailable",
      message: "Unable to fetch latest asset/USD prices",
    });
  }
});

app.get<{
  Params: { assetId: string };
  Querystring: { from?: string; to?: string; limit?: string };
}>("/api/prices/assets/:assetId/history", async (request, reply) => {
  const assetId = request.params.assetId.toLowerCase();
  const parsedLimit = Number(request.query.limit ?? 1440);
  const from = request.query.from;
  const to = request.query.to;

  if (!/^[a-z0-9_-]{1,32}$/.test(assetId)) {
    return reply.status(400).send({ error: "invalid_asset_id" });
  }

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 10_080) {
    return reply.status(400).send({
      error: "invalid_limit",
      message: "limit must be an integer between 1 and 10080",
    });
  }

  if (from !== undefined && Number.isNaN(Date.parse(from))) {
    return reply.status(400).send({
      error: "invalid_from",
      message: "from must be a valid ISO-8601 timestamp",
    });
  }

  if (to !== undefined && Number.isNaN(Date.parse(to))) {
    return reply.status(400).send({
      error: "invalid_to",
      message: "to must be a valid ISO-8601 timestamp",
    });
  }

  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    return reply.status(400).send({
      error: "invalid_range",
      message: "from must be earlier than or equal to to",
    });
  }

  try {
    const asset = await db.query<{ chain_id: string; token_address: string }>(
      `SELECT chain_id, token_address FROM tracked_assets WHERE asset_id = $1`,
      [assetId],
    );

    if (!asset.rows[0]) {
      return reply.status(404).send({ error: "asset_not_found" });
    }

    const result = await db.query<{
      timestamp: Date;
      price_usd: string;
      source: string;
      source_pair_id: string | null;
      liquidity_usd: string | null;
      source_timestamp: Date;
    }>(
      `
        SELECT timestamp, price_usd, source, source_pair_id, liquidity_usd, source_timestamp
        FROM (
          SELECT timestamp, price_usd, source, source_pair_id, liquidity_usd, source_timestamp
          FROM asset_usd_prices
          WHERE asset_id = $1
            AND ($2::timestamptz IS NULL OR timestamp >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR timestamp <= $3::timestamptz)
          ORDER BY timestamp DESC
          LIMIT $4
        ) AS recent_prices
        ORDER BY timestamp ASC
      `,
      [assetId, from ?? null, to ?? null, parsedLimit],
    );

    return {
      asset_id: assetId,
      chain_id: asset.rows[0].chain_id,
      token_address: asset.rows[0].token_address,
      count: result.rowCount ?? result.rows.length,
      from: from ?? null,
      to: to ?? null,
      prices: result.rows,
    };
  } catch (error) {
    app.log.error(error, "Failed to fetch asset/USD price history");
    return reply.status(503).send({
      error: "database_unavailable",
      message: "Unable to fetch asset/USD price history",
    });
  }
});

app.get<{
  Params: { tokenId: string };
  Querystring: { limit?: string; offset?: string };
}>("/api/tokens/:tokenId/holders", async (request, reply) => {
  const parsedLimit = Number(request.query.limit ?? 100);
  const parsedOffset = Number(request.query.offset ?? 0);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return reply.status(400).send({
      error: "invalid_limit",
      message: "limit must be an integer between 1 and 200",
    });
  }

  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return reply.status(400).send({
      error: "invalid_offset",
      message: "offset must be a non-negative integer",
    });
  }

  try {
    const [holdersResult, countResult] = await Promise.all([
      db.query<{
        account_id: string;
        balance_raw: string;
        updated_block_height: string;
        updated_at: string;
        decimals: number | null;
      }>(
        `
          SELECT
            balances.account_id,
            balances.balance_raw,
            balances.updated_block_height,
            balances.updated_at,
            tokens.decimals
          FROM token_balances AS balances
          LEFT JOIN tokens ON tokens.contract_id = balances.token_id
          WHERE balances.token_id = $1
            AND balances.is_excluded = false
            AND balances.balance_raw::numeric > 0
          ORDER BY balances.balance_raw::numeric DESC, balances.account_id ASC
          LIMIT $2 OFFSET $3
        `,
        [request.params.tokenId, parsedLimit, parsedOffset],
      ),
      db.query<{ holders_count: string }>(
        `
          SELECT COUNT(*) AS holders_count
          FROM token_balances
          WHERE token_id = $1
            AND is_excluded = false
            AND balance_raw::numeric > 0
        `,
        [request.params.tokenId],
      ),
    ]);

    return {
      token_id: request.params.tokenId,
      holders_count: Number(countResult.rows[0]?.holders_count ?? 0),
      limit: parsedLimit,
      offset: parsedOffset,
      holders: holdersResult.rows.map(({ decimals, ...holder }) => ({
        ...holder,
        balance: decimals === null
          ? null
          : formatTokenAmount(holder.balance_raw, decimals),
      })),
    };
  } catch (error) {
    app.log.error(error, "Failed to fetch token holders");

    return reply.status(503).send({
      error: "database_unavailable",
      message: "Unable to fetch token holders",
    });
  }
});

const stopNearUsdCollector = process.env.DATABASE_URL
  ? startAssetUsdCollector(app.log)
  : () => undefined;
const stopHolderBalanceWorker = process.env.DATABASE_URL
  ? startHolderBalanceWorker(app.log)
  : () => undefined;
const stopCandleWorker = process.env.DATABASE_URL
  ? startCandleWorker(app.log)
  : () => undefined;

app.addHook("onClose", async () => {
  stopNearUsdCollector();
  stopHolderBalanceWorker();
  stopCandleWorker();
  await db.end();
});

const port = Number(process.env.PORT ?? 3000);
const host = "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.close().catch((error) => {
      app.log.error(error, "Failed to shut down cleanly");
      process.exit(1);
    });
  });
}
