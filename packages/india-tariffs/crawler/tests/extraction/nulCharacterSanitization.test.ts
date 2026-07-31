import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeExtractedText } from "../../src/extraction/pdfText.js";
import { DocumentArchive } from "../../src/archive.js";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import type { FetchRecord } from "../../src/types.js";

/**
 * The mission's explicit "sanitize derivatives, never originals" requirement:
 * sanitizeExtractedText() must strip NUL characters from text used for
 * citations/candidate fields, but the archived original PDF bytes (which may
 * legitimately contain NUL bytes as part of valid binary PDF structure) must
 * never be touched by any sanitizer. This test proves both halves against a
 * real DocumentArchive.put() round-trip, not just the pure-function behavior
 * already covered in tests/extraction/pdfText.test.ts.
 */

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

test("sanitizeExtractedText strips NUL from derivative text but never mutates the input buffer's bytes", () => {
  const originalBuffer = Buffer.from(`%PDF-1.4 fake binary content with an embedded${String.fromCharCode(0)}NUL byte`, "latin1");
  const originalBytesSnapshot = Buffer.from(originalBuffer);

  const derivativeText = originalBuffer.toString("latin1");
  const sanitized = sanitizeExtractedText(derivativeText);

  assert.equal(sanitized.includes(String.fromCharCode(0)), false, "derivative text must have NUL stripped");
  assert.deepEqual(originalBuffer, originalBytesSnapshot, "sanitizing the derivative string must never mutate the original buffer");
});

test(
  "a document containing a NUL byte can be archived with its original bytes fully intact on disk",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-nul-"));
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const sourceId = `TEST-SRC-${randomUUID()}`;
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
                     'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')
           ON CONFLICT (source_id) DO NOTHING`,
          [sourceId],
        );
      });

      const archive = new DocumentArchive(join(dir, "blobs"), db);
      const bodyWithNul = Buffer.from(`%PDF-1.4 content${String.fromCharCode(0)}with an embedded NUL byte, as real PDFs legitimately have`, "latin1");
      const sha = createHash("sha256").update(bodyWithNul).digest("hex");

      const record: FetchRecord = {
        requestedUrl: "https://example.gov.in/nul-test.pdf",
        finalUrl: "https://example.gov.in/nul-test.pdf",
        sourceId,
        retrievedAt: new Date().toISOString(),
        httpStatus: 200,
        contentType: "application/pdf",
        contentLength: bodyWithNul.byteLength,
        sha256: sha,
        fetcherVersion: "test",
        parentListingUrl: null,
      };

      const { entry } = await archive.put(bodyWithNul, record, "TARIFF_ORDER");
      const onDisk = readFileSync(entry.storage_uri);

      assert.deepEqual(onDisk, bodyWithNul, "archived bytes on disk must exactly match the original buffer, NUL byte included");
      assert.equal(onDisk.includes(0), true, "the archived file must still contain the original NUL byte -- it was never sanitized");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    }
  },
);
