import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./db.js";

const migrationsDirectory = resolve(process.cwd(), "migrations");

async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const alreadyApplied = await db.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [file],
    );

    if (alreadyApplied.rowCount) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

try {
  await migrate();
} finally {
  await db.end();
}
