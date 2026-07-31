import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CrawlerDatabase, EnvironmentMismatchError } from "../../src/db/client.js";
import { loadDatabaseConfig, loadTestDatabaseConfig } from "../../src/db/env.js";

/**
 * Regression coverage for the admin/app database-role split and the
 * ensureEnvironmentMarker (admin, DDL-capable) vs verifyEnvironmentMarker
 * (app, read-only) distinction.
 *
 * This was flagged as a "known issue" in an earlier brief (registryLoader.ts
 * allegedly calling a method CrawlerDatabase doesn't expose) -- direct
 * inspection found both methods already exist and are already called from
 * the correct places (registryLoader.ts:135 and cli.ts's source-health path
 * use verifyEnvironmentMarker; migrate.ts:39 uses ensureEnvironmentMarker).
 * This file exists to make that guarantee a durable, mechanically-checked
 * regression test rather than leaving it as a one-time manual finding.
 *
 * Skipped (not failed) when the required env vars are not configured, same
 * pattern as tests/integration/migrate.test.ts.
 */

function tryLoadTestConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const testConfig = tryLoadTestConfig();

test("verifyEnvironmentMarker throws before any migrate/ensureEnvironmentMarker has run on a fresh schema", { skip: !testConfig }, async () => {
  // Use a schema-qualified config so this doesn't collide with other tests'
  // state in the same disposable database: reuse testConfig but point at a
  // throwaway schema name that has definitely never been marked.
  const throwawaySchema = `dbrolesep_fresh_${Date.now()}`;
  const db = new CrawlerDatabase({ ...testConfig!, schema: throwawaySchema });
  try {
    await assert.rejects(() => db.verifyEnvironmentMarker(), EnvironmentMismatchError);
  } finally {
    await db.close();
  }
});

test("ensureEnvironmentMarker creates the schema/table and sets the marker on a brand-new database", { skip: !testConfig }, async () => {
  const throwawaySchema = `dbrolesep_ensure_${Date.now()}`;
  const db = new CrawlerDatabase({ ...testConfig!, schema: throwawaySchema });
  try {
    await db.ensureEnvironmentMarker();
    const marker = await db.getDeploymentMetadata("environment");
    assert.equal(marker, "test");
  } finally {
    await db.close();
  }
});

test("verifyEnvironmentMarker succeeds read-only after ensureEnvironmentMarker has run once", { skip: !testConfig }, async () => {
  const throwawaySchema = `dbrolesep_verify_${Date.now()}`;
  const setup = new CrawlerDatabase({ ...testConfig!, schema: throwawaySchema });
  try {
    await setup.ensureEnvironmentMarker();
  } finally {
    await setup.close();
  }

  const reader = new CrawlerDatabase({ ...testConfig!, schema: throwawaySchema });
  try {
    await assert.doesNotReject(() => reader.verifyEnvironmentMarker());
  } finally {
    await reader.close();
  }
});

test("loadDatabaseConfig role selection: 'admin' selects the *_ADMIN_* credentials, default/'app' selects the runtime credentials", () => {
  const original = { ...process.env };
  try {
    process.env.APP_ENV = "staging";
    process.env.DB_STG_HOST = "host";
    process.env.DB_STG_PORT = "5432";
    process.env.DB_STG_NAME = "dbname";
    process.env.DB_STG_ADMIN_USER = "admin-user";
    process.env.DB_STG_ADMIN_PASSWORD = "admin-pass";
    process.env.DB_STG_USER = "app-user";
    process.env.DB_STG_PASSWORD = "app-pass";

    const admin = loadDatabaseConfig("staging", "admin");
    assert.equal(admin.user, "admin-user");
    assert.equal(admin.password, "admin-pass");

    const appDefault = loadDatabaseConfig("staging");
    assert.equal(appDefault.user, "app-user");
    assert.equal(appDefault.password, "app-pass");

    const appExplicit = loadDatabaseConfig("staging", "app");
    assert.equal(appExplicit.user, "app-user");
    assert.equal(appExplicit.password, "app-pass");
  } finally {
    process.env = original;
  }
});

// import.meta.url is dist/tests/integration at runtime (npm test always
// rebuilds via tsc first); walk up to the package root, then into the real
// TypeScript src/ tree -- these two source-content checks intentionally
// read the authored .ts files, not the compiled .js output, so the
// assertion reflects the actual source of truth reviewers edit.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("registryLoader.ts source calls verifyEnvironmentMarker, never ensureEnvironmentMarker (static source check)", () => {
  // A behavioral spy would require making CrawlerDatabase mockable via DI,
  // which is out of scope for this regression test; a direct source check
  // is a legitimate, precise way to pin this specific contract (the
  // registry loader is documented as the least-privilege, app-role-only
  // writer -- it must never call the DDL-capable method).
  const registryLoaderPath = join(PACKAGE_ROOT, "src", "db", "registryLoader.ts");
  const source = readFileSync(registryLoaderPath, "utf8");
  assert.match(source, /\bdb\.verifyEnvironmentMarker\(\)/);
  assert.doesNotMatch(source, /\bdb\.ensureEnvironmentMarker\(\)/);
});

test("migrate.ts source calls ensureEnvironmentMarker (admin/DDL path), never verifyEnvironmentMarker", () => {
  const migratePath = join(PACKAGE_ROOT, "src", "db", "migrate.ts");
  const source = readFileSync(migratePath, "utf8");
  assert.match(source, /\bdb\.ensureEnvironmentMarker\(\)/);
  assert.doesNotMatch(source, /\bdb\.verifyEnvironmentMarker\(\)/);
});

// --- Live proof that the staging app role literally cannot perform DDL ---
//
// This is the one true enforcement test: it connects with the actual
// least-privilege DB_STG_USER/DB_STG_PASSWORD credentials against the real
// staging database and asserts a CREATE TABLE attempt is rejected by
// Postgres itself. Gated separately from testConfig (which targets a
// disposable *_test database) because this specific guarantee can only be
// proven against the real staging grants documented in
// docs/operations/TARIFF_CRAWLER_DEPLOYMENT_PRJXN2.md -- a CI-disposable
// database's default role is typically its own owner and would not
// reproduce this protection.
function tryLoadStagingAppConfig() {
  try {
    if (process.env.APP_ENV !== "staging") return null;
    return loadDatabaseConfig("staging", "app");
  } catch {
    return null;
  }
}

const stagingAppConfig = tryLoadStagingAppConfig();

test("the staging app role cannot execute DDL (CREATE TABLE is rejected by Postgres)", { skip: !stagingAppConfig }, async () => {
  const db = new CrawlerDatabase(stagingAppConfig!);
  try {
    await db.verifyEnvironmentMarker(); // proves we're really pointed at the marked staging DB first
    await assert.rejects(
      () =>
        db.withClient(async (client) => {
          await client.query(`CREATE TABLE dbrolesep_ddl_should_fail_${Date.now()} (id int)`);
        }),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});
