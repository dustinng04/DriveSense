import fs from "fs/promises";
import { config } from "../config.js";
import { pool } from "./pool.js";
import path from "path";

const MIGRATIONS_DIR = config.migrationsPath;

async function migrate() {
  console.log("Starting database migrations...");
  console.log(`Migrations directory: ${MIGRATIONS_DIR}`);

  const client = await pool.connect();
  try {
    // 1. Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read all .sql files
    const files = await fs.readdir(MIGRATIONS_DIR);
    const sqlFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (sqlFiles.length === 0) {
      console.log("No migration files found.");
      return;
    }

    // 3. Apply missing migrations
    for (const file of sqlFiles) {
      const { rowCount } = await client.query(
        "SELECT 1 FROM public._migrations WHERE name = $1",
        [file]
      );

      if (rowCount === 0) {
        console.log(`Applying migration: ${file}...`);
        const content = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf-8");

        try {
          await client.query("BEGIN");
          await client.query(content);
          await client.query(
            "INSERT INTO public._migrations (name) VALUES ($1)",
            [file]
          );
          await client.query("COMMIT");
          console.log(`Successfully applied: ${file}`);
        } catch (error) {
          await client.query("ROLLBACK");
          console.error(`Failed to apply migration: ${file}`);
          console.error(error);
          process.exit(1);
        }
      } else {
        console.log(`⏭️  Skipping already applied migration: ${file}`);
      }
    }

    console.log("🏁 All migrations completed successfully!");
  } catch (error) {
    console.error("Migration runner failed:");
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
