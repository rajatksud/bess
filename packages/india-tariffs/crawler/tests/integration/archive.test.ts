import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentArchive } from "../../src/archive.js";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import type { FetchRecord } from "../../src/types.js";

/**
 * Integration tests for the Postgres-backed DocumentArchive (see
 * src/archive.ts). Moved here from tests/archive.test.ts because Phase 2 of
 * the crawler vertical-slice work made PostgreSQL the authoritative
 * document manifest (source_documents/document_url_aliases), replacing the
 * prior local-JSON-manifest implementation that was not safe for
 * concurrent/server execution -- this file now requires a real disposable
 * Postgres database, same gating pattern as the other tests/integration/
 * files.
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

function record(sourceId: string, overrides: Partial<FetchRecord>, body: Buffer): FetchRecord {
  return {
    requestedUrl: overrides.finalUrl ?? "https://example.gov.in/a.pdf",
    finalUrl: "https://example.gov.in/a.pdf",
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

async function makeArchive(db: CrawlerDatabase): Promise<{ archive: DocumentArchive; dir: string; sourceId: string }> {
  const dir = mkdtempSync(join(tmpdir(), "india-tariffs-archive-"));
  const sourceId = `TEST-SRC-${randomUUID()}`;
  await seedSource(db, sourceId);
  return { archive: new DocumentArchive(join(dir, "blobs"), db), dir, sourceId };
}

test("put() stores a new document and adds it to the manifest", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const { archive, dir, sourceId } = await makeArchive(db);
    const body = Buffer.from("tariff order content v1");
    const { entry, isNewDocument } = await archive.put(body, record(sourceId, {}, body), "TARIFF_ORDER");

    assert.equal(isNewDocument, true);
    assert.equal(entry.sha256, sha256(body));
    const docs = await archive.listDocuments();
    assert.ok(docs.some((d) => d.document_id === entry.document_id));
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await db.close();
  }
});

test("put() recognizes the same binary observed at a new URL as one document", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const { archive, dir, sourceId } = await makeArchive(db);
    const body = Buffer.from("tariff order content v1");
    const first = await archive.put(body, record(sourceId, { finalUrl: "https://example.gov.in/a.pdf" }, body), "TARIFF_ORDER");
    const second = await archive.put(
      body,
      record(sourceId, { finalUrl: "https://example.gov.in/mirrors/a-copy.pdf" }, body),
      "TARIFF_ORDER",
    );

    assert.equal(second.isNewDocument, false);
    assert.equal(second.entry.document_id, first.entry.document_id);
    assert.deepEqual(second.entry.observed_urls.sort(), [
      "https://example.gov.in/a.pdf",
      "https://example.gov.in/mirrors/a-copy.pdf",
    ]);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await db.close();
  }
});

test("findReplacement detects an unchanged URL now serving new content", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const { archive, dir, sourceId } = await makeArchive(db);
    const url = "https://example.gov.in/a.pdf";
    const bodyV1 = Buffer.from("tariff order content v1");
    const bodyV2 = Buffer.from("tariff order content v2, silently swapped");

    await archive.put(bodyV1, record(sourceId, { finalUrl: url }, bodyV1), "TARIFF_ORDER");

    const replacement = await archive.findReplacement(url, sha256(bodyV2));
    assert.ok(replacement, "expected a replacement to be detected");
    assert.equal(replacement?.sha256, sha256(bodyV1));

    const noReplacement = await archive.findReplacement(url, sha256(bodyV1));
    assert.equal(noReplacement, null);

    rmSync(dir, { recursive: true, force: true });
  } finally {
    await db.close();
  }
});

test(
  "put() is safe under concurrent calls with the same sha256 (no duplicate source_documents row)",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const { archive, dir, sourceId } = await makeArchive(db);
      const body = Buffer.from("concurrent put content");
      const sha = sha256(body);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          archive.put(body, record(sourceId, { finalUrl: `https://example.gov.in/concurrent-${i}.pdf` }, body), "TARIFF_ORDER"),
        ),
      );

      const documentIds = new Set(results.map((r) => r.entry.document_id));
      assert.equal(documentIds.size, 1, "all concurrent puts of identical content must resolve to one document_id");

      const { rows } = await db.withClient((client) => client.query(`SELECT count(*) FROM source_documents WHERE sha256 = $1`, [sha]));
      assert.equal(Number(rows[0].count), 1, "exactly one source_documents row for the shared sha256");

      const { rows: aliasRows } = await db.withClient((client) =>
        client.query(`SELECT count(*) FROM document_url_aliases WHERE document_id = $1`, [[...documentIds][0]]),
      );
      assert.equal(Number(aliasRows[0].count), 5, "all 5 distinct URLs recorded as aliases of the one document");

      rmSync(dir, { recursive: true, force: true });
    } finally {
      await db.close();
    }
  },
);

test("writeBlobAtomic never leaves a partially-written or stray temp file at the final path", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const { archive, dir, sourceId } = await makeArchive(db);
    const body = Buffer.from("atomic write content");
    const { entry } = await archive.put(body, record(sourceId, {}, body), "TARIFF_ORDER");

    const shardDir = join(dir, "blobs", entry.sha256.slice(0, 2));
    const files = readdirSync(shardDir);
    assert.deepEqual(files, [entry.sha256], "only the final-named blob should remain, no leftover .tmp-* files");

    rmSync(dir, { recursive: true, force: true });
  } finally {
    await db.close();
  }
});
