import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeNextRunAt, runSchedulerBatch } from "../../src/scheduler.js";
import { DocumentArchive } from "../../src/archive.js";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import type { AuthoritativeSource } from "../../src/types.js";
import type { AcquisitionProvider, AcquisitionResult } from "../../src/acquisition/types.js";

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

test("computeNextRunAt adds the correct interval for each cadence", () => {
  const from = new Date("2026-03-27T00:00:00.000Z");
  assert.equal(computeNextRunAt("HOURLY", from).toISOString(), "2026-03-27T01:00:00.000Z");
  assert.equal(computeNextRunAt("EVERY_6_HOURS", from).toISOString(), "2026-03-27T06:00:00.000Z");
  assert.equal(computeNextRunAt("DAILY", from).toISOString(), "2026-03-28T00:00:00.000Z");
  assert.equal(computeNextRunAt("WEEKLY", from).toISOString(), "2026-04-03T00:00:00.000Z");
});

/** An AcquisitionProvider whose listing-page fetch always fails cleanly, so crawlSource() reports zero links/documents without needing a real network call. */
class FailingAcquisitionProvider implements AcquisitionProvider {
  readonly name = "HTTP" as const;
  calls: string[] = [];
  async acquire(source: AuthoritativeSource, url: string): Promise<AcquisitionResult> {
    this.calls.push(source.source_id);
    return {
      requestedUrl: url,
      finalUrl: url,
      html: null,
      renderedHtml: null,
      markdown: null,
      discoveredLinks: [],
      provider: "HTTP",
      firecrawlJobId: null,
      retrievedAt: new Date().toISOString(),
      durationMs: 1,
      status: "ERROR",
      error: { message: "simulated failure for scheduler test", retryable: false },
    };
  }
}

async function seedActiveSource(db: CrawlerDatabase, cadence: string, nextRunAt: Date): Promise<AuthoritativeSource> {
  const sourceId = `TEST-SCHED-${randomUUID()}`;
  await db.withClient(async (client) => {
    await client.query(
      `INSERT INTO jurisdictions (code, name, jurisdiction_type, coverage_status)
       VALUES ('ZZ', 'Test Jurisdiction', 'STATE', 'NOT_STARTED') ON CONFLICT (code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO regulators (code, legal_name, regulator_type)
       VALUES ('ZZREG', 'Test Regulator', 'SERC') ON CONFLICT (code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authoritative_sources (
         source_id, regulator_code, url, allowed_domains, source_type, authority_rank,
         discovery_method, adapter, monitoring_status
       ) VALUES ($1, 'ZZREG', 'https://example.gov.in/tariffs', ARRAY['example.gov.in'], 'TARIFF_ORDER', 1,
                 'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')`,
      [sourceId],
    );
    await client.query(
      `INSERT INTO crawl_schedules (source_id, cadence, next_run_at) VALUES ($1, $2, $3)`,
      [sourceId, cadence, nextRunAt.toISOString()],
    );
  });
  return {
    source_id: sourceId,
    jurisdiction_code: "ZZ",
    regulator_code: "ZZREG",
    url: "https://example.gov.in/tariffs",
    source_type: "TARIFF_ORDER",
    authority_rank: 1,
    monitoring_status: "ACTIVE",
    allowed_domains: ["example.gov.in"],
    discovery_method: "HTML_LINKS",
    adapter: "generic_html_link_listing",
  };
}

test(
  "runSchedulerBatch crawls a due source and advances its next_run_at by one cadence interval",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-scheduler-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const now = new Date();
      const source = await seedActiveSource(db, "DAILY", new Date(now.getTime() - 1000)); // due 1s ago
      const archive = new DocumentArchive(join(dir, "blobs"), db);
      const acquisition = new FailingAcquisitionProvider();

      const result = await runSchedulerBatch({
        db,
        registry: [source],
        archive,
        acquisition,
        now,
        jitterMaxMs: 0,
        schedulerInstanceId: "test-instance",
      });

      assert.equal(result.attempted, 1);
      assert.deepEqual(acquisition.calls, [source.source_id]);

      const { rows } = await db.withClient((c) =>
        c.query(`SELECT next_run_at, consecutive_failures, last_run_at FROM crawl_schedules WHERE source_id = $1`, [source.source_id]),
      );
      assert.ok(new Date(rows[0].next_run_at) > now, "next_run_at must be advanced past now");
      assert.ok(rows[0].last_run_at !== null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);

test("runSchedulerBatch skips a source whose next_run_at is in the future", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  const dir = mkdtempSync(join(tmpdir(), "india-tariffs-scheduler-"));
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const now = new Date();
    const source = await seedActiveSource(db, "DAILY", new Date(now.getTime() + 60 * 60 * 1000)); // due in 1h
    const archive = new DocumentArchive(join(dir, "blobs"), db);
    const acquisition = new FailingAcquisitionProvider();

    const result = await runSchedulerBatch({
      db,
      registry: [source],
      archive,
      acquisition,
      now,
      jitterMaxMs: 0,
      schedulerInstanceId: "test-instance",
    });

    assert.equal(result.attempted, 0);
    assert.equal(result.skippedNotDue, 1);
    assert.deepEqual(acquisition.calls, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});

test(
  "a source already holding the scheduler lock is skipped, never crawled concurrently by a second batch",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-scheduler-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const now = new Date();
      const source = await seedActiveSource(db, "DAILY", new Date(now.getTime() - 1000));
      const archive = new DocumentArchive(join(dir, "blobs"), db);
      const acquisition = new FailingAcquisitionProvider();

      const acquired = await db.tryAcquireSchedulerLock(`crawl:${source.source_id}`, "another-scheduler-instance", 300);
      assert.equal(acquired, true);

      const result = await runSchedulerBatch({
        db,
        registry: [source],
        archive,
        acquisition,
        now,
        jitterMaxMs: 0,
        schedulerInstanceId: "test-instance",
      });

      assert.equal(result.attempted, 0);
      assert.equal(result.skippedLocked, 1);
      assert.deepEqual(acquisition.calls, []);

      await db.releaseSchedulerLock(`crawl:${source.source_id}`, "another-scheduler-instance");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);

test(
  "a source with consecutive_failures at the skip threshold is not crawled until a human resets it",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-scheduler-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const now = new Date();
      const source = await seedActiveSource(db, "DAILY", new Date(now.getTime() - 1000));
      await db.withClient((c) => c.query(`UPDATE crawl_schedules SET consecutive_failures = 5 WHERE source_id = $1`, [source.source_id]));

      const archive = new DocumentArchive(join(dir, "blobs"), db);
      const acquisition = new FailingAcquisitionProvider();

      const result = await runSchedulerBatch({
        db,
        registry: [source],
        archive,
        acquisition,
        now,
        jitterMaxMs: 0,
        schedulerInstanceId: "test-instance",
      });

      assert.equal(result.attempted, 0);
      assert.equal(result.skippedTooManyFailures, 1);
      assert.deepEqual(acquisition.calls, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);
