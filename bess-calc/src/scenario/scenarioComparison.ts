import { IntervalRecord } from '../types/bess';
import { assessComparability } from './comparability';
import {
  ScenarioComparisonEntry,
  ScenarioComparisonResult,
  ScenarioMetrics,
  ScenarioRanking,
  ScenarioSohSummary,
  ScenarioDatasetFingerprint
} from './types';

export const COMPARISON_MODEL_VERSION = '1.0.0';

function toSohSummary(entry: ScenarioComparisonEntry): ScenarioSohSummary | null {
  const forecast = entry.sohForecast;
  if (!forecast || forecast.years.length === 0) return null;
  const finalYear = forecast.years[forecast.years.length - 1];
  return {
    endOfProjectSohPct: finalYear.sohPct,
    endOfLifeSohPct: forecast.endOfLifeSohPct,
    endOfLifeYear: forecast.endOfLifeYear,
    reachesEndOfLifeWithinWarranty: forecast.reachesEndOfLifeWithinWarranty,
    finalUsableEnergyKwh: finalYear.usableEnergyKwh
  };
}

export function toScenarioMetrics(entry: ScenarioComparisonEntry): ScenarioMetrics {
  const peakReductionKw = entry.technical.peakBeforeKw - entry.technical.peakAfterKw;
  const peakReductionPct = entry.technical.peakBeforeKw > 0
    ? (peakReductionKw / entry.technical.peakBeforeKw) * 100
    : 0;

  return {
    scenarioId: entry.scenarioId,
    scenarioName: entry.scenarioName,

    ratedPowerKw: entry.system.ratedPowerKw,
    ratedEnergyKwh: entry.system.ratedEnergyKwh,
    batteryChemistry: entry.system.batteryChemistry,
    usableDodPct: entry.system.usableDodPct,

    capex: entry.financialInput.initialCapex,
    fixedAnnualOm: entry.financialInput.fixedAnnualOm,

    annualGrossSaving: entry.savings.grossSaving,
    annualNetSaving: entry.savings.netOperatingSaving,
    demandChargeSaving: entry.savings.demandChargeSaving,
    energyArbitrageSaving: entry.savings.energyArbitrageSaving,
    dieselFuelSaving: entry.savings.dieselFuelSaving,
    solarSelfConsumptionSaving: entry.savings.solarSelfConsumptionSaving,
    annualEnergyDischargedKwh: entry.technical.energyDischargedKwh,

    peakBeforeKw: entry.technical.peakBeforeKw,
    peakAfterKw: entry.technical.peakAfterKw,
    peakReductionKw,
    peakReductionPct,

    npv: entry.financial.npv,
    irrPct: entry.financial.irrPct,
    roiPct: entry.financial.roiPct,
    lcosPerKwh: entry.financial.lcoePerKwh,
    simplePaybackYears: entry.financial.simplePaybackYears,
    discountedPaybackYears: entry.financial.discountedPaybackYears,

    batterySoh: toSohSummary(entry),

    confidenceGrade: entry.confidenceGrade,
    warningCount: entry.warningCount
  };
}

/**
 * Orders scenario ids by a metric. `nullsLast` places scenarios with no value for the
 * metric (e.g. a design that never pays back) at the end rather than treating a missing
 * value as zero, which would rank a never-paying-back design as the best.
 */
function rankBy(
  metrics: ScenarioMetrics[],
  select: (m: ScenarioMetrics) => number | null,
  direction: 'higher_is_better' | 'lower_is_better'
): string[] {
  const withValue = metrics.filter(m => select(m) !== null);
  const withoutValue = metrics.filter(m => select(m) === null);

  const sorted = [...withValue].sort((a, b) => {
    const av = select(a) as number;
    const bv = select(b) as number;
    return direction === 'higher_is_better' ? bv - av : av - bv;
  });

  return [...sorted, ...withoutValue].map(m => m.scenarioId);
}

function buildRanking(metrics: ScenarioMetrics[]): ScenarioRanking {
  const byNpv = rankBy(metrics, m => m.npv, 'higher_is_better');
  const byLcos = rankBy(metrics, m => (m.lcosPerKwh > 0 ? m.lcosPerKwh : null), 'lower_is_better');
  const bySimplePayback = rankBy(metrics, m => m.simplePaybackYears, 'lower_is_better');

  // NPV is the recommendation criterion. For mutually exclusive investments over an
  // identical project life and discount rate (both of which comparability gating has
  // already confirmed), maximising NPV maximises absolute value created. Payback and
  // LCOS are reported as secondary orderings because they answer different questions
  // (liquidity risk, and cost per unit of energy delivered) and can legitimately
  // disagree with NPV — the ranking does not hide that disagreement.
  const best = metrics.find(m => m.scenarioId === byNpv[0])!;
  const npvIsPositive = best.npv > 0;
  const disagreesOnPayback = bySimplePayback[0] !== byNpv[0];

  let recommendationBasis =
    'Ranked by net present value at the shared discount rate and project life. NPV is the ' +
    'standard criterion for choosing between mutually exclusive designs of equal life.';
  if (!npvIsPositive) {
    recommendationBasis +=
      ' NOTE: the highest-NPV scenario still has a NEGATIVE NPV, so this is the least-bad ' +
      'option, not an investable case.';
  }
  if (disagreesOnPayback) {
    recommendationBasis +=
      ' The shortest-payback scenario is a different design; if liquidity rather than total ' +
      'value created is the binding constraint, prefer that one.';
  }

  return { byNpv, byLcos, bySimplePayback, recommendedScenarioId: byNpv[0], recommendationBasis };
}

/**
 * Compares two or more already-evaluated scenarios.
 *
 * Pure: it never runs the dispatch or financial engine, so it cannot silently disagree
 * with the numbers the rest of the platform reports. Callers supply engine output.
 */
export function compareScenarios(entries: ScenarioComparisonEntry[]): ScenarioComparisonResult {
  const comparability = assessComparability(entries);
  const scenarios = entries.map(toScenarioMetrics);

  return {
    generatedAt: new Date().toISOString(),
    comparisonModelVersion: COMPARISON_MODEL_VERSION,
    scenarios,
    comparability,
    ranking: comparability.comparable ? buildRanking(scenarios) : null
  };
}

/** Derives the dataset fingerprint used for comparability gating from an interval series. */
export function fingerprintDataset(
  intervals: IntervalRecord[],
  intervalMinutes: number,
  datasetId?: string
): ScenarioDatasetFingerprint {
  const dtHours = intervalMinutes / 60;
  let totalLoadKwh = 0;
  let peakLoadKw = 0;
  for (const interval of intervals) {
    totalLoadKwh += interval.loadKw * dtHours;
    if (interval.loadKw > peakLoadKw) peakLoadKw = interval.loadKw;
  }
  return { datasetId, intervalCount: intervals.length, intervalMinutes, totalLoadKwh, peakLoadKw };
}
