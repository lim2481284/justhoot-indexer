import type { FastifyBaseLogger } from "fastify";
import { db } from "./db.js";

const COLLECTION_INTERVAL_MS = 60_000;
const MAX_TOKENS_PER_REQUEST = 30;

type TrackedAsset = {
  asset_id: string;
  chain_id: string;
  token_address: string;
};

type DexscreenerPair = {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
};

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d+(\.\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0;
}

function sameAddress(chainId: string, left: string, right: string): boolean {
  return chainId === "ethereum"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchPairs(chainId: string, assets: TrackedAsset[]): Promise<DexscreenerPair[]> {
  const addresses = assets
    .map((asset) => encodeURIComponent(asset.token_address))
    .join(",");
  const url = `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chainId)}/${addresses}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Dexscreener ${chainId} price request failed with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error(`Dexscreener returned an invalid ${chainId} pair list`);
  }

  return payload as DexscreenerPair[];
}

async function collectAssetUsdPrices(log: FastifyBaseLogger): Promise<void> {
  const tracked = await db.query<TrackedAsset>(`
    SELECT asset_id, chain_id, token_address
    FROM tracked_assets
    WHERE enabled = true
    ORDER BY chain_id, asset_id
  `);

  const assetsByChain = new Map<string, TrackedAsset[]>();
  for (const asset of tracked.rows) {
    const assets = assetsByChain.get(asset.chain_id) ?? [];
    assets.push(asset);
    assetsByChain.set(asset.chain_id, assets);
  }

  for (const [chainId, chainAssets] of assetsByChain) {
    for (const assetBatch of chunks(chainAssets, MAX_TOKENS_PER_REQUEST)) {
      try {
        const pairs = await fetchPairs(chainId, assetBatch);

        for (const asset of assetBatch) {
          const pair = pairs
            .filter((candidate) =>
              candidate.chainId === chainId &&
              typeof candidate.dexId === "string" &&
              typeof candidate.pairAddress === "string" &&
              typeof candidate.baseToken?.address === "string" &&
              sameAddress(chainId, candidate.baseToken.address, asset.token_address) &&
              isPositiveDecimal(candidate.priceUsd) &&
              typeof candidate.liquidity?.usd === "number" &&
              Number.isFinite(candidate.liquidity.usd) &&
              candidate.liquidity.usd > 0
            )
            .sort((left, right) =>
              (right.liquidity?.usd as number) - (left.liquidity?.usd as number)
            )[0];

          if (!pair || !isPositiveDecimal(pair.priceUsd)) {
            log.warn(
              { asset_id: asset.asset_id, chain_id: chainId },
              "Dexscreener returned no liquid pair with a USD price",
            );
            continue;
          }

          const source = `dexscreener:${pair.dexId}:${pair.pairAddress}`;
          await db.query(
            `
              INSERT INTO asset_usd_prices (
                asset_id,
                timestamp,
                price_usd,
                source,
                source_pair_id,
                liquidity_usd,
                source_timestamp
              )
              VALUES ($1, date_trunc('minute', NOW()), $2, $3, $4, $5, NOW())
              ON CONFLICT (asset_id, timestamp) DO UPDATE SET
                price_usd = EXCLUDED.price_usd,
                source = EXCLUDED.source,
                source_pair_id = EXCLUDED.source_pair_id,
                liquidity_usd = EXCLUDED.liquidity_usd,
                source_timestamp = EXCLUDED.source_timestamp
            `,
            [asset.asset_id, pair.priceUsd, source, pair.pairAddress, pair.liquidity?.usd],
          );

          log.info(
            {
              asset_id: asset.asset_id,
              price_usd: pair.priceUsd,
              source,
              liquidity_usd: pair.liquidity?.usd,
            },
            "Stored asset/USD price",
          );
        }
      } catch (error) {
        log.error(
          { err: error, chain_id: chainId },
          "Failed to collect Dexscreener asset prices for chain",
        );
      }
    }
  }
}

export function startAssetUsdCollector(log: FastifyBaseLogger): () => void {
  let collectionInProgress = false;

  const run = async (): Promise<void> => {
    if (collectionInProgress) return;
    collectionInProgress = true;

    try {
      await collectAssetUsdPrices(log);
    } catch (error) {
      log.error(error, "Failed to collect asset/USD prices");
    } finally {
      collectionInProgress = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), COLLECTION_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
