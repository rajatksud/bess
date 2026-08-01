import type { CrawlerDatabase } from "../db/client.js";

export interface ReviewReportOptions {
  /** Filter to a single source document (e.g. one crawled tariff order PDF). */
  documentId?: string;
  /** Filter to a single candidate tariff row. */
  candidateId?: number;
}

interface CandidateRow {
  id: string;
  document_id: string;
  jurisdiction_code: string;
  licensee_code: string | null;
  category_code: string;
  category_name_original: string;
  consumer_class: string | null;
  supply_level: string | null;
  billing_energy_basis: string | null;
  billing_demand_basis: string | null;
  order_number: string | null;
  order_date: string | null;
  effective_from: string | null;
  status: string;
  confidence: string | null;
  extraction_attempt_id: string;
}

interface ChargeRow {
  id: string;
  candidate_tariff_id: string;
  charge_type: string;
  value: string;
  currency: string;
  unit: string;
  behaviour: string;
  verification_status: string;
}

interface CitationRow {
  candidate_tariff_id: string | null;
  candidate_charge_id: string | null;
  page_number: number | null;
  section_reference: string | null;
  extracted_text: string | null;
}

interface ValidationRow {
  candidate_tariff_id: string;
  validation_layer: string;
  severity: string;
  message: string;
}

interface DocumentRow {
  document_id: string;
  url: string | null;
  sha256: string;
  source_id: string;
}

/**
 * A structural flag independent of any single field's plausibility: a
 * category that has an ENERGY or DEMAND charge_type row but no ADDITIVE
 * (base-rate) row of that same type cannot be billed -- a REBATE or
 * surcharge with nothing to apply against is not a usable tariff record,
 * regardless of how confident the extractor was about the fragment it did
 * find. This is cheap to compute and catches exactly the class of bug a
 * human reviewer would otherwise have to notice by reading every row.
 */
export function findMissingBaseRateFlags(
  charges: Pick<ChargeRow, "charge_type" | "behaviour">[],
): string[] {
  const flags: string[] = [];
  for (const type of ["ENERGY", "DEMAND"] as const) {
    const ofType = charges.filter((c) => c.charge_type === type);
    if (ofType.length === 0) continue;
    const hasBase = ofType.some((c) => c.behaviour === "ADDITIVE");
    if (!hasBase) {
      const nonBase = ofType.map((c) => c.behaviour).join(", ");
      const article = type === "ENERGY" ? "An" : "A";
      flags.push(
        `No ADDITIVE (base-rate) ${type} charge found -- only ${nonBase} row(s) exist. ` +
          `${article} ${type.toLowerCase()} rebate/surcharge with no base rate to apply against is not billable.`,
      );
    }
  }
  return flags;
}

function fmtMoney(value: string, unit: string, behaviour: string): string {
  const sign = behaviour === "REBATE" ? "-" : "";
  const n = Number(value);
  return `${sign}${Math.abs(n).toFixed(4)} ${unit} (${behaviour})`;
}

/**
 * Generates a single self-contained Markdown report for one or more
 * candidate tariffs, intended to be read by a human outside the database --
 * opened in any editor/viewer, diffable between runs, greppable. Groups by
 * candidate, shows every charge with its citation and page number, and
 * surfaces structural red flags (missing base rate, duplicate candidates
 * for the same category) at the top of each candidate's section rather than
 * requiring the reader to notice them.
 */
export async function generateReviewReport(
  db: CrawlerDatabase,
  options: ReviewReportOptions = {},
): Promise<string> {
  return db.withClient(async (client) => {
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.documentId) {
      params.push(options.documentId);
      whereClauses.push(`document_id = $${params.length}`);
    }
    if (options.candidateId !== undefined) {
      params.push(options.candidateId);
      whereClauses.push(`id = $${params.length}`);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const { rows: candidates } = await client.query<CandidateRow>(
      `SELECT id, document_id, jurisdiction_code, licensee_code, category_code, category_name_original,
              consumer_class, supply_level, billing_energy_basis, billing_demand_basis,
              order_number, order_date, effective_from, status, confidence, extraction_attempt_id
       FROM candidate_tariffs ${where}
       ORDER BY jurisdiction_code, licensee_code, category_code, id`,
      params,
    );

    if (candidates.length === 0) {
      return "# Tariff Extraction Review Report\n\nNo candidate tariffs matched this filter.\n";
    }

    const candidateIds = candidates.map((c) => Number(c.id));
    const documentIds = [...new Set(candidates.map((c) => c.document_id))];

    const { rows: charges } = await client.query<ChargeRow>(
      `SELECT id, candidate_tariff_id, charge_type, value, currency, unit, behaviour, verification_status
       FROM candidate_charge_components
       WHERE candidate_tariff_id = ANY($1::bigint[])
       ORDER BY candidate_tariff_id, charge_type`,
      [candidateIds],
    );

    const { rows: citations } = await client.query<CitationRow>(
      `SELECT candidate_tariff_id, candidate_charge_id, page_number, section_reference, extracted_text
       FROM field_citations
       WHERE candidate_tariff_id = ANY($1::bigint[]) OR candidate_charge_id = ANY($2::bigint[])`,
      [candidateIds, charges.map((c) => Number(c.id))],
    );

    const { rows: validations } = await client.query<ValidationRow>(
      `SELECT candidate_tariff_id, validation_layer, severity, message
       FROM validation_results
       WHERE candidate_tariff_id = ANY($1::bigint[])
       ORDER BY candidate_tariff_id,
                CASE severity WHEN 'ERROR' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END`,
      [candidateIds],
    );

    const { rows: documents } = await client.query<DocumentRow>(
      `SELECT sd.document_id, sd.sha256, sd.source_id,
              (SELECT dua.url FROM document_url_aliases dua
               WHERE dua.document_id = sd.document_id
               ORDER BY dua.first_observed_at LIMIT 1) AS url
       FROM source_documents sd
       WHERE sd.document_id = ANY($1::text[])`,
      [documentIds],
    );

    const chargesByCandidate = groupBy(charges, (c) => c.candidate_tariff_id);
    const citationsByCandidate = groupBy(
      citations.filter((c) => c.candidate_tariff_id !== null),
      (c) => c.candidate_tariff_id as string,
    );
    const citationsByCharge = groupBy(
      citations.filter((c) => c.candidate_charge_id !== null),
      (c) => c.candidate_charge_id as string,
    );
    const validationsByCandidate = groupBy(validations, (v) => v.candidate_tariff_id);
    const documentsById = new Map(documents.map((d) => [d.document_id, d]));

    // Structural flag: multiple candidate rows for the exact same
    // (document, category) pair almost always indicates a re-run or a
    // per-year extraction bug rather than genuinely distinct tariffs, and
    // is easy to miss when scrolling through 60 rows in a SQL client.
    const categoryKeyCounts = new Map<string, number>();
    for (const c of candidates) {
      const key = `${c.document_id}::${c.category_code}`;
      categoryKeyCounts.set(key, (categoryKeyCounts.get(key) ?? 0) + 1);
    }

    const lines: string[] = [];
    lines.push("# Tariff Extraction Review Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Candidates: ${candidates.length}`);
    lines.push("");

    const flaggedCount = candidates.filter(
      (c) => findMissingBaseRateFlags(chargesByCandidate.get(c.id) ?? []).length > 0,
    ).length;
    const dupeCount = candidates.filter(
      (c) => (categoryKeyCounts.get(`${c.document_id}::${c.category_code}`) ?? 0) > 1,
    ).length;

    lines.push("## Summary");
    lines.push("");
    lines.push(`- ${candidates.length} candidate(s) in this report`);
    lines.push(`- ${flaggedCount} candidate(s) flagged: missing base-rate charge for ENERGY or DEMAND`);
    lines.push(`- ${dupeCount} candidate(s) share a (document, category) key with another candidate (possible duplicate extraction)`);
    lines.push(
      `- ${validations.filter((v) => v.severity === "ERROR").length} ERROR-severity validation finding(s), ` +
        `${validations.filter((v) => v.severity === "WARNING").length} WARNING-severity`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const c of candidates) {
      const charges = chargesByCandidate.get(c.id) ?? [];
      const missingBaseRateFlags = findMissingBaseRateFlags(charges);
      const dupeKey = `${c.document_id}::${c.category_code}`;
      const isDupe = (categoryKeyCounts.get(dupeKey) ?? 0) > 1;
      const doc = documentsById.get(c.document_id);
      const findings = validationsByCandidate.get(c.id) ?? [];

      lines.push(`## Candidate #${c.id} -- ${c.category_code}: ${c.category_name_original}`);
      lines.push("");
      if (missingBaseRateFlags.length > 0 || isDupe) {
        lines.push("**FLAGS:**");
        for (const f of missingBaseRateFlags) lines.push(`- ${f}`);
        if (isDupe) {
          lines.push(
            `- Duplicate: ${categoryKeyCounts.get(dupeKey)} candidates exist for this same document+category ` +
              `(check whether this is a genuine multi-year/multi-attempt split or a re-run bug).`,
          );
        }
        lines.push("");
      }

      lines.push(
        `- Status: \`${c.status}\` | Confidence: ${c.confidence ?? "n/a"} | ` +
          `Jurisdiction: ${c.jurisdiction_code} | Licensee: ${c.licensee_code ?? "n/a"}`,
      );
      lines.push(
        `- Consumer class: ${c.consumer_class ?? "n/a"} | Supply level: ${c.supply_level ?? "n/a"} | ` +
          `Energy basis: ${c.billing_energy_basis ?? "n/a"} | Demand basis: ${c.billing_demand_basis ?? "n/a"}`,
      );
      lines.push(
        `- Order number: ${c.order_number ?? "n/a"} | Order date: ${c.order_date ?? "n/a"} | ` +
          `Effective from: ${c.effective_from ?? "n/a"}`,
      );
      if (doc) {
        lines.push(`- Source document: \`${doc.document_id}\` (source_id=${doc.source_id}, sha256=${doc.sha256.slice(0, 16)}...)`);
        if (doc.url) lines.push(`  ${doc.url}`);
      }
      lines.push("");

      if (charges.length === 0) {
        lines.push("_No charge components extracted for this candidate._");
        lines.push("");
      } else {
        lines.push("| Charge type | Value | Verification |");
        lines.push("|---|---|---|");
        for (const charge of charges) {
          lines.push(
            `| ${charge.charge_type} | ${fmtMoney(charge.value, charge.unit, charge.behaviour)} | ${charge.verification_status} |`,
          );
        }
        lines.push("");

        for (const charge of charges) {
          const chargeCitations = citationsByCharge.get(charge.id) ?? [];
          for (const cit of chargeCitations) {
            lines.push(
              `> **${charge.charge_type}** (page ${cit.page_number ?? "?"}${cit.section_reference ? `, ${cit.section_reference}` : ""}): ` +
                `"${(cit.extracted_text ?? "").trim()}"`,
            );
            lines.push("");
          }
        }
      }

      const candidateCitations = citationsByCandidate.get(c.id) ?? [];
      for (const cit of candidateCitations) {
        lines.push(
          `> **Category-level** (page ${cit.page_number ?? "?"}${cit.section_reference ? `, ${cit.section_reference}` : ""}): ` +
            `"${(cit.extracted_text ?? "").trim()}"`,
        );
        lines.push("");
      }

      if (findings.length > 0) {
        lines.push("**Validation findings:**");
        for (const f of findings) {
          lines.push(`- \`${f.severity}\` [${f.validation_layer}] ${f.message}`);
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  });
}

function groupBy<T, K extends string>(rows: T[], keyFn: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = map.get(key);
    if (existing) existing.push(row);
    else map.set(key, [row]);
  }
  return map;
}
