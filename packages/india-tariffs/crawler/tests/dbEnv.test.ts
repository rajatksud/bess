import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDatabaseConfig, loadTestDatabaseConfig, EnvironmentConfigError } from "../src/db/env.js";

const ENV_KEYS = [
  "APP_ENV",
  "DB_STG_HOST",
  "DB_STG_PORT",
  "DB_STG_NAME",
  "DB_STG_USER",
  "DB_STG_PASSWORD",
  "DB_PROD_HOST",
  "DB_PROD_PORT",
  "DB_PROD_NAME",
  "DB_PROD_USER",
  "DB_PROD_PASSWORD",
  "DB_TEST_HOST",
  "DB_TEST_PORT",
  "DB_TEST_NAME",
  "DB_TEST_USER",
  "DB_TEST_PASSWORD",
  "CRAWLER_DATABASE_SCHEMA",
  "DATABASE_SSLMODE",
];

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("loadDatabaseConfig succeeds when APP_ENV matches the requested target", () => {
  withEnv(
    {
      APP_ENV: "staging",
      DB_STG_HOST: "localhost",
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
    },
    () => {
      const config = loadDatabaseConfig("staging");
      assert.equal(config.host, "localhost");
      assert.equal(config.port, 5433);
      assert.equal(config.database, "tariff_crawler_staging");
      assert.equal(config.appEnv, "staging");
    },
  );
});

test("loadDatabaseConfig refuses to load production config when APP_ENV=staging", () => {
  withEnv(
    {
      APP_ENV: "staging",
      DB_PROD_HOST: "localhost",
      DB_PROD_PORT: "15433",
      DB_PROD_NAME: "tariff_crawler",
      DB_PROD_USER: "u",
      DB_PROD_PASSWORD: "p",
    },
    () => {
      assert.throws(() => loadDatabaseConfig("production"), EnvironmentConfigError);
    },
  );
});

test("loadDatabaseConfig refuses to load staging config when APP_ENV=production", () => {
  withEnv(
    {
      APP_ENV: "production",
      DB_STG_HOST: "localhost",
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
    },
    () => {
      assert.throws(() => loadDatabaseConfig("staging"), EnvironmentConfigError);
    },
  );
});

test("loadDatabaseConfig rejects an invalid APP_ENV value", () => {
  withEnv({ APP_ENV: "development" }, () => {
    assert.throws(() => loadDatabaseConfig("staging"), EnvironmentConfigError);
  });
});

test("loadDatabaseConfig throws when a required variable is missing", () => {
  withEnv(
    {
      APP_ENV: "staging",
      DB_STG_HOST: undefined,
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
    },
    () => {
      assert.throws(() => loadDatabaseConfig("staging"), /DB_STG_HOST/);
    },
  );
});

test("loadTestDatabaseConfig requires APP_ENV=test", () => {
  withEnv({ APP_ENV: "staging" }, () => {
    assert.throws(() => loadTestDatabaseConfig(), EnvironmentConfigError);
  });
});

test("loadTestDatabaseConfig accepts a dedicated DB_TEST_* family", () => {
  withEnv(
    {
      APP_ENV: "test",
      DB_TEST_HOST: "localhost",
      DB_TEST_PORT: "5433",
      DB_TEST_NAME: "tariff_crawler_test",
      DB_TEST_USER: "u",
      DB_TEST_PASSWORD: "p",
    },
    () => {
      const config = loadTestDatabaseConfig();
      assert.equal(config.database, "tariff_crawler_test");
    },
  );
});

test("loadTestDatabaseConfig refuses a DB_STG_NAME that does not end in _test when no DB_TEST_* family is set", () => {
  withEnv(
    {
      APP_ENV: "test",
      DB_STG_HOST: "localhost",
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
    },
    () => {
      assert.throws(() => loadTestDatabaseConfig(), /disposable database name/);
    },
  );
});

test("loadTestDatabaseConfig accepts a DB_STG_NAME ending in _test as a fallback", () => {
  withEnv(
    {
      APP_ENV: "test",
      DB_STG_HOST: "localhost",
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging_test",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
    },
    () => {
      const config = loadTestDatabaseConfig();
      assert.equal(config.database, "tariff_crawler_staging_test");
    },
  );
});

test("loadDatabaseConfig applies documented defaults for pool/timeout settings", () => {
  withEnv(
    {
      APP_ENV: "staging",
      DB_STG_HOST: "localhost",
      DB_STG_PORT: "5433",
      DB_STG_NAME: "tariff_crawler_staging",
      DB_STG_USER: "u",
      DB_STG_PASSWORD: "p",
      DATABASE_SSLMODE: undefined,
    },
    () => {
      const config = loadDatabaseConfig("staging");
      assert.equal(config.schema, "tariff_crawler");
      assert.equal(config.sslmode, "disable");
      assert.equal(config.poolMin, 1);
      assert.equal(config.poolMax, 10);
    },
  );
});

test("loadDatabaseConfig defaults production sslmode to require when unset", () => {
  withEnv(
    {
      APP_ENV: "production",
      DB_PROD_HOST: "localhost",
      DB_PROD_PORT: "15433",
      DB_PROD_NAME: "tariff_crawler",
      DB_PROD_USER: "u",
      DB_PROD_PASSWORD: "p",
      DATABASE_SSLMODE: undefined,
    },
    () => {
      const config = loadDatabaseConfig("production");
      assert.equal(config.sslmode, "require");
    },
  );
});
