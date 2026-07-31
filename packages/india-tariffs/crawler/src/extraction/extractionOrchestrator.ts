import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import type { CrawlerDatabase } from "../db/client.js";
import type { AuthoritativeSource } from "../types.js";
import { classifyDocument, CLASSIFIER_VERSION, detectEffectiveDateLanguage, detectFinalOrderSignatureLanguage } from "../classifier.js";
import type { ClassificationEvidence, ClassificationOutcome } from "../classifier.js";
import { extractNativeText, ExtractionUnresolvedError, PDF_TEXT_EXTRACTOR_VERSION } from "./pdfText.js";
import { reconstructTables } from "./pdfTables.js";
import { extractTariffFields, FIELD_EXTRACTOR_VERSION } from "./fieldExtractor.js";
import type { ExtractedTariffFields } from "./fieldExtractor.js";

export interface SourceDocumentRow {
  document_id: string;
  source_id: string;
  storage_uri: string;
  content_type: string | null;
  first_seen_at: string;
}

export interface ExtractionRunResult {
  classification: ClassificationOutcome;
  /** Null when classification short-circuited extraction (petition/notice/irrelevant) -- no extraction_jobs row is created in that case. */
  extractionJobId: number | null;
  candidateTariffIds: number[];
  status: "CLASSIFIED_NON_TARIFF" | "EXTRACTED" | "MANUAL_REVIEW_REQUIRED";
  reason: string | null;
}

const TARIFF_BEARING_CLASSES = new Set([
  "FINAL_TARIFF_ORDER",
  "TARIFF_SCHEDULE",
  "MYT_ORDER",
  "REVIEW_ORDER",
  "TRUE_UP_WITH_RATE_CHANGE",
  "AMENDMENT",
  "FAC_FPPAS_ADJUSTMENT",
  "SUPPLY_CODE_AMENDMENT",
]);

/**
 * Ties classification and extraction together for a single already-archived
 * document. Classification always runs and is always persisted; extraction
 * only runs for document classes that can plausibly carry tariff rate data
 * (see TARIFF_BEARING_CLASSES) -- a TARIFF_PETITION or PUBLIC_NOTICE never
 * reaches extractNativeText, let alone candidate_tariffs, no matter what its
 * text contains. This is the mechanism (not just classifier.ts's own
 * short-circuit) that keeps petitions out of the pipeline: even a
 * classification bug that let a petition score as e.g. TARIFF_SCHEDULE would
 * still need a second, independent class-membership check here to reach
 * extraction.
 */
export async function runExtraction(
  db: CrawlerDatabase,
  document: SourceDocumentRow,
  source: AuthoritativeSource,
): Promise<ExtractionRunResult> {
  const pdfBuffer = readFileSync(document.storage_uri);

  let firstPageText: string | null = null;
  let nativeText: Awaited<ReturnType<typeof extractNativeText>> | null = null;
  try {
    nativeText = await extractNativeText(pdfBuffer);
    firstPageText = nativeText.pages[0]?.text.slice(0, 2000) ?? null;
  } catch (err) {
    if (!(err instanceof ExtractionUnresolvedError)) throw err;
    // Text extraction failing is itself useful classification evidence (a
    // scanned/image-only PDF) -- classification still runs, just with no
    // firstPageText, rather than being skipped entirely.
  }

  const evidence: ClassificationEvidence = {
    linkText: null,
    url: document.storage_uri,
    documentTitle: null,
    firstPageText,
    issuingAuthority: source.regulator_code ?? null,
    orderNumber: null,
    hasEffectiveDateLanguage: firstPageText ? detectEffectiveDateLanguage(firstPageText) : false,
    hasFinalOrderSignatureLanguage: firstPageText ? detectFinalOrderSignatureLanguage(firstPageText) : false,
  };
  const classification = classifyDocument(evidence);

  await db.withClient((client) =>
    client.query(
      `INSERT INTO classification_results (document_id, document_class, confidence, evidence, classifier_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [document.document_id, classification.documentClass, classification.confidence, JSON.stringify(classification.evidence), CLASSIFIER_VERSION],
    ),
  );

  if (!TARIFF_BEARING_CLASSES.has(classification.documentClass)) {
    return {
      classification,
      extractionJobId: null,
      candidateTariffIds: [],
      status: "CLASSIFIED_NON_TARIFF",
      reason: `document_class=${classification.documentClass} is not tariff-bearing; no extraction_jobs row created`,
    };
  }

  if (!nativeText) {
    // Tariff-bearing class but no extractable text layer (scanned PDF) --
    // record a MANUAL extraction_jobs row (real OCR is out of scope for this
    // milestone, see ocrStub.ts) rather than silently doing nothing.
    const jobId = await db.withClient(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO extraction_jobs (document_id, status, method) VALUES ($1, 'FAILED', 'MANUAL') RETURNING id`,
        [document.document_id],
      );
      return Number(rows[0].id);
    });
    return {
      classification,
      extractionJobId: jobId,
      candidateTariffIds: [],
      status: "MANUAL_REVIEW_REQUIRED",
      reason: "no extractable text layer -- routed to MANUAL extraction_jobs row, OCR not implemented in this milestone",
    };
  }

  const jobId = await db.withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO extraction_jobs (document_id, status, method) VALUES ($1, 'RUNNING', 'NATIVE_TEXT') RETURNING id`,
      [document.document_id],
    );
    return Number(rows[0].id);
  });

  const attemptId = await db.withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO extraction_attempts (extraction_job_id, attempt_number, status, extractor_version)
       VALUES ($1, 1, 'RUNNING', $2) RETURNING id`,
      [jobId, `${PDF_TEXT_EXTRACTOR_VERSION}+${FIELD_EXTRACTOR_VERSION}`],
    );
    return Number(rows[0].id);
  });

  let fields: ExtractedTariffFields[];
  try {
    const tables = nativeText.pages.flatMap((page) => reconstructTables({ pageNumber: page.pageNumber, items: page.items }));
    fields = extractTariffFields(nativeText, tables, source);
  } catch (err) {
    await db.withClient((client) =>
      client.query(`UPDATE extraction_attempts SET finished_at = now(), status = 'FAILED', error_message = $2 WHERE id = $1`, [
        attemptId,
        (err as Error).message,
      ]),
    );
    await db.withClient((client) =>
      client.query(`UPDATE extraction_jobs SET status = 'FAILED' WHERE id = $1`, [jobId]),
    );
    throw err;
  }

  await db.withClient((client) =>
    client.query(`UPDATE extraction_attempts SET finished_at = now(), status = 'SUCCEEDED' WHERE id = $1`, [attemptId]),
  );
  await db.withClient((client) => client.query(`UPDATE extraction_jobs SET status = 'SUCCEEDED' WHERE id = $1`, [jobId]));

  const candidateTariffIds = await persistCandidates(db, document, source, attemptId, fields);

  return {
    classification,
    extractionJobId: jobId,
    candidateTariffIds,
    status: "EXTRACTED",
    reason: null,
  };
}

/**
 * Writes one candidate_tariffs row per extracted category, each with its
 * charge components and field_citations, in a single transaction per
 * category -- a failure partway through one category's charges never leaves
 * that category half-written, but a failure on category N does not roll back
 * categories already committed before it (each category is its own unit of
 * work, consistent with the mission's per-field "don't let one bad field
 * block everything else" principle). Every charge component gets its own
 * field_citations row; a category-level citation is also recorded against
 * the candidate_tariffs row itself so the category/date fields are
 * traceable even when a category has zero charges.
 */
export async function persistCandidates(
  db: CrawlerDatabase,
  document: SourceDocumentRow,
  source: AuthoritativeSource,
  extractionAttemptId: number,
  fields: ExtractedTariffFields[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const field of fields) {
    if (!field.categoryCode) {
      // The "nothing matched at all" sentinel result from fieldExtractor --
      // itself an important signal, but there is no category to attach a
      // candidate_tariffs row to (category_code is NOT NULL), so it is
      // surfaced only via extractionJobId/status, not as a DB row.
      continue;
    }
    const id = await db.withTransaction((client) => insertOneCandidate(client, document, source, extractionAttemptId, field));
    ids.push(id);
  }
  return ids;
}

async function insertOneCandidate(
  client: PoolClient,
  document: SourceDocumentRow,
  source: AuthoritativeSource,
  extractionAttemptId: number,
  field: ExtractedTariffFields,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO candidate_tariffs (
       extraction_attempt_id, document_id, jurisdiction_code, licensee_code,
       category_code, category_name_original, consumer_class, supply_level,
       billing_energy_basis, billing_demand_basis, order_number, order_date,
       effective_from, retrieved_at, status, raw_fields
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'EXTRACTED', $15)
     RETURNING id`,
    [
      extractionAttemptId,
      document.document_id,
      source.jurisdiction_code ?? null,
      source.licensee_code ?? null,
      field.categoryCode,
      field.categoryNameOriginal,
      field.consumerClass,
      field.supplyLevel,
      field.billingEnergyBasis,
      field.billingDemandBasis,
      field.orderNumber,
      field.orderDate,
      field.effectiveFrom,
      document.first_seen_at,
      JSON.stringify({ unresolvedFields: field.unresolvedFields }),
    ],
  );
  const candidateTariffId = Number(rows[0].id);

  if (field.categoryCitation) {
    await client.query(
      `INSERT INTO field_citations (
         candidate_tariff_id, document_id, page_number, extracted_text, extraction_method, extraction_version
       ) VALUES ($1, $2, $3, $4, 'NATIVE_TEXT', $5)`,
      [candidateTariffId, document.document_id, field.categoryCitation.pageNumber, field.categoryCitation.extractedText, FIELD_EXTRACTOR_VERSION],
    );
  }

  for (const charge of field.charges) {
    const { rows: chargeRows } = await client.query<{ id: string }>(
      `INSERT INTO candidate_charge_components (
         candidate_tariff_id, charge_id, charge_type, value, unit, behaviour, applicability
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        candidateTariffId,
        `${field.categoryCode}-${charge.chargeType}-${candidateTariffId}`,
        charge.chargeType,
        charge.value,
        charge.unit,
        charge.behaviour,
        JSON.stringify({ valueIsDelta: charge.valueIsDelta }),
      ],
    );
    const chargeId = Number(chargeRows[0].id);
    await client.query(
      `INSERT INTO field_citations (
         candidate_charge_id, document_id, page_number, extracted_text, extraction_method, extraction_version
       ) VALUES ($1, $2, $3, $4, 'NATIVE_TEXT', $5)`,
      [chargeId, document.document_id, charge.citation.pageNumber, charge.citation.extractedText, FIELD_EXTRACTOR_VERSION],
    );
  }

  return candidateTariffId;
}
