import pg from "pg";
import type { DatabaseConfig } from "./env.js";

const { Pool } = pg;

/**
 * A database is marked with its own environment identity on first migration
 * (see ensureEnvironmentMarker). Every subsequent connection from this
 * process re-checks that marker against the config's appEnv before allowing
 * any query, so a staging process can never silently operate against a
 * database that was actually provisioned as production (e.g. because a local
 * port forward was quietly repointed), and vice versa.
 */
export class EnvironmentMismatchError extends Error {}

export class CrawlerDatabase {
  private readonly pool: pg.Pool;
  private readonly schema: string;
  private readonly expectedAppEnv: string;
  private markerVerified = false;

  constructor(private readonly config: DatabaseConfig) {
    this.schema = config.schema;
    this.expectedAppEnv = config.appEnv;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      min: config.poolMin,
      max: config.poolMax,
      connectionTimeoutMillis: config.connectTimeoutSeconds * 1000,
      statement_timeout: config.statementTimeoutSeconds * 1000,
      ssl: config.sslmode === "require" ? { rejectUnauthorized: true } : false,
    });
  }

  /** Runs fn with a connected client, always releasing it back to the pool. */
  async withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET search_path TO ${quoteIdent(this.schema)}, public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** Runs fn inside a transaction, rolling back on any error. */
  async withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  /**
   * Verifies (and on a brand-new database, sets) the environment marker
   * stored in the migration-metadata table. Must be called before any
   * migration or data operation. Throws EnvironmentMismatchError rather than
   * silently proceeding if the database's recorded environment does not
   * match this process's APP_ENV.
   *
   * Creates the schema/table if missing (CREATE SCHEMA/TABLE IF NOT EXISTS),
   * so this requires the admin/migration role's privileges. The
   * least-privilege app role (used for registry loads and crawl operations)
   * should call verifyEnvironmentMarker() instead, which only reads — the
   * schema and table are expected to already exist from a prior migration.
   */
  async ensureEnvironmentMarker(): Promise<void> {
    if (this.markerVerified) return;
    await this.withClient(async (client) => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(this.schema)}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${quoteIdent(this.schema)}.deployment_metadata (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          set_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const { rows } = await client.query(
        `SELECT value FROM ${quoteIdent(this.schema)}.deployment_metadata WHERE key = 'environment'`,
      );
      if (rows.length === 0) {
        await client.query(
          `INSERT INTO ${quoteIdent(this.schema)}.deployment_metadata (key, value) VALUES ('environment', $1)`,
          [this.expectedAppEnv],
        );
        this.markerVerified = true;
        return;
      }
      const recorded = rows[0].value as string;
      if (recorded !== this.expectedAppEnv) {
        throw new EnvironmentMismatchError(
          `Database at ${this.config.host}:${this.config.port}/${this.config.database} is marked ` +
            `environment="${recorded}" but this process is running with APP_ENV="${this.expectedAppEnv}". ` +
            `Refusing to proceed to avoid cross-environment writes.`,
        );
      }
      this.markerVerified = true;
    });
  }

  /**
   * Read-only counterpart to ensureEnvironmentMarker for the least-privilege
   * app role: never issues DDL, only SELECTs the existing
   * deployment_metadata row. Throws if the schema/table don't exist yet
   * (meaning migrations haven't been run) or if the environment marker
   * doesn't match this process's APP_ENV.
   */
  async verifyEnvironmentMarker(): Promise<void> {
    if (this.markerVerified) return;
    await this.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT value FROM ${quoteIdent(this.schema)}.deployment_metadata WHERE key = 'environment'`,
      );
      if (rows.length === 0) {
        throw new EnvironmentMismatchError(
          `No environment marker found in ${quoteIdent(this.schema)}.deployment_metadata -- ` +
            `has "migrate" been run against this database yet?`,
        );
      }
      const recorded = rows[0].value as string;
      if (recorded !== this.expectedAppEnv) {
        throw new EnvironmentMismatchError(
          `Database at ${this.config.host}:${this.config.port}/${this.config.database} is marked ` +
            `environment="${recorded}" but this process is running with APP_ENV="${this.expectedAppEnv}". ` +
            `Refusing to proceed to avoid cross-environment writes.`,
        );
      }
      this.markerVerified = true;
    });
  }

  async recordDeploymentMetadata(key: string, value: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `INSERT INTO ${quoteIdent(this.schema)}.deployment_metadata (key, value, set_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, set_at = now()`,
        [key, value],
      );
    });
  }

  async getDeploymentMetadata(key: string): Promise<string | null> {
    return this.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT value FROM ${quoteIdent(this.schema)}.deployment_metadata WHERE key = $1`,
        [key],
      );
      return rows.length > 0 ? (rows[0].value as string) : null;
    });
  }

  /**
   * Acquires a named advisory lock scoped to this schema/lock name so only
   * one scheduler instance can run a given job at a time. Returns false
   * immediately (never blocks) if the lock is already held.
   */
  async tryAcquireSchedulerLock(lockName: string, holder: string, ttlSeconds: number): Promise<boolean> {
    return this.withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT holder, expires_at FROM ${quoteIdent(this.schema)}.scheduler_locks WHERE lock_name = $1 FOR UPDATE`,
        [lockName],
      );
      const now = new Date();
      if (rows.length > 0 && new Date(rows[0].expires_at) > now) {
        return false; // still held by someone else
      }
      await client.query(
        `INSERT INTO ${quoteIdent(this.schema)}.scheduler_locks (lock_name, holder, acquired_at, expires_at)
         VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
         ON CONFLICT (lock_name) DO UPDATE
           SET holder = EXCLUDED.holder, acquired_at = now(), expires_at = EXCLUDED.expires_at`,
        [lockName, holder, ttlSeconds],
      );
      return true;
    });
  }

  async releaseSchedulerLock(lockName: string, holder: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `DELETE FROM ${quoteIdent(this.schema)}.scheduler_locks WHERE lock_name = $1 AND holder = $2`,
        [lockName, holder],
      );
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function quoteIdent(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(ident)) {
    throw new Error(`Refusing to use unsafe identifier: "${ident}"`);
  }
  return `"${ident}"`;
}
