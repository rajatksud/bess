/**
 * Semantic diff engine (crawler architecture section 12).
 *
 * A file hash change does not explain the commercial consequence of a
 * tariff update. This module compares a candidate tariff (and its charge
 * components) against its baseline -- the most recently APPROVED tariff for
 * the same jurisdiction/licensee/category, found via
 * db/semanticDiffRepository.ts's baseline lookup, not necessarily the
 * immediate predecessor_candidate_id row -- and produces one
 * SemanticChangeRow per detected difference, ready to persist to
 * semantic_change_sets.
 *
 * Pure and DB-free by design so it can be unit tested exhaustively without a
 * database (see tests/semanticDiff.test.ts): callers own loading the
 * candidate/baseline records and persisting the output.
 */

export type ChangeKind =
  | "NEW_LICENSEE"
  | "REMOVED_LICENSEE"
  | "NEW_CATEGORY"
  | "REMOVED_CATEGORY"
  | "EFFECTIVE_DATE_CHANGE"
  | "ENERGY_CHARGE_CHANGE"
  | "DEMAND_CHARGE_CHANGE"
  | "FIXED_CHARGE_CHANGE"
  | "BILLING_BASIS_CHANGE"
  | "APPLICABILITY_CHANGE"
  | "BILLING_DEMAND_RULE_CHANGE"
  | "TOD_CHANGE"
  | "FAC_FPPAS_CHANGE"
  | "PF_LOAD_FACTOR_RULE_CHANGE"
  | "REBATE_CHANGE"
  | "RETROSPECTIVE_CORRECTION"
  | "CITATION_ONLY";

export type CommercialImpact = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export interface SemanticChangeRow {
  changeKind: ChangeKind;
  summary: string;
  beforeValue: unknown;
  afterValue: unknown;
  commercialImpact: CommercialImpact;
}

export interface DiffChargeComponent {
  chargeType: string;
  value: string;
  unit: string;
}

export interface DiffTariff {
  /** null means "no baseline exists" (this is a brand-new licensee/category). */
  jurisdictionCode: string | null;
  licenseeCode: string | null;
  categoryCode: string | null;
  billingEnergyBasis: string | null;
  billingDemandBasis: string | null;
  effectiveFrom: string | null;
  orderDate: string | null;
  charges: DiffChargeComponent[];
}

/** charge_type values treated as ToD-related for TOD_CHANGE grouping. */
const TOD_CHARGE_TYPES = new Set(["TOD_SURCHARGE", "TOD_REBATE"]);
const PF_LOAD_FACTOR_TYPES = new Set(["POWER_FACTOR_PENALTY", "POWER_FACTOR_INCENTIVE", "LOAD_FACTOR_INCENTIVE"]);

/**
 * Diffs a candidate tariff against its baseline. `baseline === null` means no
 * prior approved tariff exists for this jurisdiction/licensee/category --
 * every charge is reported as a NEW_CATEGORY change rather than individual
 * charge-change rows, since there is nothing to compare a first-ever tariff
 * against.
 */
export function diffTariff(candidate: DiffTariff, baseline: DiffTariff | null): SemanticChangeRow[] {
  if (baseline === null) {
    return [
      {
        changeKind: "NEW_CATEGORY",
        summary: `New category ${candidate.categoryCode ?? "(unknown)"} for licensee ${candidate.licenseeCode ?? "(unknown)"}: no prior approved tariff found to compare against`,
        beforeValue: null,
        afterValue: summarizeTariff(candidate),
        commercialImpact: "UNKNOWN",
      },
    ];
  }

  const changes: SemanticChangeRow[] = [];

  if (candidate.effectiveFrom !== baseline.effectiveFrom) {
    changes.push({
      changeKind: "EFFECTIVE_DATE_CHANGE",
      summary: `Effective date changed from ${baseline.effectiveFrom ?? "(unset)"} to ${candidate.effectiveFrom ?? "(unset)"}`,
      beforeValue: baseline.effectiveFrom,
      afterValue: candidate.effectiveFrom,
      commercialImpact: "NONE",
    });

    if (candidate.orderDate && candidate.effectiveFrom && candidate.effectiveFrom < candidate.orderDate) {
      changes.push({
        changeKind: "RETROSPECTIVE_CORRECTION",
        summary: `Effective date ${candidate.effectiveFrom} precedes the order date ${candidate.orderDate}: candidate applies retrospectively`,
        beforeValue: baseline.effectiveFrom,
        afterValue: candidate.effectiveFrom,
        commercialImpact: "HIGH",
      });
    }
  }

  if (candidate.billingEnergyBasis !== baseline.billingEnergyBasis || candidate.billingDemandBasis !== baseline.billingDemandBasis) {
    changes.push({
      changeKind: "BILLING_BASIS_CHANGE",
      summary: `Billing basis changed from ${baseline.billingEnergyBasis ?? "?"}/${baseline.billingDemandBasis ?? "?"} to ${candidate.billingEnergyBasis ?? "?"}/${candidate.billingDemandBasis ?? "?"}`,
      beforeValue: { energy: baseline.billingEnergyBasis, demand: baseline.billingDemandBasis },
      afterValue: { energy: candidate.billingEnergyBasis, demand: candidate.billingDemandBasis },
      commercialImpact: "HIGH",
    });
  }

  changes.push(...diffCharges(candidate.charges, baseline.charges));

  if (changes.length === 0) {
    changes.push({
      changeKind: "CITATION_ONLY",
      summary: "No commercially material difference detected against the prior approved tariff; only provenance/citation may differ",
      beforeValue: null,
      afterValue: null,
      commercialImpact: "NONE",
    });
  }

  return changes;
}

function diffCharges(candidateCharges: DiffChargeComponent[], baselineCharges: DiffChargeComponent[]): SemanticChangeRow[] {
  const changes: SemanticChangeRow[] = [];
  const baselineByType = groupByType(baselineCharges);
  const candidateByType = groupByType(candidateCharges);

  const allTypes = new Set([...baselineByType.keys(), ...candidateByType.keys()]);
  for (const chargeType of allTypes) {
    const before = baselineByType.get(chargeType) ?? [];
    const after = candidateByType.get(chargeType) ?? [];
    const changeKind = chargeChangeKindFor(chargeType);

    if (before.length === 0 && after.length > 0) {
      changes.push({
        changeKind,
        summary: `New ${chargeType} charge(s) introduced: not present in the prior approved tariff`,
        beforeValue: null,
        afterValue: after,
        commercialImpact: impactFor(chargeType, "introduced"),
      });
      continue;
    }
    if (before.length > 0 && after.length === 0) {
      changes.push({
        changeKind,
        summary: `${chargeType} charge(s) removed: present in the prior approved tariff but absent from the candidate`,
        beforeValue: before,
        afterValue: null,
        commercialImpact: impactFor(chargeType, "removed"),
      });
      continue;
    }

    const beforeSorted = sortCharges(before);
    const afterSorted = sortCharges(after);
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      changes.push({
        changeKind,
        summary: `${chargeType} charge value/unit changed`,
        beforeValue: beforeSorted,
        afterValue: afterSorted,
        commercialImpact: impactFor(chargeType, "changed"),
      });
    }
  }

  return changes;
}

function groupByType(charges: DiffChargeComponent[]): Map<string, DiffChargeComponent[]> {
  const map = new Map<string, DiffChargeComponent[]>();
  for (const charge of charges) {
    const list = map.get(charge.chargeType) ?? [];
    list.push(charge);
    map.set(charge.chargeType, list);
  }
  return map;
}

function sortCharges(charges: DiffChargeComponent[]): DiffChargeComponent[] {
  return [...charges].sort((a, b) => (a.unit + a.value).localeCompare(b.unit + b.value));
}

function chargeChangeKindFor(chargeType: string): ChangeKind {
  if (chargeType === "ENERGY") return "ENERGY_CHARGE_CHANGE";
  if (chargeType === "DEMAND") return "DEMAND_CHARGE_CHANGE";
  if (chargeType === "FIXED") return "FIXED_CHARGE_CHANGE";
  if (chargeType === "FAC_FPPAS") return "FAC_FPPAS_CHANGE";
  if (chargeType === "REBATE") return "REBATE_CHANGE";
  if (TOD_CHARGE_TYPES.has(chargeType)) return "TOD_CHANGE";
  if (PF_LOAD_FACTOR_TYPES.has(chargeType)) return "PF_LOAD_FACTOR_RULE_CHANGE";
  return "APPLICABILITY_CHANGE";
}

/**
 * Conservative default severities: base energy/demand/fixed charges are
 * always at least MEDIUM impact since they directly move most C&I bills;
 * FAC/FPPAS changes are HIGH because they compound monthly and are easy to
 * miss; everything else defaults to LOW so a human reviewer still sees it
 * without every minor rebate change screaming HIGH. This is intentionally
 * conservative -- it must never under-call an energy/demand change as NONE,
 * only ever over-call toward requiring more review attention.
 */
function impactFor(chargeType: string, kind: "introduced" | "removed" | "changed"): CommercialImpact {
  if (chargeType === "ENERGY" || chargeType === "DEMAND" || chargeType === "FIXED") return "MEDIUM";
  if (chargeType === "FAC_FPPAS") return "HIGH";
  if (kind === "removed") return "MEDIUM";
  return "LOW";
}

function summarizeTariff(tariff: DiffTariff): Record<string, unknown> {
  return {
    jurisdictionCode: tariff.jurisdictionCode,
    licenseeCode: tariff.licenseeCode,
    categoryCode: tariff.categoryCode,
    billingEnergyBasis: tariff.billingEnergyBasis,
    billingDemandBasis: tariff.billingDemandBasis,
    effectiveFrom: tariff.effectiveFrom,
    charges: tariff.charges,
  };
}
