import { createHash } from "node:crypto";
import type { CrawlerDatabase } from "../db/client.js";

/**
 * Release compiler (strategy doc section 7 "Release compilation should
 * generate: canonical JSON..."; section 8.4 "Publication"; section 10 "BESS
 * consumption contract"). This is the one place in the codebase that is
 * *meant* to read the human-reviewer promotion tables
 * (approved_tariffs/review_decisions) -- unlike everything under
 * src/{validation,semanticDiff,extraction,classifier}.ts and crawl.ts, which
 * tests/noAutoApproval.test.ts forbids from referencing those tables even
 * read-only, because this module runs strictly *after* a human has already
 * recorded an approval decision; it never writes to approved_tariffs itself,
 * only reads what a human already put there and freezes it into an
 * immutable, versioned artifact. See tests/noAutoApproval.test.ts's
 * ALLOWED_APPROVAL_READER_FILES for the corresponding narrow exception.
 *
 * The BESS calculator never talks to this database directly (strategy doc
 * section 10: "The BESS platform must not scrape source websites during a
 * calculation... It should consume an approved release pinned by version and
 * checksum") -- this compiler is what produces that pinned artifact.
 */

export interface CompiledCharge {
  chargeId: string;
  type: string;
  value: string;
  currency: string;
  unit: string;
  behaviour: string;
}

export interface CompiledTariff {
  tariffId: string;
  jurisdictionCode: string;
  licenseeCode: string | null;
  categoryCode: string;
  categoryName: string;
  consumerClass: string | null;
  supplyLevel: string | null;
  billingEnergyBasis: string | null;
  billingDemandBasis: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  confidenceGrade: string;
  charges: CompiledCharge[];
}

export interface ReleaseManifest {
  dataset: "india-tariffs";
  version: string;
  schemaVersion: string;
  publishedAt: string;
  sha256: string;
  jurisdictionsCovered: string[];
  tariffCount: number;
  supersededRelease: string | null;
}

export interface CompiledRelease {
  manifest: ReleaseManifest;
  tariffs: CompiledTariff[];
}

const RELEASE_SCHEMA_VERSION = "1.0.0";

/**
 * Compiles every currently-effective approved tariff (superseded_by_tariff_id
 * IS NULL) into one immutable, versioned release: a canonical JSON document
 * whose sha256 becomes the pinned checksum a BESS calculation locks to
 * (strategy doc section 10's lock record). Persists the manifest (not the
 * full tariff bodies -- those remain queryable from candidate_tariffs/
 * candidate_charge_components by tariffId) to dataset_releases, and links
 * supersededRelease to the immediately prior release row, if any, so release
 * history is itself traceable.
 *
 * `version` must be caller-supplied (e.g. a date-based scheme like
 * "2026.07.0" from the strategy doc's own example) rather than inferred,
 * since choosing a release-numbering policy is a product decision this
 * function should not make silently.
 */
export async function compileRelease(db: CrawlerDatabase, version: string): Promise<CompiledRelease> {
  const tariffs = await loadApprovedTariffs(db);

  const jurisdictionsCovered = [...new Set(tariffs.map((t) => t.jurisdictionCode))].sort();
  const canonicalBody = canonicalize({ schemaVersion: RELEASE_SCHEMA_VERSION, tariffs });
  const sha256 = createHash("sha256").update(canonicalBody).digest("hex");

  const supersededRelease = await findLatestReleaseVersion(db);

  const manifest: ReleaseManifest = {
    dataset: "india-tariffs",
    version,
    schemaVersion: RELEASE_SCHEMA_VERSION,
    publishedAt: new Date().toISOString(),
    sha256,
    jurisdictionsCovered,
    tariffCount: tariffs.length,
    supersededRelease,
  };

  await persistRelease(db, manifest, supersededRelease);

  return { manifest, tariffs };
}

async function loadApprovedTariffs(db: CrawlerDatabase): Promise<CompiledTariff[]> {
  return db.withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT
         at.id AS approved_id,
         at.confidence_grade,
         at.effective_from AS approved_effective_from,
         at.effective_to AS approved_effective_to,
         ct.id AS candidate_id,
         ct.jurisdiction_code,
         ct.licensee_code,
         ct.category_code,
         ct.category_name_original,
         ct.consumer_class,
         ct.supply_level,
         ct.billing_energy_basis,
         ct.billing_demand_basis
       FROM approved_tariffs at
       JOIN candidate_tariffs ct ON ct.id = at.candidate_tariff_id
       WHERE at.superseded_by_tariff_id IS NULL
       ORDER BY ct.jurisdiction_code, ct.licensee_code, ct.category_code`,
    );

    const tariffs: CompiledTariff[] = [];
    for (const row of rows) {
      const charges = await loadCharges(db, Number(row.candidate_id));
      tariffs.push({
        tariffId: `${row.jurisdiction_code}-${row.licensee_code ?? "NA"}-${row.category_code}-${toIsoDate(row.approved_effective_from)}`,
        jurisdictionCode: row.jurisdiction_code,
        licenseeCode: row.licensee_code,
        categoryCode: row.category_code,
        categoryName: row.category_name_original,
        consumerClass: row.consumer_class,
        supplyLevel: row.supply_level,
        billingEnergyBasis: row.billing_energy_basis,
        billingDemandBasis: row.billing_demand_basis,
        effectiveFrom: toIsoDate(row.approved_effective_from)!,
        effectiveTo: toIsoDate(row.approved_effective_to),
        confidenceGrade: row.confidence_grade,
        charges,
      });
    }
    return tariffs;
  });
}

async function loadCharges(db: CrawlerDatabase, candidateTariffId: number): Promise<CompiledCharge[]> {
  return db.withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT charge_id, charge_type, value, currency, unit, behaviour
       FROM candidate_charge_components
       WHERE candidate_tariff_id = $1
       ORDER BY charge_id`,
      [candidateTariffId],
    );
    return rows.map((r) => ({
      chargeId: r.charge_id,
      type: r.charge_type,
      value: String(r.value),
      currency: r.currency,
      unit: r.unit,
      behaviour: r.behaviour,
    }));
  });
}

async function findLatestReleaseVersion(db: CrawlerDatabase): Promise<string | null> {
  return db.withClient(async (client) => {
    const { rows } = await client.query(`SELECT version FROM dataset_releases ORDER BY published_at DESC LIMIT 1`);
    return rows.length > 0 ? (rows[0].version as string) : null;
  });
}

/**
 * Inserts the new release row with superseded_release_id pointing at the
 * prior release (if any) -- that single foreign key is the entire
 * supersession link; the prior row itself needs no update.
 */
async function persistRelease(db: CrawlerDatabase, manifest: ReleaseManifest, supersededVersion: string | null): Promise<void> {
  await db.withTransaction(async (client) => {
    let supersededId: number | null = null;
    if (supersededVersion) {
      const { rows } = await client.query(`SELECT id FROM dataset_releases WHERE version = $1`, [supersededVersion]);
      supersededId = rows.length > 0 ? Number(rows[0].id) : null;
    }

    await client.query(
      `INSERT INTO dataset_releases (version, schema_version, sha256, jurisdictions_covered, superseded_release_id, manifest)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        manifest.version,
        manifest.schemaVersion,
        manifest.sha256,
        manifest.jurisdictionsCovered,
        supersededId,
        JSON.stringify(manifest),
      ],
    );
  });
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  return new Date(value as string).toISOString().slice(0, 10);
}

/**
 * Deterministic JSON serialization (keys sorted recursively) so the same set
 * of approved tariffs always hashes identically regardless of query row
 * order or object-key insertion order -- required for sha256 to be a
 * meaningful, reproducible content identity rather than an artifact of one
 * particular run.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
