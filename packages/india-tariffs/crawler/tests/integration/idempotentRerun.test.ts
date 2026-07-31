import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentArchive } from "../../src/archive.js";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import type { FetchRecord } from "../../src/types.js";

/**
 * Proves the mission's explicit idempotency requirement end-to-end: a second
 * crawl of unchanged content must not create a duplicate source_documents
 * row, and a same-URL-changed-content rerun must be flagged as a
 * replacement, not silently overwritten. tests/integration/archive.test.ts
 * covers put()/findReplacement() individually; this file simulates the
 * two-full-crawl-cycle shape the real `crawl` CLI command produces.
 */

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

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
         source_id, regulator_code, url, allowed_domains, source_type, authority_rank,
         discovery_method, adapter, monitoring_status
       ) VALUES ($1, 'ZZREG', 'https://example.gov.in/tariffs', ARRAY['example.gov.in'], 'TARIFF_ORDER', 1,
                 'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')
       ON CONFLICT (source_id) DO NOTHING`,
      [sourceId],
    );
  });
}

function record(sourceId: string, url: string, body: Buffer, overrides: Partial<FetchRecord> = {}): FetchRecord {
  return {
    requestedUrl: url,
    finalUrl: url,
    sourceId,
    retrievedAt: new Date().toISOString(),
    httpStatus: 200,
    contentType: "application/pdf",
    contentLength: body.byteLength,
    sha256: sha256(body),
    fetcherVersion: "test",
    parentListingUrl: null,
    ...overrides,
  };
}

test(
  "rerunning a crawl against unchanged content produces zero new source_documents rows (full dedup proof, criterion #13)",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-idempotent-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const sourceId = `TEST-SRC-${randomUUID()}`;
      await seedSource(db, sourceId);
      const archive = new DocumentArchive(join(dir, "blobs"), db);

      const body = Buffer.from("real tariff order content, unchanged across both crawl cycles");
      const url = "https://example.gov.in/order-2025.pdf";

      const { rows: beforeRows } = await db.withClient((c) => c.query(`SELECT count(*) FROM source_documents WHERE source_id = $1`, [sourceId]));
      assert.equal(Number(beforeRows[0].count), 0);

      const first = await archive.put(body, record(sourceId, url, body), "TARIFF_ORDER");
      assert.equal(first.isNewDocument, true);

      // Simulates a second, later crawl run fetching the exact same bytes at
      // the exact same URL -- this is the common "nothing changed" case a
      // scheduler will hit on every subsequent run for a stable document.
      const second = await archive.put(body, record(sourceId, url, body), "TARIFF_ORDER");
      assert.equal(second.isNewDocument, false);
      assert.equal(second.entry.document_id, first.entry.document_id);

      const { rows: afterRows } = await db.withClient((c) => c.query(`SELECT count(*) FROM source_documents WHERE source_id = $1`, [sourceId]));
      assert.equal(Number(afterRows[0].count), 1, "two identical put() calls must result in exactly one source_documents row");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);

test(
  "the same URL serving new content across two crawl cycles is detected as a replacement, never silently overwritten (criterion #14)",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-idempotent-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const sourceId = `TEST-SRC-${randomUUID()}`;
      await seedSource(db, sourceId);
      const archive = new DocumentArchive(join(dir, "blobs"), db);
      const url = "https://example.gov.in/order-current.pdf";

      const bodyV1 = Buffer.from("tariff order version 1 -- FY2024-25 rates");
      const first = await archive.put(bodyV1, record(sourceId, url, bodyV1), "TARIFF_ORDER");
      assert.equal(first.isNewDocument, true);

      const bodyV2 = Buffer.from("tariff order version 2 -- FY2025-26 revised rates, supersedes v1");
      const replacement = await archive.findReplacement(url, sha256(bodyV2));
      assert.ok(replacement, "must detect the prior document at this URL before the new content is archived");
      assert.equal(replacement!.sha256, sha256(bodyV1));

      const second = await archive.put(bodyV2, record(sourceId, url, bodyV2), "TARIFF_ORDER");
      assert.equal(second.isNewDocument, true, "new content at an existing URL must create a new source_documents row, never overwrite the old one");
      assert.notEqual(second.entry.document_id, first.entry.document_id);

      const { rows } = await db.withClient((c) => c.query(`SELECT count(*) FROM source_documents WHERE source_id = $1`, [sourceId]));
      assert.equal(Number(rows[0].count), 2, "both the original and the replacement document must still exist -- originals are never deleted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);
