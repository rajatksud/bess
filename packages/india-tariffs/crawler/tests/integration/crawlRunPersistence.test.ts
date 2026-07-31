import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import { startCrawlRun, finishCrawlRun, recordFetchObservation } from "../../src/db/crawlRunRepository.js";

/**
 * Integration tests for the crawl_runs/fetch_observations persistence layer
 * (packages/india-tariffs/crawler/src/db/crawlRunRepository.ts), the core
 * gap this milestone closes: prior to this, crawlSource() never touched
 * Postgres at all. Requires a real disposable Postgres database; skipped
 * (not failed) without one, same pattern as tests/integration/migrate.test.ts.
 */

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

async function seedSource(db: CrawlerDatabase, sourceId: string): Promise<void> {
  await db.withClient(async (client) => {
    await client.query(
      `INSERT INTO jurisdictions (code, name, jurisdiction_type, coverage_status)
       VALUES ('ZZ', 'Test Jurisdiction', 'STATE', 'NOT_STARTED')
       ON CONFLICT (code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO regulators (code, legal_name, regulator_type)
       VALUES ('ZZREG', 'Test Regulator', 'SERC')
       ON CONFLICT (code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authoritative_sources (
         source_id, url, allowed_domains, source_type, authority_rank,
         discovery_method, adapter, monitoring_status
       ) VALUES ($1, 'https://example.gov.in/tariffs', ARRAY['example.gov.in'], 'TARIFF_ORDER', 1,
                 'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')
       ON CONFLICT (source_id) DO NOTHING`,
      [sourceId],
    );
  });
}

test("startCrawlRun inserts a RUNNING row and returns an id", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const sourceId = `TEST-SRC-${randomUUID()}`;
    await seedSource(db, sourceId);

    const run = await startCrawlRun(db, sourceId, "test-version");
    assert.ok(run.id > 0);
    assert.equal(run.sourceId, sourceId);

    const { rows } = await db.withClient((client) => client.query(`SELECT status FROM crawl_runs WHERE id = $1`, [run.id]));
    assert.equal(rows[0].status, "RUNNING");
  } finally {
    await db.close();
  }
});

test("finishCrawlRun transitions RUNNING -> SUCCEEDED with correct counters", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    const sourceId = `TEST-SRC-${randomUUID()}`;
    await seedSource(db, sourceId);

    const run = await startCrawlRun(db, sourceId, "test-version");
    await finishCrawlRun(db, run.id, {
      status: "SUCCEEDED",
      linksDiscovered: 5,
      documentsFetched: 3,
      newDocuments: 2,
      replacementsDetected: 0,
      errorSummary: null,
    });

    const { rows } = await db.withClient((client) =>
      client.query(
        `SELECT status, links_discovered, documents_fetched, new_documents, finished_at FROM crawl_runs WHERE id = $1`,
        [run.id],
      ),
    );
    assert.equal(rows[0].status, "SUCCEEDED");
    assert.equal(rows[0].links_discovered, 5);
    assert.equal(rows[0].documents_fetched, 3);
    assert.equal(rows[0].new_documents, 2);
    assert.ok(rows[0].finished_at !== null);
  } finally {
    await db.close();
  }
});

test("finishCrawlRun transitions RUNNING -> FAILED with error_summary populated", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    const sourceId = `TEST-SRC-${randomUUID()}`;
    await seedSource(db, sourceId);

    const run = await startCrawlRun(db, sourceId, "test-version");
    await finishCrawlRun(db, run.id, {
      status: "FAILED",
      linksDiscovered: 0,
      documentsFetched: 0,
      newDocuments: 0,
      replacementsDetected: 0,
      errorSummary: "Failed to fetch listing page: timeout",
    });

    const { rows } = await db.withClient((client) => client.query(`SELECT status, error_summary FROM crawl_runs WHERE id = $1`, [run.id]));
    assert.equal(rows[0].status, "FAILED");
    assert.match(rows[0].error_summary, /timeout/);
  } finally {
    await db.close();
  }
});

test("recordFetchObservation inserts a row referencing the crawl_run_id", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    const sourceId = `TEST-SRC-${randomUUID()}`;
    await seedSource(db, sourceId);
    const run = await startCrawlRun(db, sourceId, "test-version");

    await recordFetchObservation(db, run.id, sourceId, {
      requestedUrl: "https://example.gov.in/order.pdf",
      finalUrl: "https://example.gov.in/order.pdf",
      parentListingUrl: "https://example.gov.in/tariffs",
      retrievedAt: new Date().toISOString(),
      httpStatus: 200,
      contentType: "application/pdf",
      contentLength: 1024,
      sha256: "a".repeat(64),
      fetcherVersion: "test-version",
    });

    const { rows } = await db.withClient((client) =>
      client.query(`SELECT crawl_run_id, sha256, http_status FROM fetch_observations WHERE crawl_run_id = $1`, [run.id]),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].crawl_run_id, run.id);
    assert.equal(rows[0].sha256, "a".repeat(64));
    assert.equal(rows[0].http_status, 200);
  } finally {
    await db.close();
  }
});

test(
  "two recordFetchObservation calls with the same sha256 in the same run both persist (append-only log, not deduplicated)",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    try {
      await db.ensureEnvironmentMarker();
      const sourceId = `TEST-SRC-${randomUUID()}`;
      await seedSource(db, sourceId);
      const run = await startCrawlRun(db, sourceId, "test-version");

      const sha = "b".repeat(64);
      const obs = {
        requestedUrl: "https://example.gov.in/order.pdf",
        finalUrl: "https://example.gov.in/order.pdf",
        parentListingUrl: null,
        retrievedAt: new Date().toISOString(),
        httpStatus: 200,
        contentType: "application/pdf",
        contentLength: 1024,
        sha256: sha,
        fetcherVersion: "test-version",
      };
      await recordFetchObservation(db, run.id, sourceId, obs);
      await recordFetchObservation(db, run.id, sourceId, obs);

      const { rows } = await db.withClient((client) =>
        client.query(`SELECT count(*) FROM fetch_observations WHERE crawl_run_id = $1 AND sha256 = $2`, [run.id, sha]),
      );
      assert.equal(Number(rows[0].count), 2, "fetch_observations is a history log, not deduplicated by sha256");
    } finally {
      await db.close();
    }
  },
);
