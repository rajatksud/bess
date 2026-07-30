/**
 * Environment resolution and safety guards for database access.
 *
 * The crawler must never guess its environment from a hostname or port —
 * APP_ENV is the explicit, required marker, and every connection is checked
 * against the database's own recorded environment marker (see ensureEnvironmentMarker
 * in client.ts) before any write is permitted. This defends against the case
 * described in the crawler brief where a local port forward could silently
 * resolve to a production database.
 */

export type AppEnv = "test" | "staging" | "production";

const VALID_ENVS: AppEnv[] = ["test", "staging", "production"];

export interface DatabaseConfig {
  appEnv: AppEnv;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  sslmode: string;
  poolMin: number;
  poolMax: number;
  connectTimeoutSeconds: number;
  statementTimeoutSeconds: number;
}

export class EnvironmentConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new EnvironmentConfigError(`Missing required environment variable "${name}"`);
  }
  return value;
}

function parseAppEnv(raw: string | undefined): AppEnv {
  if (!raw || !VALID_ENVS.includes(raw as AppEnv)) {
    throw new EnvironmentConfigError(
      `APP_ENV must be one of ${VALID_ENVS.join(", ")}, got "${raw ?? "<unset>"}"`,
    );
  }
  return raw as AppEnv;
}

/**
 * Loads database configuration for the given target environment ("staging" or
 * "production"). This intentionally reads distinct DB_STG_ and DB_PROD_ variable
 * families rather than a single DATABASE_URL, so that a staging process can
 * never accidentally inherit production credentials from the same .env file —
 * both families may be present simultaneously without collision. APP_ENV must
 * match the requested target; a process started with APP_ENV=staging cannot
 * load production config, and vice versa.
 */
export function loadDatabaseConfig(target: "staging" | "production"): DatabaseConfig {
  const appEnv = parseAppEnv(process.env.APP_ENV);
  if (appEnv !== target) {
    throw new EnvironmentConfigError(
      `Refusing to load ${target} database config: APP_ENV is "${appEnv}", expected "${target}". ` +
        `This guard exists to stop a process from connecting to the wrong environment.`,
    );
  }

  const prefix = target === "staging" ? "DB_STG" : "DB_PROD";
  return {
    appEnv,
    host: requireEnv(`${prefix}_HOST`),
    port: Number(requireEnv(`${prefix}_PORT`)),
    database: requireEnv(`${prefix}_NAME`),
    user: requireEnv(`${prefix}_USER`),
    password: requireEnv(`${prefix}_PASSWORD`),
    schema: process.env.CRAWLER_DATABASE_SCHEMA ?? "tariff_crawler",
    sslmode: process.env.DATABASE_SSLMODE ?? (target === "production" ? "require" : "disable"),
    poolMin: Number(process.env.DATABASE_POOL_MIN ?? "1"),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? "10"),
    connectTimeoutSeconds: Number(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS ?? "10"),
    statementTimeoutSeconds: Number(process.env.DATABASE_STATEMENT_TIMEOUT_SECONDS ?? "60"),
  };
}

/**
 * Loads database configuration for disposable integration tests. Distinct
 * from loadDatabaseConfig("staging") so that test cleanup (which may run
 * destructive resets) can never be pointed at a real staging or production
 * database by a misconfigured APP_ENV. Requires APP_ENV=test and a DB_TEST_*
 * variable family (falls back to DB_STG_* with a mandatory "_test" database
 * name suffix check) so destructive operations only ever run against a
 * database name that is unambiguously a disposable test target.
 */
export function loadTestDatabaseConfig(): DatabaseConfig {
  const appEnv = parseAppEnv(process.env.APP_ENV);
  if (appEnv !== "test") {
    throw new EnvironmentConfigError(
      `Refusing to load test database config: APP_ENV is "${appEnv}", expected "test".`,
    );
  }

  const hasTestFamily = Boolean(process.env.DB_TEST_HOST);
  const prefix = hasTestFamily ? "DB_TEST" : "DB_STG";
  const database = requireEnv(`${prefix}_NAME`);

  if (!hasTestFamily && !database.endsWith("_test")) {
    throw new EnvironmentConfigError(
      `Refusing destructive test setup: no DB_TEST_* variables are set, and DB_STG_NAME ` +
        `("${database}") does not end with "_test". Destructive test operations must target ` +
        `an explicitly disposable database name.`,
    );
  }

  return {
    appEnv,
    host: requireEnv(`${prefix}_HOST`),
    port: Number(requireEnv(`${prefix}_PORT`)),
    database,
    user: requireEnv(`${prefix}_USER`),
    password: requireEnv(`${prefix}_PASSWORD`),
    schema: process.env.CRAWLER_DATABASE_SCHEMA ?? "tariff_crawler",
    sslmode: process.env.DATABASE_SSLMODE ?? "disable",
    poolMin: Number(process.env.DATABASE_POOL_MIN ?? "1"),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? "5"),
    connectTimeoutSeconds: Number(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS ?? "10"),
    statementTimeoutSeconds: Number(process.env.DATABASE_STATEMENT_TIMEOUT_SECONDS ?? "60"),
  };
}
