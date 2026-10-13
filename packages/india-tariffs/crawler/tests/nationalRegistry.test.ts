// Validates the production registry files in packages/india-tariffs/registry/
// against the national-coverage invariants required for the India-wide
// jurisdiction/regulator/licensee/source registry (see
// docs/data/INDIA_TARIFF_COVERAGE.md). Unlike registry.test.ts (which tests
// loadSourceRegistry's parsing/validation logic against synthetic fixtures),
// these tests load the real YAML files directly and check cross-file
// referential integrity and coverage completeness that no single file's own
// schema can express.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "js-yaml";

// import.meta.url is dist/tests at runtime; walk up to packages/india-tariffs/registry.
const REGISTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "registry");

interface Jurisdiction {
  code: string;
  name: string;
  type: string;
  status: string;
}
interface Regulator {
  code: string;
  name: string;
  type: string;
  jurisdiction_codes: string[];
  website?: string;
}
interface Licensee {
  code: string;
  name: string;
  regulator_code: string;
  jurisdiction_code: string;
  status?: string;
  coverage_tier?: string;
  shares_schedule_with?: string;
  shared_tariff_group_id?: string | null;
  predecessor_licensee_ids?: string[];
  successor_licensee_ids?: string[];
  overlap_licensee_ids?: string[];
  parent_licensee_id?: string | null;
  evidence_url?: string;
  website?: string;
}
interface Source {
  source_id: string;
  jurisdiction_code?: string;
  regulator_code?: string;
  licensee_code?: string;
  licensee_codes?: string[];
  url: string;
  allowed_domains: string[];
}
interface SharedTariffGroup {
  group_id: string;
  regulator_code: string;
  jurisdiction_codes?: string[];
  licensee_codes: string[];
}

function loadYaml<T>(filename: string, key: string): T[] {
  const raw = readFileSync(join(REGISTRY_DIR, filename), "utf8");
  const parsed = load(raw) as Record<string, T[]>;
  return parsed[key];
}

const jurisdictions = loadYaml<Jurisdiction>("jurisdictions.yaml", "jurisdictions");
const regulators = loadYaml<Regulator>("regulators.yaml", "regulators");
const licensees = loadYaml<Licensee>("licensees.yaml", "licensees");
const sources = loadYaml<Source>("sources.yaml", "sources");
const sharedTariffGroups = loadYaml<SharedTariffGroup>("shared_tariff_groups.yaml", "shared_tariff_groups");

const jurisdictionCodes = new Set(jurisdictions.map((j) => j.code));
const regulatorCodes = new Set(regulators.map((r) => r.code));
const licenseeCodes = new Set(licensees.map((l) => l.code));

test("all 28 states and 8 Union Territories are present (36 jurisdictions)", () => {
  const states = jurisdictions.filter((j) => j.type === "STATE");
  const uts = jurisdictions.filter((j) => j.type === "UNION_TERRITORY");
  assert.equal(states.length, 28, `expected 28 states, found ${states.length}`);
  assert.equal(uts.length, 8, `expected 8 Union Territories, found ${uts.length}`);
  assert.equal(jurisdictions.length, 36);
});

test("no duplicate jurisdiction codes", () => {
  const dupes = jurisdictionCodes.size === jurisdictions.length ? [] : findDuplicates(jurisdictions.map((j) => j.code));
  assert.deepEqual(dupes, []);
});

test("no duplicate regulator codes", () => {
  assert.deepEqual(findDuplicates(regulators.map((r) => r.code)), []);
});

test("no duplicate licensee codes", () => {
  assert.deepEqual(findDuplicates(licensees.map((l) => l.code)), []);
});

test("no duplicate source ids", () => {
  assert.deepEqual(findDuplicates(sources.map((s) => s.source_id)), []);
});

test("every jurisdiction is covered by exactly one regulator", () => {
  const coverage = new Map<string, string[]>();
  for (const r of regulators) {
    for (const jc of r.jurisdiction_codes) {
      if (!coverage.has(jc)) coverage.set(jc, []);
      coverage.get(jc)!.push(r.code);
    }
  }
  const uncovered = jurisdictions.filter((j) => !coverage.has(j.code));
  assert.deepEqual(
    uncovered.map((j) => j.code),
    [],
    "every jurisdiction must resolve to at least one regulator for retail tariffs",
  );
  const multiplyCovered = [...coverage.entries()].filter(([, regs]) => regs.length > 1);
  assert.deepEqual(
    multiplyCovered,
    [],
    "a jurisdiction must not be covered by more than one regulator (would make resolution non-deterministic)",
  );
});

test("every regulator.jurisdiction_codes entry references a real jurisdiction", () => {
  const bad: string[] = [];
  for (const r of regulators) {
    for (const jc of r.jurisdiction_codes) {
      if (!jurisdictionCodes.has(jc)) bad.push(`${r.code} -> ${jc}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every licensee references a valid jurisdiction and regulator", () => {
  const badJurisdiction: string[] = [];
  const badRegulator: string[] = [];
  for (const l of licensees) {
    if (!jurisdictionCodes.has(l.jurisdiction_code)) badJurisdiction.push(`${l.code} -> ${l.jurisdiction_code}`);
    if (!regulatorCodes.has(l.regulator_code)) badRegulator.push(`${l.code} -> ${l.regulator_code}`);
  }
  assert.deepEqual(badJurisdiction, []);
  assert.deepEqual(badRegulator, []);
});

test("every licensee's regulator actually covers that licensee's jurisdiction", () => {
  const regulatorByCode = new Map(regulators.map((r) => [r.code, r]));
  const mismatches: string[] = [];
  for (const l of licensees) {
    const reg = regulatorByCode.get(l.regulator_code);
    if (reg && !reg.jurisdiction_codes.includes(l.jurisdiction_code)) {
      mismatches.push(`${l.code}: regulator ${l.regulator_code} does not list jurisdiction ${l.jurisdiction_code}`);
    }
  }
  assert.deepEqual(mismatches, [], "a licensee's regulator must be the regulator on record for its own jurisdiction");
});

test("every jurisdiction has at least one licensee", () => {
  const covered = new Set(licensees.map((l) => l.jurisdiction_code));
  const uncovered = jurisdictions.filter((j) => !covered.has(j.code));
  assert.deepEqual(
    uncovered.map((j) => j.code),
    [],
  );
});

test("every ACTIVE licensee has at least one evidence source (evidence_url, website, or authoritative_source_ids)", () => {
  const missing: string[] = [];
  for (const l of licensees as (Licensee & { authoritative_source_ids?: string[] })[]) {
    if (l.status !== "ACTIVE") continue;
    const hasEvidence =
      Boolean(l.evidence_url) || Boolean(l.website) || (l.authoritative_source_ids && l.authoritative_source_ids.length > 0);
    if (!hasEvidence) missing.push(l.code);
  }
  assert.deepEqual(missing, [], "every active licensee needs at least one authoritative evidence pointer");
});

test("no TIER_C (historical/uncertain) licensee is marked ACTIVE", () => {
  const badActive = licensees.filter((l) => l.coverage_tier === "TIER_C" && l.status === "ACTIVE").map((l) => l.code);
  assert.deepEqual(badActive, [], "TIER_C entities must never be presented as active");
});

test("licensee predecessor/successor/overlap/parent references point at real licensees", () => {
  const bad: string[] = [];
  for (const l of licensees) {
    for (const p of l.predecessor_licensee_ids ?? []) if (!licenseeCodes.has(p)) bad.push(`${l.code} pred->${p}`);
    for (const s of l.successor_licensee_ids ?? []) if (!licenseeCodes.has(s)) bad.push(`${l.code} succ->${s}`);
    for (const o of l.overlap_licensee_ids ?? []) if (!licenseeCodes.has(o)) bad.push(`${l.code} overlap->${o}`);
    if (l.parent_licensee_id && !licenseeCodes.has(l.parent_licensee_id)) bad.push(`${l.code} parent->${l.parent_licensee_id}`);
    if (l.shares_schedule_with && !licenseeCodes.has(l.shares_schedule_with)) bad.push(`${l.code} shares->${l.shares_schedule_with}`);
  }
  assert.deepEqual(bad, []);
});

test("predecessor/successor relationships are non-circular", () => {
  // A licensee must never (directly or transitively) be its own predecessor.
  const bySuccessor = new Map<string, string[]>(); // code -> predecessor codes
  for (const l of licensees) bySuccessor.set(l.code, l.predecessor_licensee_ids ?? []);

  const cycles: string[] = [];
  for (const start of licenseeCodes) {
    const seen = new Set<string>();
    let frontier = bySuccessor.get(start) ?? [];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const code of frontier) {
        if (code === start) {
          cycles.push(start);
          break;
        }
        if (seen.has(code)) continue;
        seen.add(code);
        next.push(...(bySuccessor.get(code) ?? []));
      }
      frontier = next;
    }
  }
  assert.deepEqual([...new Set(cycles)], [], "predecessor chain must not cycle back to its own starting licensee");
});

test("no unexplained duplicate legal names across different licensee codes", () => {
  const byName = new Map<string, string[]>();
  for (const l of licensees) {
    const key = l.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(l.code);
  }
  const dupes = [...byName.entries()].filter(([, codes]) => codes.length > 1);
  assert.deepEqual(dupes, [], "two different licensee codes must not share the exact same legal name");
});

test("every source references valid jurisdiction/regulator/licensee codes where set", () => {
  const bad: string[] = [];
  for (const s of sources) {
    if (s.jurisdiction_code && !jurisdictionCodes.has(s.jurisdiction_code)) bad.push(`${s.source_id} jurisdiction->${s.jurisdiction_code}`);
    if (s.regulator_code && !regulatorCodes.has(s.regulator_code)) bad.push(`${s.source_id} regulator->${s.regulator_code}`);
    if (s.licensee_code && !licenseeCodes.has(s.licensee_code)) bad.push(`${s.source_id} licensee->${s.licensee_code}`);
    for (const lc of s.licensee_codes ?? []) if (!licenseeCodes.has(lc)) bad.push(`${s.source_id} licensee_codes->${lc}`);
  }
  assert.deepEqual(bad, []);
});

test("no source is orphaned (every source names at least one regulator, licensee, or is an explicit secondary/discovery source)", () => {
  const orphaned = sources
    .filter((s) => !s.regulator_code && !s.licensee_code && (!s.licensee_codes || s.licensee_codes.length === 0))
    .map((s) => s.source_id)
    .filter((id) => id !== "FOR-DIRECTORY"); // Forum of Regulators directory is deliberately unscoped (discovery-only)
  assert.deepEqual(orphaned, [], "a source must be attributable to a regulator or licensee unless it is an explicit discovery-only source");
});

test("every source's own URL hostname is inside its own allowed_domains", () => {
  const bad: string[] = [];
  for (const s of sources) {
    try {
      const host = new URL(s.url).hostname;
      if (!s.allowed_domains.includes(host)) bad.push(`${s.source_id}: host ${host} not in [${s.allowed_domains.join(", ")}]`);
    } catch {
      bad.push(`${s.source_id}: invalid URL ${s.url}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("a source mapped to a licensee is not mapped to a different jurisdiction than that licensee's own", () => {
  const licenseeByCode = new Map(licensees.map((l) => [l.code, l]));
  const bad: string[] = [];
  for (const s of sources) {
    if (!s.jurisdiction_code) continue;
    const codes = s.licensee_codes ?? (s.licensee_code ? [s.licensee_code] : []);
    for (const lc of codes) {
      const l = licenseeByCode.get(lc);
      if (l && l.jurisdiction_code !== s.jurisdiction_code) {
        bad.push(`${s.source_id}: jurisdiction_code=${s.jurisdiction_code} but licensee ${lc} belongs to ${l.jurisdiction_code}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("shared tariff groups reference valid regulators, jurisdictions and licensees", () => {
  const bad: string[] = [];
  for (const g of sharedTariffGroups) {
    if (!regulatorCodes.has(g.regulator_code)) bad.push(`${g.group_id} regulator->${g.regulator_code}`);
    for (const jc of g.jurisdiction_codes ?? []) if (!jurisdictionCodes.has(jc)) bad.push(`${g.group_id} jurisdiction->${jc}`);
    for (const lc of g.licensee_codes) if (!licenseeCodes.has(lc)) bad.push(`${g.group_id} licensee->${lc}`);
  }
  assert.deepEqual(bad, []);
});

test("every licensee.shared_tariff_group_id points at a real shared tariff group", () => {
  const groupIds = new Set(sharedTariffGroups.map((g) => g.group_id));
  const bad = licensees.filter((l) => l.shared_tariff_group_id && !groupIds.has(l.shared_tariff_group_id)).map((l) => l.code);
  assert.deepEqual(bad, []);
});

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}
