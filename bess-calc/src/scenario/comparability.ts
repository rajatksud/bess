import { ScenarioComparisonEntry, ComparabilityAssessment } from './types';

/**
 * Comparability gating for a scenario-vs-scenario design comparison.
 *
 * The question this answers is narrow and specific: "is the DIFFERENCE between these
 * scenarios' results attributable to their design difference alone?" Anything that
 * changes the results without being part of the design under evaluation — a different
 * load profile, a different tariff, a different discount rate — makes a ranking
 * meaningless, because the reader cannot tell which input caused the difference.
 *
 * Battery sizing, chemistry, SOC window, dispatch priorities and CapEx are deliberately
 * NOT gated: those ARE the design, and varying them is the entire point.
 */

const CURRENCY_TOLERANCE = 1e-9;
const RATE_TOLERANCE = 1e-9;
/** Load-profile totals are floating-point sums over thousands of intervals; compare relatively, not exactly. */
const PROFILE_RELATIVE_TOLERANCE = 1e-6;

function allEqual<T>(values: T[], equals: (a: T, b: T) => boolean): boolean {
  return values.every(value => equals(value, values[0]));
}

function numbersEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function relativelyEqual(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale <= PROFILE_RELATIVE_TOLERANCE;
}

export function assessComparability(entries: ScenarioComparisonEntry[]): ComparabilityAssessment {
  const reasons: string[] = [];
  const heldConstant: string[] = [];

  if (entries.length < 2) {
    return {
      comparable: false,
      reasons: ['At least two scenarios are required for a comparison.'],
      heldConstant: []
    };
  }

  const ids = entries.map(e => e.scenarioId);
  if (new Set(ids).size !== ids.length) {
    reasons.push('The same scenario was supplied more than once; a scenario cannot be compared against itself.');
  }

  // --- Load profile ---------------------------------------------------------------
  const datasetIds = entries.map(e => e.dataset.datasetId);
  const allHaveDatasetId = datasetIds.every(id => id !== undefined);
  if (allHaveDatasetId && !allEqual(datasetIds, (a, b) => a === b)) {
    reasons.push('Scenarios were evaluated against different interval datasets; savings driven by a different load profile are not attributable to the battery design.');
  } else if (!allEqual(entries.map(e => e.dataset.intervalCount), (a, b) => a === b)) {
    reasons.push('Scenarios were evaluated over a different number of intervals.');
  } else if (!allEqual(entries.map(e => e.dataset.intervalMinutes), (a, b) => a === b)) {
    reasons.push('Scenarios were evaluated at different interval resolutions; peak measurement is resolution-dependent, so demand savings are not comparable.');
  } else if (!allEqual(entries.map(e => e.dataset.totalLoadKwh), relativelyEqual)) {
    reasons.push('Scenarios were evaluated against load profiles with different total energy.');
  } else if (!allEqual(entries.map(e => e.dataset.peakLoadKw), relativelyEqual)) {
    reasons.push('Scenarios were evaluated against load profiles with different peak load.');
  } else {
    heldConstant.push('load profile (interval count, resolution, total energy and peak)');
  }

  // --- Tariff ---------------------------------------------------------------------
  const tariffReasonCountBefore = reasons.length;
  if (!allEqual(entries.map(e => e.tariff.currency), (a, b) => a === b)) {
    reasons.push('Scenarios use different currencies; monetary results cannot be ranked against each other.');
  }
  if (!allEqual(entries.map(e => e.tariff.energyChargePerKwh), (a, b) => numbersEqual(a, b, RATE_TOLERANCE))) {
    reasons.push('Scenarios use different energy charges; arbitrage and solar savings differences would reflect the tariff, not the design.');
  }
  if (!allEqual(entries.map(e => e.tariff.demandChargePerKvaMonth), (a, b) => numbersEqual(a, b, RATE_TOLERANCE))) {
    reasons.push('Scenarios use different demand charges; demand savings differences would reflect the tariff, not the design.');
  }
  if (!allEqual(entries.map(e => e.tariff.contractDemandKva), (a, b) => numbersEqual(a, b, RATE_TOLERANCE))) {
    reasons.push('Scenarios use different contract demand; the billed-demand cap differs, so demand savings are not comparable.');
  }
  if (!allEqual(entries.map(e => e.tariff.enableTou), (a, b) => a === b)) {
    reasons.push('Some scenarios have time-of-use pricing enabled and others do not.');
  }
  if (reasons.length === tariffReasonCountBefore) {
    heldConstant.push('tariff (currency, energy charge, demand charge, contract demand, TOU mode)');
  }

  // --- Financial basis ------------------------------------------------------------
  const financialReasonCountBefore = reasons.length;
  if (!allEqual(entries.map(e => e.financialInput.discountRatePct), (a, b) => numbersEqual(a, b, CURRENCY_TOLERANCE))) {
    reasons.push('Scenarios use different discount rates; NPV and discounted payback are not comparable across different rates.');
  }
  if (!allEqual(entries.map(e => e.system.projectLifeYears), (a, b) => a === b)) {
    reasons.push('Scenarios use different project lives; NPV of unequal-life projects is not directly comparable without an equivalent-annual-value adjustment, which this comparison does not perform.');
  }
  if (reasons.length === financialReasonCountBefore) {
    heldConstant.push('financial basis (discount rate, project life)');
  }

  return { comparable: reasons.length === 0, reasons, heldConstant };
}
