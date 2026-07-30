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

export interface RegistryLoadResult {
  jurisdictions: number;
  regulators: number;
  regulatorJurisdictionLinks: number;
  licensees: number;
  sources: number;
  sharedTariffGroups: number;
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
  },
): Promise<RegistryLoadResult> {
  await db.ensureEnvironmentMarker();

  const jurisdictions = (load(readFileSync(paths.jurisdictions, "utf8")) as { jurisdictions: JurisdictionYaml[] })
    .jurisdictions;
  const regulators = (load(readFileSync(paths.regulators, "utf8")) as { regulators: RegulatorYaml[] }).regulators;
  const licensees = (load(readFileSync(paths.licensees, "utf8")) as { licensees: LicenseeYaml[] }).licensees;
  const sources = (load(readFileSync(paths.sources, "utf8")) as { sources: SourceYaml[] }).sources;
  const sharedTariffGroups = paths.sharedTariffGroups
    ? (load(readFileSync(paths.sharedTariffGroups, "utf8")) as { shared_tariff_groups: SharedTariffGroupYaml[] })
        .shared_tariff_groups
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
        `INSERT INTO regulators (code, legal_name, short_name, regulator_type, website, order_portal_url, active, last_verified_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (code) DO UPDATE SET
           legal_name = EXCLUDED.legal_name,
           short_name = EXCLUDED.short_name,
           regulator_type = EXCLUDED.regulator_type,
           website = EXCLUDED.website,
           order_portal_url = EXCLUDED.order_portal_url,
           active = EXCLUDED.active,
           last_verified_at = EXCLUDED.last_verified_at,
           notes = EXCLUDED.notes`,
        [
          r.code,
          r.name,
          r.short_name ?? null,
          r.type,
          r.website ?? null,
          r.order_portal_url ?? null,
          r.active ?? true,
          r.last_verified ?? null,
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

    for (const l of licensees) {
      await client.query(
        `INSERT INTO licensees (code, legal_name, common_name, jurisdiction_code, regulator_code, licensee_type,
                                 service_territory, website, status, shares_schedule_with, coverage_status,
                                 last_verified_at, evidence_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (code) DO UPDATE SET
           legal_name = EXCLUDED.legal_name,
           common_name = EXCLUDED.common_name,
           jurisdiction_code = EXCLUDED.jurisdiction_code,
           regulator_code = EXCLUDED.regulator_code,
           licensee_type = EXCLUDED.licensee_type,
           service_territory = EXCLUDED.service_territory,
           website = EXCLUDED.website,
           status = EXCLUDED.status,
           shares_schedule_with = EXCLUDED.shares_schedule_with,
           coverage_status = EXCLUDED.coverage_status,
           last_verified_at = EXCLUDED.last_verified_at,
           evidence_url = EXCLUDED.evidence_url,
           notes = EXCLUDED.notes`,
        [
          l.code,
          l.name,
          l.common_name ?? null,
          l.jurisdiction_code,
          l.regulator_code,
          l.licensee_type,
          l.service_territory ?? null,
          l.website ?? null,
          l.status ?? "UNKNOWN",
          l.shares_schedule_with ?? null,
          l.coverage_status ?? "NOT_STARTED",
          l.last_verified ?? null,
          l.evidence_url ?? null,
          l.notes ?? null,
        ],
      );
    }

    for (const s of sources) {
      await client.query(
        `INSERT INTO authoritative_sources (
           source_id, jurisdiction_code, regulator_code, licensee_code, url, allowed_domains,
           source_type, authority_rank, discovery_method, adapter, schedule, rate_limit_per_minute,
           include_patterns, exclude_patterns, permitted_content_types, owner, monitoring_status,
           last_verified_at, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (source_id) DO UPDATE SET
           jurisdiction_code = EXCLUDED.jurisdiction_code,
           regulator_code = EXCLUDED.regulator_code,
           licensee_code = EXCLUDED.licensee_code,
           url = EXCLUDED.url,
           allowed_domains = EXCLUDED.allowed_domains,
           source_type = EXCLUDED.source_type,
           authority_rank = EXCLUDED.authority_rank,
           discovery_method = EXCLUDED.discovery_method,
           adapter = EXCLUDED.adapter,
           schedule = EXCLUDED.schedule,
           rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
           include_patterns = EXCLUDED.include_patterns,
           exclude_patterns = EXCLUDED.exclude_patterns,
           permitted_content_types = EXCLUDED.permitted_content_types,
           owner = EXCLUDED.owner,
           monitoring_status = EXCLUDED.monitoring_status,
           last_verified_at = EXCLUDED.last_verified_at,
           notes = EXCLUDED.notes`,
        [
          s.source_id,
          s.jurisdiction_code ?? null,
          s.regulator_code ?? null,
          s.licensee_code ?? null,
          s.url,
          s.allowed_domains,
          s.source_type,
          s.authority_rank,
          s.discovery_method,
          s.adapter,
          s.schedule ?? "DAILY",
          s.rate_limit_requests_per_minute ?? 6,
          s.include_patterns ?? [],
          s.exclude_patterns ?? [],
          s.permitted_content_types ?? ["text/html", "application/pdf"],
          s.owner ?? null,
          s.monitoring_status,
          s.last_verified ?? null,
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
  });

  return {
    jurisdictions: jurisdictions.length,
    regulators: regulators.length,
    regulatorJurisdictionLinks,
    licensees: licensees.length,
    sources: sources.length,
  };
}
