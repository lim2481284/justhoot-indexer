import Fastify from "fastify";
import { db } from "./db.js";

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
          AND to_regclass('public.pools') IS NOT NULL
          AND to_regclass('public.swaps') IS NOT NULL
          AND to_regclass('public.candles') IS NOT NULL
          AND to_regclass('public.near_usd_prices') IS NOT NULL
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

app.addHook("onClose", async () => {
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
