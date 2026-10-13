import type { CrawlerDatabase } from "../db/client.js";
import {
  validateSchema,
  validateReferential,
  validateEffectiveDate,
  validateUnits,
  validateProvenance,
  validateCommercialSanity,
  validateCategoryResolution,
} from "./validators.js";
import type { CandidateTariffRecord, ChargeComponentRecord, DocumentSourceRecord, ValidationFinding } from "./validators.js";

export interface ValidationRunResult {
  candidateTariffId: number;
  findings: ValidationFinding[];
  reviewReady: boolean;
}

/**
 * Runs every validation layer against one candidate_tariffs row and its
 * charge components, persists each finding as a validation_results row, and
 * updates candidate_tariffs.status to VALIDATED or REVIEW_READY.
 *
 * reviewReady is true only when there are zero ERROR-severity findings --
 * WARNING/INFO findings (unresolved fields, missing corrigendum
 * reconciliation, commercial-sanity flags) do not block REVIEW_READY, since
 * those are exactly the things a human reviewer is meant to look at, not
 * reasons to withhold the candidate from review entirely.
 *
 * This function has no code path that reaches beyond the review-ready
 * boundary this milestone owns -- REVIEW_READY is the final status this
 * pipeline can ever produce (see tests/noAutoApproval.test.ts for the
 * static, repo-wide enforcement of this boundary).
 */
export async function runValidation(db: CrawlerDatabase, candidateTariffId: number): Promise<ValidationRunResult> {
  const { candidate, documentSource, charges, hasUnreconciledLaterCorrigendum } = await loadCandidateContext(db, candidateTariffId);

  const findings: ValidationFinding[] = [
    ...validateSchema(candidate),
    ...validateReferential(candidate, documentSource),
    ...validateEffectiveDate(candidate, { hasUnreconciledLaterCorrigendum }),
    ...validateCategoryResolution(candidate),
  ];
  for (const charge of charges) {
    findings.push(...validateUnits(charge));
    findings.push(...validateProvenance(charge));
    findings.push(...validateCommercialSanity(charge));
  }

  const reviewReady = !findings.some((f) => f.severity === "ERROR");

  await db.withTransaction(async (client) => {
    for (const finding of findings) {
      await client.query(
        `INSERT INTO validation_results (candidate_tariff_id, validation_layer, severity, message, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [candidateTariffId, finding.layer, finding.severity, finding.message, JSON.stringify(finding.details)],
      );
    }
    await client.query(`UPDATE candidate_tariffs SET status = $2 WHERE id = $1`, [
      candidateTariffId,
      reviewReady ? "REVIEW_READY" : "VALIDATED",
    ]);
  });

  return { candidateTariffId, findings, reviewReady };
}

async function loadCandidateContext(
  db: CrawlerDatabase,
  candidateTariffId: number,
): Promise<{
  candidate: CandidateTariffRecord;
  documentSource: DocumentSourceRecord;
  charges: ChargeComponentRecord[];
  hasUnreconciledLaterCorrigendum: boolean;
}> {
  return db.withClient(async (client) => {
    const { rows: candidateRows } = await client.query(
      `SELECT ct.id, ct.document_id, ct.jurisdiction_code, ct.licensee_code, ct.category_code,
              ct.order_date, ct.effective_from, ct.raw_fields,
              sd.source_id AS document_source_id,
              s.licensee_code AS source_licensee_code, s.licensee_codes AS source_licensee_codes
       FROM candidate_tariffs ct
       JOIN source_documents sd ON sd.document_id = ct.document_id
       JOIN authoritative_sources s ON s.source_id = sd.source_id
       WHERE ct.id = $1`,
      [candidateTariffId],
    );
    if (candidateRows.length === 0) {
      throw new Error(`No candidate_tariffs row found for id=${candidateTariffId}`);
    }
    const row = candidateRows[0];
    const candidate: CandidateTariffRecord = {
      id: Number(row.id),
      documentId: row.document_id,
      jurisdictionCode: row.jurisdiction_code,
      licenseeCode: row.licensee_code,
      categoryCode: row.category_code,
      orderDate: row.order_date ? new Date(row.order_date).toISOString().slice(0, 10) : null,
      effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString().slice(0, 10) : null,
      rawFields: row.raw_fields ?? {},
    };
    const documentSource: DocumentSourceRecord = {
      documentSourceId: row.document_source_id,
      sourceLicenseeCode: row.source_licensee_code,
      sourceLicenseeCodes: row.source_licensee_codes,
    };

    const { rows: chargeRows } = await client.query(
      `SELECT cc.id, cc.candidate_tariff_id, cc.charge_type, cc.value, cc.unit,
              (SELECT count(*) FROM field_citations fc WHERE fc.candidate_charge_id = cc.id) AS citation_count
       FROM candidate_charge_components cc
       WHERE cc.candidate_tariff_id = $1`,
      [candidateTariffId],
    );
    const charges: ChargeComponentRecord[] = chargeRows.map((r) => ({
      id: Number(r.id),
      candidateTariffId: Number(r.candidate_tariff_id),
      chargeType: r.charge_type,
      value: r.value,
      unit: r.unit,
      citationCount: Number(r.citation_count),
    }));

    const { rows: corrigendumRows } = await client.query(
      `SELECT cr.id
       FROM classification_results cr
       JOIN source_documents sd2 ON sd2.document_id = cr.document_id
       WHERE sd2.source_id = $1
         AND cr.document_class = 'CORRIGENDUM'
         AND (
           $2::date IS NULL OR sd2.first_seen_at > (SELECT first_seen_at FROM source_documents WHERE document_id = $3)
         )
         AND NOT EXISTS (
           SELECT 1 FROM semantic_change_sets scs WHERE scs.candidate_tariff_id = $4
         )
       LIMIT 1`,
      [row.document_source_id, candidate.orderDate, candidate.documentId, candidateTariffId],
    );

    return { candidate, documentSource, charges, hasUnreconciledLaterCorrigendum: corrigendumRows.length > 0 };
  });
}
