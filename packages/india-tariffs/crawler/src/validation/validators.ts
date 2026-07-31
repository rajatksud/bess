export type ValidationLayer =
  | "SCHEMA"
  | "REFERENTIAL"
  | "TEMPORAL"
  | "UNIT"
  | "TIME_BAND"
  | "PROVENANCE"
  | "CATEGORY_RESOLUTION"
  | "COMMERCIAL_SANITY"
  | "GOLDEN_BILL"
  | "BESS_IMPACT";

export type ValidationSeverity = "INFO" | "WARNING" | "ERROR";

export interface ValidationFinding {
  layer: ValidationLayer;
  severity: ValidationSeverity;
  message: string;
  details: Record<string, unknown>;
}

export interface CandidateTariffRecord {
  id: number;
  documentId: string;
  jurisdictionCode: string | null;
  licenseeCode: string | null;
  categoryCode: string | null;
  orderDate: string | null;
  effectiveFrom: string | null;
  rawFields: { unresolvedFields?: string[] };
}

export interface ChargeComponentRecord {
  id: number;
  candidateTariffId: number;
  chargeType:
    | "FIXED"
    | "DEMAND"
    | "ENERGY"
    | "TOD_SURCHARGE"
    | "TOD_REBATE"
    | "FAC_FPPAS"
    | "POWER_FACTOR_PENALTY"
    | "POWER_FACTOR_INCENTIVE"
    | "LOAD_FACTOR_INCENTIVE"
    | "REACTIVE_ENERGY"
    | "DUTY"
    | "TAX"
    | "CESS"
    | "MINIMUM_CHARGE"
    | "REBATE"
    | "OTHER";
  value: string;
  unit: string;
  citationCount: number;
}

export interface DocumentSourceRecord {
  documentSourceId: string;
  sourceLicenseeCode: string | null;
  sourceLicenseeCodes: string[] | null;
}

export interface CorrigendumCheckInput {
  /** True if a CORRIGENDUM-classified document exists for the same document_id's source, dated after this candidate's order_date, that has no recorded semantic_change_sets row reconciling it. */
  hasUnreconciledLaterCorrigendum: boolean;
}

/**
 * charge_type families that only make sense against certain unit families --
 * catches the mission's explicit "demand charge with an energy unit" and
 * similar mislabeling classes. A charge whose unit isn't in ANY known family
 * is left alone here (validateSchema's job, not this layer's).
 */
const ENERGY_UNIT_PATTERN = /KWH|KVAH/;
const DEMAND_UNIT_PATTERN = /KW_MONTH|KVA_MONTH|KW\b|KVA\b/;
const ENERGY_CHARGE_TYPES = new Set(["ENERGY", "FAC_FPPAS", "TOD_SURCHARGE", "TOD_REBATE", "REACTIVE_ENERGY"]);
const DEMAND_CHARGE_TYPES = new Set(["DEMAND", "FIXED", "POWER_FACTOR_PENALTY", "POWER_FACTOR_INCENTIVE", "LOAD_FACTOR_INCENTIVE"]);

/**
 * Schema-shape sanity: fields that must be present for a candidate to be
 * meaningfully reviewable at all, independent of what the extractor marked
 * unresolved (unresolvedFields becoming WARNINGs is handled separately in
 * runValidation -- this layer is for structural gaps a human reviewer
 * couldn't work around, e.g. no category code at all).
 */
export function validateSchema(candidate: CandidateTariffRecord): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!candidate.categoryCode) {
    findings.push({
      layer: "SCHEMA",
      severity: "ERROR",
      message: "candidate_tariffs row has no category_code -- not a resolvable tariff category",
      details: { candidateTariffId: candidate.id },
    });
  }
  return findings;
}

/**
 * Wrong-licensee-attribution guard (mission's explicit protection list): a
 * candidate's licensee_code must actually be one this document's own source
 * is authorized to speak for. A document from a DERC source should never
 * produce a candidate attributed to a BESCOM licensee, for example.
 */
export function validateReferential(candidate: CandidateTariffRecord, documentSource: DocumentSourceRecord): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (candidate.licenseeCode) {
    const permitted = new Set(
      [documentSource.sourceLicenseeCode, ...(documentSource.sourceLicenseeCodes ?? [])].filter((c): c is string => Boolean(c)),
    );
    if (permitted.size > 0 && !permitted.has(candidate.licenseeCode)) {
      findings.push({
        layer: "REFERENTIAL",
        severity: "ERROR",
        message: `candidate licensee_code '${candidate.licenseeCode}' is not among the licensee(s) this source (${documentSource.documentSourceId}) is authorized for`,
        details: { candidateTariffId: candidate.id, candidateLicenseeCode: candidate.licenseeCode, permittedLicenseeCodes: [...permitted] },
      });
    }
  }
  return findings;
}

/**
 * A CORRIGENDUM-classified document exists for the same source dated after
 * this candidate's order_date and has not been reconciled into a
 * semantic_change_sets row -- surfaced as a WARNING (not ERROR) since the
 * corrigendum may not change this specific category, but a reviewer must be
 * able to see it was never checked.
 */
export function validateEffectiveDate(candidate: CandidateTariffRecord, corrigendum: CorrigendumCheckInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (corrigendum.hasUnreconciledLaterCorrigendum) {
    findings.push({
      layer: "TEMPORAL",
      severity: "WARNING",
      message: "a later CORRIGENDUM document exists for this source and has not been reconciled against this candidate",
      details: { candidateTariffId: candidate.id },
    });
  }
  if (!candidate.orderDate) {
    findings.push({
      layer: "TEMPORAL",
      severity: "WARNING",
      message: "order_date could not be resolved from the source document",
      details: { candidateTariffId: candidate.id },
    });
  }
  if (!candidate.effectiveFrom) {
    findings.push({
      layer: "TEMPORAL",
      severity: "WARNING",
      message: "effective_from could not be resolved from the source document",
      details: { candidateTariffId: candidate.id },
    });
  }
  return findings;
}

/**
 * charge_type vs unit family mismatch -- catches the mission's explicit
 * "DEMAND charge with an energy unit" and equivalent confusions. Units that
 * belong to neither known family (e.g. a duty/tax percentage) are not
 * flagged here; this layer only fires when the mismatch is unambiguous.
 */
export function validateUnits(charge: ChargeComponentRecord): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const isEnergyUnit = ENERGY_UNIT_PATTERN.test(charge.unit);
  const isDemandUnit = DEMAND_UNIT_PATTERN.test(charge.unit);

  if (ENERGY_CHARGE_TYPES.has(charge.chargeType) && isDemandUnit && !isEnergyUnit) {
    findings.push({
      layer: "UNIT",
      severity: "ERROR",
      message: `charge_type '${charge.chargeType}' has a demand-shaped unit '${charge.unit}' -- energy charges must be billed per kWh/kVAh`,
      details: { chargeComponentId: charge.id, chargeType: charge.chargeType, unit: charge.unit },
    });
  }
  if (DEMAND_CHARGE_TYPES.has(charge.chargeType) && isEnergyUnit && !isDemandUnit) {
    findings.push({
      layer: "UNIT",
      severity: "ERROR",
      message: `charge_type '${charge.chargeType}' has an energy-shaped unit '${charge.unit}' -- demand/fixed charges must be billed per kW/kVA`,
      details: { chargeComponentId: charge.id, chargeType: charge.chargeType, unit: charge.unit },
    });
  }
  return findings;
}

/**
 * Every material extracted value must trace back to real source text -- a
 * charge component with zero field_citations rows is a validation gate
 * failure, not just a documentation gap. This is what makes "every charge
 * has a citation" enforced rather than aspirational.
 */
export function validateProvenance(charge: ChargeComponentRecord): ValidationFinding[] {
  if (charge.citationCount === 0) {
    return [
      {
        layer: "PROVENANCE",
        severity: "ERROR",
        message: `charge component ${charge.id} (${charge.chargeType}) has no field_citations row -- every extracted value must be traceable to source text`,
        details: { chargeComponentId: charge.id, chargeType: charge.chargeType },
      },
    ];
  }
  return [];
}

/**
 * Heuristic-only commercial sanity check: a surcharge/rebate whose absolute
 * magnitude is implausibly large relative to a plausible energy base rate is
 * surfaced as a WARNING for a human to look at, never auto-rejected -- large
 * legitimate surcharges do exist (e.g. FY-end true-ups), so this must not be
 * an ERROR.
 */
export function validateCommercialSanity(charge: ChargeComponentRecord): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const numericValue = Math.abs(Number(charge.value));
  if (!Number.isFinite(numericValue)) return findings;

  const PLAUSIBLE_MAX_INR_PER_KWH = 15; // generous upper bound for an Indian C&I per-unit rate/delta in INR
  if ((charge.chargeType === "TOD_SURCHARGE" || charge.chargeType === "ENERGY") && ENERGY_UNIT_PATTERN.test(charge.unit) && numericValue > PLAUSIBLE_MAX_INR_PER_KWH) {
    findings.push({
      layer: "COMMERCIAL_SANITY",
      severity: "WARNING",
      message: `charge component ${charge.id} has an implausibly large per-unit value (${charge.value} ${charge.unit}) relative to a typical Indian C&I energy rate -- flagged for human review, not auto-rejected`,
      details: { chargeComponentId: charge.id, value: charge.value, unit: charge.unit },
    });
  }
  return findings;
}

/**
 * A candidate whose extractor left fields in unresolvedFields surfaces each
 * as its own WARNING -- the mission's "an unresolved field becomes a
 * validation warning, not a guess" requirement, made mechanically real
 * rather than just an extractor-side convention no one checks.
 */
export function validateCategoryResolution(candidate: CandidateTariffRecord): ValidationFinding[] {
  const unresolved = candidate.rawFields.unresolvedFields ?? [];
  return unresolved.map((field) => ({
    layer: "CATEGORY_RESOLUTION" as const,
    severity: "WARNING" as const,
    message: `field '${field}' could not be resolved from the source document and was left unresolved rather than guessed`,
    details: { candidateTariffId: candidate.id, field },
  }));
}
