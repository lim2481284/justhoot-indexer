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

`limit` defaults to 50 and accepts values from 1 through 200. Token amounts and
prices are returned as strings so clients do not lose decimal precision.

The backend collects the public Binance `NEARUSDT` price once per minute and
stores it as an approximate NEAR/USD reference price. The latest observation is
available at:

```text
GET /api/prices/near-usd/latest
```

## Railway

When creating the Railway service, set its root directory to
`justhoot-indexer-api`. Railway can then use the package scripts to build and
start the API:

```text
Build: npm run build
Start: npm start
```
