import type { CrawlerDatabase } from "../db/client.js";
import { diffTariff } from "./diffTariff.js";
import type { DiffTariff, SemanticChangeRow } from "./diffTariff.js";

export interface SemanticDiffRunResult {
  candidateTariffId: number;
  baselineTariffId: number | null;
  changes: SemanticChangeRow[];
}

/**
 * Loads a candidate_tariffs row and its most recent approved baseline for
 * the same jurisdiction/licensee/category (crawler architecture section 12),
 * runs diffTariff, and persists one semantic_change_sets row per detected
 * change. Idempotent: reruns for the same candidate first delete any
 * previously recorded rows for that candidate_tariff_id, so this can be
 * safely re-invoked after a candidate is re-extracted (matches the "crawl-run
 * and extraction operations must be idempotent" requirement in the strategy
 * doc's database design requirements).
 *
 * The baseline is the latest EFFECTIVE or PUBLISHED candidate_tariffs row
 * for the same (jurisdiction_code, licensee_code, category_code) tuple --
 * not necessarily predecessor_candidate_id, which only tracks same-document
 * lineage and may be null for a document that introduces a category for the
 * first time via a different source document than its true commercial
 * predecessor.
 *
 * Deliberately reads only candidate_tariffs.status, never the tables that
 * belong exclusively to the human-reviewer promotion step (see
 * tests/noAutoApproval.test.ts, which enforces that this pipeline's source
 * files must never reference those table names, even read-only): this
 * module runs as part of the automated crawl -> classify -> extract ->
 * validate pipeline, and a row only reaches PUBLISHED/EFFECTIVE via that
 * separate human-reviewed path in the first place, so filtering on
 * candidate_tariffs.status gives the same answer without this pipeline
 * stage crossing into the boundary it is not allowed to touch.
 */
export async function runSemanticDiff(db: CrawlerDatabase, candidateTariffId: number): Promise<SemanticDiffRunResult> {
  const candidate = await loadDiffTariff(db, candidateTariffId);
  if (!candidate) {
    throw new Error(`No candidate_tariffs row found for id=${candidateTariffId}`);
  }

  const baselineId = await findBaselineApprovedTariffId(db, candidate);
  const baseline = baselineId ? await loadDiffTariff(db, baselineId) : null;

  const changes = diffTariff(candidate, baseline);

  await db.withTransaction(async (client) => {
    await client.query(`DELETE FROM semantic_change_sets WHERE candidate_tariff_id = $1`, [candidateTariffId]);
    for (const change of changes) {
      await client.query(
        `INSERT INTO semantic_change_sets
           (candidate_tariff_id, baseline_tariff_id, change_kind, summary, before_value, after_value, commercial_impact)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          candidateTariffId,
          baselineId,
          change.changeKind,
          change.summary,
          change.beforeValue === null ? null : JSON.stringify(change.beforeValue),
          change.afterValue === null ? null : JSON.stringify(change.afterValue),
          change.commercialImpact,
        ],
      );
    }
  });

  return { candidateTariffId, baselineTariffId: baselineId, changes };
}

async function loadDiffTariff(db: CrawlerDatabase, candidateTariffId: number): Promise<DiffTariff | null> {
  return db.withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT jurisdiction_code, licensee_code, category_code, billing_energy_basis, billing_demand_basis,
              effective_from, order_date
       FROM candidate_tariffs
       WHERE id = $1`,
      [candidateTariffId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];

    const { rows: chargeRows } = await client.query(
      `SELECT charge_type, value, unit FROM candidate_charge_components WHERE candidate_tariff_id = $1`,
      [candidateTariffId],
    );

    return {
      jurisdictionCode: row.jurisdiction_code,
      licenseeCode: row.licensee_code,
      categoryCode: row.category_code,
      billingEnergyBasis: row.billing_energy_basis,
      billingDemandBasis: row.billing_demand_basis,
      effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString().slice(0, 10) : null,
      orderDate: row.order_date ? new Date(row.order_date).toISOString().slice(0, 10) : null,
      charges: chargeRows.map((r) => ({ chargeType: r.charge_type, value: String(r.value), unit: r.unit })),
    };
  });
}

/**
 * Finds the most recently effective PUBLISHED/EFFECTIVE candidate_tariffs
 * row for the same jurisdiction/licensee/category as the candidate -- see
 * the module-level doc comment above for why this queries candidate_tariffs
 * directly rather than the table reserved for the human-reviewer promotion
 * step. Returns null if this is the first-ever published tariff for that
 * tuple.
 */
async function findBaselineApprovedTariffId(db: CrawlerDatabase, candidate: DiffTariff): Promise<number | null> {
  if (!candidate.jurisdictionCode || !candidate.licenseeCode || !candidate.categoryCode) {
    return null; // cannot resolve a baseline without a full identity key
  }
  return db.withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT id
       FROM candidate_tariffs
       WHERE jurisdiction_code = $1 AND licensee_code = $2 AND category_code = $3
         AND status IN ('PUBLISHED', 'EFFECTIVE')
       ORDER BY effective_from DESC
       LIMIT 1`,
      [candidate.jurisdictionCode, candidate.licenseeCode, candidate.categoryCode],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  });
}
