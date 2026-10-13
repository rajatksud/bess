import { test } from "node:test";
import assert from "node:assert/strict";
import { CrawlerDatabase, EnvironmentMismatchError } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate, currentMigrationVersion } from "../../src/db/migrate.js";

/**
 * Integration tests requiring a real, disposable Postgres database. Skipped
 * (not failed) when APP_ENV is not "test" or the required DB_TEST_ or
 * DB_STG_ (with a "_test" suffixed name) variables are not set, so normal
 * `npm test` runs and CI without a database service still pass. Run
 * explicitly via `npm run test:integration` with a real test database
 * configured.
 */
function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

test("migrate applies 0001_init to a fresh database and is idempotent on rerun", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    const first = await migrate(db);
    assert.ok(first.applied.includes("0001_init") || first.alreadyCurrent.includes("0001_init"));

    const version = await currentMigrationVersion(db);
    assert.equal(version, "0001_init");

    const second = await migrate(db);
    assert.deepEqual(second.applied, []);
    assert.ok(second.alreadyCurrent.includes("0001_init"));
  } finally {
    await db.close();
  }
});

test("migrate refuses to run against a database marked production without allowProduction", { skip: !config }, async () => {
  const db = new CrawlerDatabase({ ...config!, appEnv: "test" });
  try {
    await db.ensureEnvironmentMarker();
    await db.recordDeploymentMetadata("environment", "production");

    await assert.rejects(() => migrate(db), /explicit --production flag/);
  } finally {
    // Restore the marker so the disposable test database stays reusable
    // across test runs (this is a "test" database gated by loadTestDatabaseConfig,
    // never staging/production).
    await db.recordDeploymentMetadata("environment", "test");
    await db.close();
  }
});

test("ensureEnvironmentMarker rejects a mismatched APP_ENV against a previously-marked database", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker(); // marks/confirms "test"
  } finally {
    await db.close();
  }

  const mismatched = new CrawlerDatabase({ ...config!, appEnv: "staging" });
  try {
    await assert.rejects(() => mismatched.ensureEnvironmentMarker(), EnvironmentMismatchError);
  } finally {
    await mismatched.close();
  }
});

test("scheduler lock is exclusive: a second acquire attempt fails while the first is held", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    const acquired = await db.tryAcquireSchedulerLock("integration-test-lock", "holder-a", 30);
    assert.equal(acquired, true);

    const secondAttempt = await db.tryAcquireSchedulerLock("integration-test-lock", "holder-b", 30);
    assert.equal(secondAttempt, false);

    await db.releaseSchedulerLock("integration-test-lock", "holder-a");

    const afterRelease = await db.tryAcquireSchedulerLock("integration-test-lock", "holder-b", 30);
    assert.equal(afterRelease, true);
    await db.releaseSchedulerLock("integration-test-lock", "holder-b");
  } finally {
    await db.close();
  }
});
