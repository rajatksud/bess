import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import type { CrawlerDatabase } from "./client.js";

interface JurisdictionYaml {
  code: string;
  name: string;
  type: "STATE" | "UNION_TERRITORY";
  status: "NOT_STARTED" | "IN_PROGRESS" | "COVERED" | "BLOCKED";
  last_verified?: string;
  notes?: string;
}

interface RegulatorYaml {
  code: string;
  name: string;
  short_name?: string;
  type: "SERC" | "JERC" | "CENTRAL";
  jurisdiction_codes: string[];
  website?: string;
  order_portal_url?: string;
  schedule_portal_url?: string;
  active?: boolean;
  evidence_url?: string;
  last_verified?: string;
  source_health?: string;
  notes?: string;
}

interface LicenseeYaml {
  code: string;
  name: string;
  common_name?: string;
  regulator_code: string;
  jurisdiction_code: string;
  licensee_type: "STATE_UTILITY" | "PRIVATE_DISCOM" | "MUNICIPAL" | "DEEMED_LICENSEE" | "SPECIAL_AREA" | "OTHER";
  coverage_tier?: "TIER_A" | "TIER_B" | "TIER_C";
  ownership_type?: string;
  c_and_i_relevance?: string;
  service_territory?: string;
  website?: string;
  status?: "ACTIVE" | "INACTIVE" | "UNCERTAIN" | "UNKNOWN";
  shares_schedule_with?: string;
  shared_tariff_group_id?: string | null;
  predecessor_licensee_ids?: string[];
  successor_licensee_ids?: string[];
  overlap_licensee_ids?: string[];
  parent_licensee_id?: string | null;
  coverage_status?: "NOT_STARTED" | "IN_PROGRESS" | "COVERED" | "BLOCKED";
  verification_status?: string;
  confidence?: string;
  last_verified?: string;
  evidence_url?: string;
  authoritative_source_ids?: string[];
  notes?: string;
}

interface SourceYaml {
  source_id: string;
  jurisdiction_code?: string;
  regulator_code?: string;
  licensee_code?: string;
  licensee_codes?: string[];
  url: string;
  source_type: string;
  authority_rank: number;
  monitoring_status: string;
  allowed_domains: string[];
  discovery_method: string;
  adapter: string;
  acquisition_mode?: "HTTP" | "FIRECRAWL" | "AUTO";
  schedule?: string;
  rate_limit_requests_per_minute?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
  permitted_content_types?: string[];
  owner?: string;
  last_verified?: string;
  source_health?: string;
  last_live_check_at?: string;
  notes?: string;
}

interface SharedTariffGroupYaml {
  group_id: string;
  name: string;
  regulator_code: string;
  jurisdiction_codes?: string[];
  licensee_codes: string[];
  basis?: string;
  authoritative_source_ids?: string[];
  notes?: string;
}

interface ReviewQueueEntryYaml {
  review_id: string;
  candidate_name: string;
  jurisdiction_code?: string;
  related_licensee_code?: string;
  reason: string;
  evidence_checked?: string;
  suggested_next_step?: string;
  status?: "OPEN" | "RESOLVED" | "DISMISSED";
}

export interface RegistryLoadResult {
  jurisdictions: number;
  regulators: number;
  regulatorJurisdictionLinks: number;
  licensees: number;
  sources: number;
  sharedTariffGroups: number;
  reviewQueueEntries: number;
}

/**
 * Loads the human-reviewed YAML registry into Postgres using idempotent
 * upserts (ON CONFLICT DO UPDATE keyed on each entity's natural stable code).
 * Safe to run repeatedly — re-running with an unchanged YAML file produces no
 * row-level changes beyond updated_at bookkeeping handled by the DB trigger.
 * This is the only writer of jurisdictions/regulators/licensees/sources:
 * registry data always originates from the reviewed YAML files, never from
 * crawler discovery.
 */
export async function loadRegistryIntoDatabase(
  db: CrawlerDatabase,
  paths: {
    jurisdictions: string;
    regulators: string;
    licensees: string;
    sources: string;
    sharedTariffGroups?: string;
    reviewQueue?: string;
  },
): Promise<RegistryLoadResult> {
  await db.verifyEnvironmentMarker();

  const jurisdictions = (load(readFileSync(paths.jurisdictions, "utf8")) as { jurisdictions: JurisdictionYaml[] })
    .jurisdictions;
  const regulators = (load(readFileSync(paths.regulators, "utf8")) as { regulators: RegulatorYaml[] }).regulators;
  const licensees = (load(readFileSync(paths.licensees, "utf8")) as { licensees: LicenseeYaml[] }).licensees;
  const sources = (load(readFileSync(paths.sources, "utf8")) as { sources: SourceYaml[] }).sources;
  const sharedTariffGroups = paths.sharedTariffGroups
    ? (load(readFileSync(paths.sharedTariffGroups, "utf8")) as { shared_tariff_groups: SharedTariffGroupYaml[] })
        .shared_tariff_groups
    : [];
  const reviewQueueEntries = paths.reviewQueue
    ? (load(readFileSync(paths.reviewQueue, "utf8")) as { licensee_review_queue: ReviewQueueEntryYaml[] })
        .licensee_review_queue
    : [];

  let regulatorJurisdictionLinks = 0;

  await db.withTransaction(async (client) => {
    for (const j of jurisdictions) {
      await client.query(
        `INSERT INTO jurisdictions (code, name, jurisdiction_type, coverage_status, last_verified_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           jurisdiction_type = EXCLUDED.jurisdiction_type,
           coverage_status = EXCLUDED.coverage_status,
           last_verified_at = EXCLUDED.last_verified_at,
           notes = EXCLUDED.notes`,
        [j.code, j.name, j.type, j.status, j.last_verified ?? null, j.notes ?? null],
      );
    }

    for (const r of regulators) {
      await client.query(
        `INSERT INTO regulators (code, legal_name, short_name, regulator_type, website, order_portal_url,
                                  schedule_portal_url, active, evidence_url, last_verified_at, source_health, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (code) DO UPDATE SET
           legal_name = EXCLUDED.legal_name,
           short_name = EXCLUDED.short_name,
           regulator_type = EXCLUDED.regulator_type,
           website = EXCLUDED.website,
           order_portal_url = EXCLUDED.order_portal_url,
           schedule_portal_url = EXCLUDED.schedule_portal_url,
           active = EXCLUDED.active,
           evidence_url = EXCLUDED.evidence_url,
           last_verified_at = EXCLUDED.last_verified_at,
           source_health = EXCLUDED.source_health,
           notes = EXCLUDED.notes`,
        [
          r.code,
          r.name,
          r.short_name ?? null,
          r.type,
          r.website ?? null,
          r.order_portal_url ?? null,
          r.schedule_portal_url ?? null,
          r.active ?? true,
          r.evidence_url ?? null,
          r.last_verified ?? null,
          r.source_health ?? "NOT_CHECKED",
          r.notes ?? null,
        ],
      );

      await client.query("DELETE FROM regulator_jurisdictions WHERE regulator_code = $1", [r.code]);
      for (const jc of r.jurisdiction_codes) {
        await client.query(
          `INSERT INTO regulator_jurisdictions (regulator_code, jurisdiction_code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [r.code, jc],
        );
        regulatorJurisdictionLinks++;
      }
    }

    // Reconcile: remove any regulator row whose code is no longer present in
    // regulators.yaml (e.g. a code rename such as TSERC -> TGERC). registry
    // YAML is the sole source of truth for this table (see function
    // docstring), so a code's absence here means it was intentionally
    // renamed or retired, not merely "not yet re-loaded". This intentionally
    // has no ON DELETE CASCADE anywhere upstream: if a stale code is still
    // referenced by a licensee or source, this DELETE fails loudly on the
    // foreign key rather than silently orphaning or cascading, which is the
    // desired behavior -- it surfaces a YAML inconsistency (a rename applied
    // to regulators.yaml but not propagated to every referencing licensee/
    // source) as a load-time error instead of leaving mismatched data.
    {
      const currentCodes = regulators.map((r) => r.code);
      await client.query(
        `DELETE FROM regulators WHERE code <> ALL($1::text[])`,
        [currentCodes],
      );
    }

    // Pass 1: upsert licensees without self-referential FKs (shares_schedule_with,
    // parent_licensee_id, shared_tariff_group_id) so insert order never trips a
    // not-yet-loaded reference (e.g. a licensee whose shares_schedule_with
    // target appears later in the YAML file); pass 2 below fills those in
    // once every code exists.
    for (const l of licensees) {
      await client.query(
        `INSERT INTO licensees (code, legal_name, common_name, jurisdiction_code, regulator_code, licensee_type,
                                 coverage_tier, ownership_type, c_and_i_relevance, service_territory, website,
                                 status, predecessor_licensee_ids, successor_licensee_ids,
                                 overlap_licensee_ids, coverage_status, verification_status, confidence,
                                 last_verified_at, evidence_url, authoritative_source_ids, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (code) DO UPDATE SET
           legal_name = EXCLUDED.legal_name,
           common_name = EXCLUDED.common_name,
           jurisdiction_code = EXCLUDED.jurisdiction_code,
           regulator_code = EXCLUDED.regulator_code,
           licensee_type = EXCLUDED.licensee_type,
           coverage_tier = EXCLUDED.coverage_tier,
           ownership_type = EXCLUDED.ownership_type,
           c_and_i_relevance = EXCLUDED.c_and_i_relevance,
           service_territory = EXCLUDED.service_territory,
           website = EXCLUDED.website,
           status = EXCLUDED.status,
           predecessor_licensee_ids = EXCLUDED.predecessor_licensee_ids,
           successor_licensee_ids = EXCLUDED.successor_licensee_ids,
           overlap_licensee_ids = EXCLUDED.overlap_licensee_ids,
           coverage_status = EXCLUDED.coverage_status,
           verification_status = EXCLUDED.verification_status,
           confidence = EXCLUDED.confidence,
           last_verified_at = EXCLUDED.last_verified_at,
           evidence_url = EXCLUDED.evidence_url,
           authoritative_source_ids = EXCLUDED.authoritative_source_ids,
           notes = EXCLUDED.notes`,
        [
          l.code,
          l.name,
          l.common_name ?? null,
          l.jurisdiction_code,
          l.regulator_code,
          l.licensee_type,
          l.coverage_tier ?? "TIER_A",
          l.ownership_type ?? "UNKNOWN",
          l.c_and_i_relevance ?? "MEDIUM",
          l.service_territory ?? null,
          l.website ?? null,
          l.status ?? "UNCERTAIN",
          l.predecessor_licensee_ids ?? [],
          l.successor_licensee_ids ?? [],
          l.overlap_licensee_ids ?? [],
          l.coverage_status ?? "NOT_STARTED",
          l.verification_status ?? "UNVERIFIED",
          l.confidence ?? null,
          l.last_verified ?? null,
          l.evidence_url ?? null,
          l.authoritative_source_ids ?? [],
          l.notes ?? null,
        ],
      );
    }

    // Pass 2: self-referential FKs (shares_schedule_with, parent_licensee_id).
    // shared_tariff_group_id is set after shared_tariff_groups are loaded,
    // further below.
    for (const l of licensees) {
      await client.query(
        `UPDATE licensees SET shares_schedule_with = $2, parent_licensee_id = $3 WHERE code = $1`,
        [l.code, l.shares_schedule_with ?? null, l.parent_licensee_id ?? null],
      );
    }

    for (const s of sources) {
      const licenseeCodes = s.licensee_codes ?? (s.licensee_code ? [s.licensee_code] : []);
      await client.query(
        `INSERT INTO authoritative_sources (
           source_id, jurisdiction_code, regulator_code, licensee_code, licensee_codes, url, allowed_domains,
           source_type, authority_rank, discovery_method, adapter, acquisition_mode, schedule, rate_limit_per_minute,
           include_patterns, exclude_patterns, permitted_content_types, owner, monitoring_status,
           last_verified_at, source_health, last_live_check_at, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (source_id) DO UPDATE SET
           jurisdiction_code = EXCLUDED.jurisdiction_code,
           regulator_code = EXCLUDED.regulator_code,
           licensee_code = EXCLUDED.licensee_code,
           licensee_codes = EXCLUDED.licensee_codes,
           url = EXCLUDED.url,
           allowed_domains = EXCLUDED.allowed_domains,
           source_type = EXCLUDED.source_type,
           authority_rank = EXCLUDED.authority_rank,
           discovery_method = EXCLUDED.discovery_method,
           adapter = EXCLUDED.adapter,
           acquisition_mode = EXCLUDED.acquisition_mode,
           schedule = EXCLUDED.schedule,
           rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
           include_patterns = EXCLUDED.include_patterns,
           exclude_patterns = EXCLUDED.exclude_patterns,
           permitted_content_types = EXCLUDED.permitted_content_types,
           owner = EXCLUDED.owner,
           monitoring_status = EXCLUDED.monitoring_status,
           last_verified_at = EXCLUDED.last_verified_at,
           source_health = EXCLUDED.source_health,
           last_live_check_at = EXCLUDED.last_live_check_at,
           notes = EXCLUDED.notes`,
        [
          s.source_id,
          s.jurisdiction_code ?? null,
          s.regulator_code ?? null,
          s.licensee_code ?? null,
          licenseeCodes,
          s.url,
          s.allowed_domains,
          s.source_type,
          s.authority_rank,
          s.discovery_method,
          s.adapter,
          s.acquisition_mode ?? "AUTO",
          s.schedule ?? "DAILY",
          s.rate_limit_requests_per_minute ?? 6,
          s.include_patterns ?? [],
          s.exclude_patterns ?? [],
          s.permitted_content_types ?? ["text/html", "application/pdf"],
          s.owner ?? null,
          s.monitoring_status,
          s.last_verified ?? null,
          s.source_health ?? "NOT_CHECKED",
          s.last_live_check_at ?? null,
          s.notes ?? null,
        ],
      );

      await client.query(
        `INSERT INTO crawl_schedules (source_id, cadence)
         VALUES ($1, $2)
         ON CONFLICT (source_id) DO UPDATE SET cadence = EXCLUDED.cadence`,
        [s.source_id, s.schedule ?? "DAILY"],
      );
    }

    for (const g of sharedTariffGroups) {
      await client.query(
        `INSERT INTO shared_tariff_groups (group_id, name, regulator_code, basis, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (group_id) DO UPDATE SET
           name = EXCLUDED.name,
           regulator_code = EXCLUDED.regulator_code,
           basis = EXCLUDED.basis,
           notes = EXCLUDED.notes`,
        [g.group_id, g.name, g.regulator_code, g.basis ?? null, g.notes ?? null],
      );

      await client.query("DELETE FROM shared_tariff_group_jurisdictions WHERE group_id = $1", [g.group_id]);
      for (const jc of g.jurisdiction_codes ?? []) {
        await client.query(
          `INSERT INTO shared_tariff_group_jurisdictions (group_id, jurisdiction_code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [g.group_id, jc],
        );
      }

      await client.query("DELETE FROM shared_tariff_group_licensees WHERE group_id = $1", [g.group_id]);
      for (const lc of g.licensee_codes) {
        await client.query(
          `INSERT INTO shared_tariff_group_licensees (group_id, licensee_code) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [g.group_id, lc],
        );
      }

      await client.query("DELETE FROM shared_tariff_group_sources WHERE group_id = $1", [g.group_id]);
      for (const sid of g.authoritative_source_ids ?? []) {
        await client.query(
          `INSERT INTO shared_tariff_group_sources (group_id, source_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [g.group_id, sid],
        );
      }
    }

    for (const l of licensees) {
      if (l.shared_tariff_group_id) {
        await client.query(`UPDATE licensees SET shared_tariff_group_id = $2 WHERE code = $1`, [
          l.code,
          l.shared_tariff_group_id,
        ]);
      }
    }

    for (const rq of reviewQueueEntries) {
      await client.query(
        `INSERT INTO licensee_review_queue (
           review_id, candidate_name, jurisdiction_code, reason, evidence_checked,
           suggested_next_step, related_licensee_code, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (review_id) DO UPDATE SET
           candidate_name = EXCLUDED.candidate_name,
           jurisdiction_code = EXCLUDED.jurisdiction_code,
           reason = EXCLUDED.reason,
           evidence_checked = EXCLUDED.evidence_checked,
           suggested_next_step = EXCLUDED.suggested_next_step,
           related_licensee_code = EXCLUDED.related_licensee_code,
           status = EXCLUDED.status`,
        [
          rq.review_id,
          rq.candidate_name,
          rq.jurisdiction_code ?? null,
          rq.reason,
          rq.evidence_checked ?? null,
          rq.suggested_next_step ?? null,
          rq.related_licensee_code ?? null,
          rq.status ?? "OPEN",
        ],
      );
    }
  });

  return {
    jurisdictions: jurisdictions.length,
    regulators: regulators.length,
    regulatorJurisdictionLinks,
    licensees: licensees.length,
    sources: sources.length,
    reviewQueueEntries: reviewQueueEntries.length,
    sharedTariffGroups: sharedTariffGroups.length,
  };
}
