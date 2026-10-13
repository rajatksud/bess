import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import { persistCandidates } from "../../src/extraction/extractionOrchestrator.js";
import type { SourceDocumentRow } from "../../src/extraction/extractionOrchestrator.js";
import type { ExtractedTariffFields } from "../../src/extraction/fieldExtractor.js";
import type { AuthoritativeSource } from "../../src/types.js";

/**
 * persistCandidates() writes candidate_tariffs + candidate_charge_components
 * + field_citations for each extracted category inside its own transaction
 * (see extractionOrchestrator.ts's insertOneCandidate). This proves both
 * halves of that design: a fully-formed category commits atomically with
 * all its charges and citations visible together, and a category whose
 * insert violates a DB constraint rolls back cleanly without leaving a
 * partial row (an orphaned candidate_tariffs row with no charges, or a
 * charge with no citation).
 */

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

async function seedSourceAndDocument(
  db: CrawlerDatabase,
): Promise<{ source: AuthoritativeSource; document: SourceDocumentRow }> {
  const sourceId = `TEST-SRC-${randomUUID()}`;
  const documentId = `TEST-DOC-${randomUUID()}`;
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
         source_id, jurisdiction_code, regulator_code, url, allowed_domains, source_type, authority_rank,
         discovery_method, adapter, monitoring_status
       ) VALUES ($1, 'ZZ', 'ZZREG', 'https://example.gov.in/tariffs', ARRAY['example.gov.in'], 'TARIFF_ORDER', 1,
                 'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')`,
      [sourceId],
    );
    await client.query(
      `INSERT INTO source_documents (document_id, source_id, sha256, storage_uri, document_type, first_seen_at, last_observed_at)
       VALUES ($1, $2, $3, '/tmp/fake.pdf', 'TARIFF_ORDER', now(), now())`,
      [documentId, sourceId, randomUUID().replace(/-/g, "").padEnd(64, "0")],
    );
    // extraction_jobs/extraction_attempts rows are required parents for
    // candidate_tariffs.extraction_attempt_id's FK.
    await client.query(`INSERT INTO extraction_jobs (document_id, status, method) VALUES ($1, 'SUCCEEDED', 'NATIVE_TEXT')`, [documentId]);
  });

  const document: SourceDocumentRow = {
    document_id: documentId,
    source_id: sourceId,
    storage_uri: "/tmp/fake.pdf",
    content_type: "application/pdf",
    first_seen_at: new Date().toISOString(),
  };
  const source: AuthoritativeSource = {
    source_id: sourceId,
    jurisdiction_code: "ZZ",
    url: "https://example.gov.in/tariffs",
    source_type: "TARIFF_ORDER",
    authority_rank: 1,
    monitoring_status: "ACTIVE",
    allowed_domains: ["example.gov.in"],
    discovery_method: "HTML_LINKS",
    adapter: "generic_html_link_listing",
  };
  return { source, document };
}

async function seedExtractionAttempt(db: CrawlerDatabase, documentId: string): Promise<number> {
  return db.withClient(async (client) => {
    const { rows: jobRows } = await client.query<{ id: string }>(`SELECT id FROM extraction_jobs WHERE document_id = $1`, [documentId]);
    const { rows: attemptRows } = await client.query<{ id: string }>(
      `INSERT INTO extraction_attempts (extraction_job_id, attempt_number, status, extractor_version)
       VALUES ($1, 1, 'SUCCEEDED', 'test') RETURNING id`,
      [jobRows[0].id],
    );
    return Number(attemptRows[0].id);
  });
}

function validField(categoryCode: string): ExtractedTariffFields {
  return {
    categoryCode,
    categoryNameOriginal: "Domestic",
    consumerClass: "OTHER",
    supplyLevel: "LT",
    billingEnergyBasis: null,
    billingDemandBasis: null,
    orderNumber: null,
    orderDate: "2025-03-27",
    effectiveFrom: null,
    charges: [
      {
        chargeType: "ENERGY",
        value: "-0.30",
        valueIsDelta: true,
        unit: "INR_PER_KWH",
        behaviour: "REBATE",
        citation: { pageNumber: 10, extractedText: "sample citation text" },
      },
    ],
    unresolvedFields: ["orderNumber"],
    categoryCitation: { pageNumber: 10, extractedText: "category citation text" },
  };
}

test(
  "persistCandidates writes candidate_tariffs, candidate_charge_components, and field_citations atomically per category",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const { source, document } = await seedSourceAndDocument(db);
      const attemptId = await seedExtractionAttempt(db, document.document_id);

      const ids = await persistCandidates(db, document, source, attemptId, [validField("LT-1")]);
      assert.equal(ids.length, 1);

      const { rows: candidateRows } = await db.withClient((c) =>
        c.query(`SELECT category_code, status FROM candidate_tariffs WHERE id = $1`, [ids[0]]),
      );
      assert.equal(candidateRows[0].category_code, "LT-1");
      assert.equal(candidateRows[0].status, "EXTRACTED");

      const { rows: chargeRows } = await db.withClient((c) =>
        c.query(`SELECT charge_type, value FROM candidate_charge_components WHERE candidate_tariff_id = $1`, [ids[0]]),
      );
      assert.equal(chargeRows.length, 1);
      assert.equal(chargeRows[0].charge_type, "ENERGY");

      const { rows: citationRows } = await db.withClient((c) =>
        c.query(
          `SELECT count(*) FROM field_citations WHERE candidate_tariff_id = $1
           UNION ALL
           SELECT count(*) FROM field_citations WHERE candidate_charge_id = (SELECT id FROM candidate_charge_components WHERE candidate_tariff_id = $1)`,
          [ids[0]],
        ),
      );
      assert.equal(Number(citationRows[0].count), 1, "category-level citation must exist");
      assert.equal(Number(citationRows[1].count), 1, "charge-level citation must exist");
    } finally {
      await db.close();
    }
  },
);

test(
  "a category whose insert violates a DB constraint rolls back cleanly, leaving no partial candidate_tariffs/charge rows",
  { skip: !config },
  async () => {
    const db = new CrawlerDatabase(config!);
    try {
      await db.ensureEnvironmentMarker();
      await migrate(db);
      const { source, document } = await seedSourceAndDocument(db);
      const attemptId = await seedExtractionAttempt(db, document.document_id);

      const goodField = validField("LT-2");
      const badField = validField("LT-3");
      // consumer_class has a CHECK constraint restricting it to
      // INDUSTRIAL/COMMERCIAL/MIXED/OTHER -- an invalid value here forces
      // insertOneCandidate's transaction to fail partway through, after the
      // candidate_tariffs INSERT would have succeeded on its own but before
      // its charges/citations are written.
      (badField as unknown as { consumerClass: string }).consumerClass = "NOT_A_REAL_CLASS";

      const before = await db.withClient((c) => c.query(`SELECT count(*) FROM candidate_tariffs WHERE document_id = $1`, [document.document_id]));
      assert.equal(Number(before.rows[0].count), 0);

      await assert.rejects(() => persistCandidates(db, document, source, attemptId, [goodField, badField]));

      const { rows } = await db.withClient((c) =>
        c.query(`SELECT category_code FROM candidate_tariffs WHERE document_id = $1`, [document.document_id]),
      );
      assert.equal(rows.length, 1, "the good category before the bad one must still have committed (each category is its own transaction)");
      assert.equal(rows[0].category_code, "LT-2");

      const { rows: badRows } = await db.withClient((c) =>
        c.query(`SELECT * FROM candidate_tariffs WHERE document_id = $1 AND category_code = 'LT-3'`, [document.document_id]),
      );
      assert.equal(badRows.length, 0, "the failing category must leave zero rows behind, not a half-written candidate_tariffs row");
    } finally {
      await db.close();
    }
  },
);
