# JustHoot Indexing

Backend and indexing services for JustHoot.

## API

The Fastify API is in `justhoot-indexer-api`.

```bash
cd justhoot-indexer-api
npm install
npm run dev
```

The local health check is available at `http://localhost:3000/health`.

Recent indexed swaps are available at:

```text
GET /api/pools/:poolId/swaps?limit=50
```

`limit` defaults to 50 and accepts values from 1 through 200. Goldsky accepts a
successful Ref DCL swap when either token in its pool ID ends with
`.launchpad.hoot.near`. The API returns `amount_in_raw` and `amount_out_raw`
exactly as emitted on-chain; clients must use each token's NEP-141 decimals to
calculate human-readable amounts and price. The response also identifies the
launchpad token, counter token, and pool fee tier.

OHLCV candles are generated for quote-token prices and, when conversion data is
available, USD prices:

```text
GET /api/pools/:poolId/candles?interval=1m&limit=500
```

Supported intervals are `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`. Quote OHLC
fields are always populated after token metadata is available. USD OHLC fields
are populated for wNEAR and verified USDT/USDC quote tokens.

The backend queries Dexscreener once per minute for wNEAR, WETH, WBTC, and
wrapped SOL. Requests are batched by chain, and the collector stores the most
liquid valid USD-priced pair returned for each asset. The existing NEAR latest
endpoint remains available at:

```text
GET /api/prices/near-usd/latest
```

Historical observations are available in chronological order at:

```text
GET /api/prices/near-usd/history?from=<ISO-8601>&to=<ISO-8601>&limit=1440
```

`from` and `to` are optional. `limit` defaults to 1,440 observations and has a
maximum of 10,080 (seven days of one-minute prices).

Latest prices for every tracked asset and per-asset history are available at:

```text
GET /api/prices/assets/latest
GET /api/prices/assets/:assetId/history?from=<ISO-8601>&to=<ISO-8601>&limit=1440
```

The initial asset IDs are `near`, `eth`, `btc`, and `sol`. Historical prices
are observations collected by this service; Dexscreener supplies current pair
data rather than historical candles.

The active database schema contains eight application tables:

```text
schema_migrations, tokens, swaps, candles, token_balance_events,
token_balances, tracked_assets, asset_usd_prices
```

The legacy `pools` and `near_usd_prices` tables were removed after dynamic pool
filtering and generalized asset pricing replaced them.

Token holder balances will be available after the JustHoot NEP-141 event
pipeline is connected:

```text
GET /api/tokens/:tokenId/holders?limit=100&offset=0
```

The holder index is kept separate from swaps because balances must be derived
from every mint, transfer, and burn event—not only trades.

The development Goldsky pipeline also watches `*.launchpad.hoot.near` for
successful NEP-141 `ft_mint`, `ft_transfer`, and
`ft_burn` events. It writes immutable deltas to `token_balance_events`; a
transactional backend worker applies each event once to `token_balances`.

## Railway

When creating the Railway service, set its root directory to
`justhoot-indexer-api`. Railway can then use the package scripts to build and
start the API:

```text
Build: npm run build
Start: npm start
```
