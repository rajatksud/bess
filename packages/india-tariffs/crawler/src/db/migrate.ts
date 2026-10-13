import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CrawlerDatabase } from "./client.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((filename) => {
    const version = filename.replace(/\.sql$/, "");
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    return { version, filename, sql };
  });
}

/**
 * Applies all pending, additive SQL migrations in order, tracked in a
 * schema_migrations table. Migrations are never edited after being applied —
 * a schema change is always a new numbered file. This function is safe to
 * call repeatedly (idempotent): already-applied versions are skipped.
 *
 * Production migrations require explicit opt-in (allowProduction=true) so
 * that running this against a production-marked database by accident (e.g.
 * a script default) is not possible.
 */
export async function migrate(
  db: CrawlerDatabase,
  options: { allowProduction?: boolean } = {},
): Promise<{ applied: string[]; alreadyCurrent: string[] }> {
  await db.ensureEnvironmentMarker();

  const currentEnv = await db.getDeploymentMetadata("environment");
  if (currentEnv === "production" && !options.allowProduction) {
    throw new Error(
      "Refusing to run migrations against a database marked environment=production " +
        "without the explicit --production flag.",
    );
  }

  const migrations = loadMigrations();
  const applied: string[] = [];
  const alreadyCurrent: string[] = [];

  await db.withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  });

  for (const migration of migrations) {
    const isApplied = await db.withClient(async (client) => {
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migration.version],
      );
      return rows.length > 0;
    });

    if (isApplied) {
      alreadyCurrent.push(migration.version);
      continue;
    }

    await db.withTransaction(async (client) => {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    });
    applied.push(migration.version);
  }

  return { applied, alreadyCurrent };
}

export async function currentMigrationVersion(db: CrawlerDatabase): Promise<string | null> {
  return db.withClient(async (client) => {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
    );
    if (exists.rows.length === 0) return null;
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    );
    return rows.length > 0 ? (rows[0].version as string) : null;
  });
}
