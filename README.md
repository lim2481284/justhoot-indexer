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

## Railway

When creating the Railway service, set its root directory to
`justhoot-indexer-api`. Railway can then use the package scripts to build and
start the API:

```text
Build: npm run build
Start: npm start
```
