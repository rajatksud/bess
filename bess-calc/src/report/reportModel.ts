import { SimulationResult } from '../types/bess';
import { CALCULATION_ENGINE_VERSION } from '../engine/version';
import { SohForecast, halfCyclesFromIntervals, equivalentFullCycles } from '../battery';
import {
  EngineeringReport,
  BatteryUtilisationSection,
  LoadProfileDetail,
  OpexBreakdownSection,
  SohForecastSection
} from './types';
import { buildSensitivityMatrix } from './sensitivityAnalysis';

export const REPORT_MODEL_VERSION = '2.0.0';

/** The engine simulates a representative horizon and scales it to a year by this factor. */
const DEFAULT_DAYS_PER_YEAR = 365;
const DEFAULT_INTERVAL_MINUTES = 15;

export interface BuildEngineeringReportOptions {
  /**
   * Interval cadence of result.intervals. SimulationResult does not carry it, and every
   * energy figure in the load-profile section depends on it, so it is an explicit input
   * rather than something inferred from timeLabel strings. Defaults to 15 minutes, the
   * engine's own default, and the value used is always reported back in the output.
   */
  intervalMinutes?: number;
  /** How many times the simulated horizon repeats to make a year. Must match what the dispatch engine used. */
  daysPerYear?: number;
  /** Multi-year state-of-health projection from runMultiYearSimulation. Omit to produce a report with sohForecast: null. */
  sohForecast?: SohForecast;
}

const CYCLE_COUNT_NOTE =
  'throughputEquivalentFullCycles is annual discharge throughput divided by NAMEPLATE energy ' +
  '(a utilisation ratio). dodWeightedEquivalentFullCyclesPerYear is counted from the SOC trace ' +
  'and weighted by depth of discharge (the ageing measure). They answer different questions and ' +
  'will not agree; the DoD-weighted figure is the one that governs battery life.';

function buildLoadProfile(
  result: SimulationResult,
  intervalMinutes: number,
  daysPerYear: number
): LoadProfileDetail {
  const { technical, intervals } = result;
  const dtHours = intervalMinutes / 60;

  const peakReductionKw = technical.peakBeforeKw - technical.peakAfterKw;
  const peakReductionPct = technical.peakBeforeKw > 0 ? (peakReductionKw / technical.peakBeforeKw) * 100 : 0;

  let horizonGrossLoadKwh = 0;
  let horizonPreBessGridImportKwh = 0;
  let horizonPostBessGridImportKwh = 0;
  let peakGrossLoadKw = 0;

  for (const interval of intervals) {
    horizonGrossLoadKwh += interval.loadKw * dtHours;
    horizonPreBessGridImportKwh += interval.preBessGridImportKw * dtHours;
    horizonPostBessGridImportKwh += interval.postBessGridImportKw * dtHours;
    if (interval.loadKw > peakGrossLoadKw) peakGrossLoadKw = interval.loadKw;
  }

  const horizonHours = intervals.length * dtHours;
  const averageLoadKw = horizonHours > 0 ? horizonGrossLoadKwh / horizonHours : 0;

  return {
    peakBeforeKw: technical.peakBeforeKw,
    peakAfterKw: technical.peakAfterKw,
    peakReductionKw,
    peakReductionPct: Math.round(peakReductionPct * 10) / 10,
    intervalCount: intervals.length,
    intervalMinutes,
    horizonHours,
    horizonGrossLoadKwh,
    annualGrossLoadKwh: horizonGrossLoadKwh * daysPerYear,
    horizonPreBessGridImportKwh,
    horizonPostBessGridImportKwh,
    averageLoadKw,
    loadFactorPct: peakGrossLoadKw > 0 ? (averageLoadKw / peakGrossLoadKw) * 100 : 0,
    annualisationBasis:
      `Annual figures are the simulated ${intervals.length}-interval horizon repeated ${daysPerYear} times, ` +
      'the same basis the dispatch engine uses for its own annual savings. A profile that is not ' +
      'representative of a typical day will not annualise correctly.'
  };
}

function buildBatteryUtilisation(result: SimulationResult, daysPerYear: number): BatteryUtilisationSection {
  const { intervals, technical, system } = result;

  let idleIntervalCount = 0;
  let chargingIntervalCount = 0;
  let dischargingIntervalCount = 0;
  let peakDischargeKw = 0;
  let peakChargeKw = 0;
  let minSocObservedPct = Number.POSITIVE_INFINITY;
  let maxSocObservedPct = Number.NEGATIVE_INFINITY;
  let socSum = 0;
  const intervalsByAction: Record<string, number> = {};

  for (const interval of intervals) {
    intervalsByAction[interval.bessAction] = (intervalsByAction[interval.bessAction] ?? 0) + 1;

    if (interval.bessPowerKw > 0) {
      dischargingIntervalCount++;
      if (interval.bessPowerKw > peakDischargeKw) peakDischargeKw = interval.bessPowerKw;
    } else if (interval.bessPowerKw < 0) {
      chargingIntervalCount++;
      const chargeKw = Math.abs(interval.bessPowerKw);
      if (chargeKw > peakChargeKw) peakChargeKw = chargeKw;
    } else {
      idleIntervalCount++;
    }

    if (interval.bessSocPct < minSocObservedPct) minSocObservedPct = interval.bessSocPct;
    if (interval.bessSocPct > maxSocObservedPct) maxSocObservedPct = interval.bessSocPct;
    socSum += interval.bessSocPct;
  }

  const intervalCount = intervals.length;
  const activeIntervalCount = chargingIntervalCount + dischargingIntervalCount;
  const hasIntervals = intervalCount > 0;

  // Canonical ageing cycle count: DoD-weighted, from the SOC trace (src/battery), scaled
  // to a year on the same basis as every other annual figure in this report.
  const dodWeightedPerHorizon = equivalentFullCycles(halfCyclesFromIntervals(intervals));

  return {
    intervalCount,
    idleIntervalCount,
    chargingIntervalCount,
    dischargingIntervalCount,
    activeIntervalPct: hasIntervals ? (activeIntervalCount / intervalCount) * 100 : 0,
    intervalsByAction,
    minSocObservedPct: hasIntervals ? minSocObservedPct : 0,
    maxSocObservedPct: hasIntervals ? maxSocObservedPct : 0,
    meanSocPct: hasIntervals ? socSum / intervalCount : 0,
    socSwingPct: hasIntervals ? maxSocObservedPct - minSocObservedPct : 0,
    peakDischargeKw,
    peakChargeKw,
    peakDischargeUtilisationPct: system.ratedPowerKw > 0 ? (peakDischargeKw / system.ratedPowerKw) * 100 : 0,
    deliverableCapacityKwh: technical.deliverableCapacityKwh,
    throughputEquivalentFullCycles: technical.equivalentFullCycles,
    dodWeightedEquivalentFullCyclesPerYear: dodWeightedPerHorizon * daysPerYear,
    cycleCountNote: CYCLE_COUNT_NOTE
  };
}

function buildOpexBreakdown(result: SimulationResult): OpexBreakdownSection {
  const { savings, financialInput } = result;
  return {
    fixedAnnualOm: savings.omCost,
    degradationCost: savings.degradationCost,
    chargingEnergyCost: savings.chargingEnergyCost,
    auxiliaryEnergyCost: savings.auxiliaryEnergyCost,
    totalAnnualOpex: savings.omCost + savings.degradationCost + savings.chargingEnergyCost + savings.auxiliaryEnergyCost,
    degradationCostRatePerKwhThroughput: financialInput.variableOmPerKwhThroughput
  };
}

function buildSohForecastSection(forecast: SohForecast): SohForecastSection {
  return {
    convention: forecast.convention,
    endOfLifeSohPct: forecast.endOfLifeSohPct,
    endOfLifeYear: forecast.endOfLifeYear,
    warrantyYears: forecast.warrantyYears ?? null,
    reachesEndOfLifeWithinWarranty: forecast.reachesEndOfLifeWithinWarranty,
    usedDodCycleLifeCurve: forecast.usedDodCycleLifeCurve,
    years: forecast.years.map(year => ({
      year: year.year,
      sohPct: year.sohPct,
      capacityKwh: year.capacityKwh,
      usableEnergyKwh: year.usableEnergyKwh,
      cumulativeEquivalentFullCycles: year.cumulativeEquivalentFullCycles
    }))
  };
}

/**
 * Builds the structured JSON engineering report from a completed SimulationResult.
 * Pure function, no I/O - every number here traces back to the real engine
 * (dispatchEngine/financialEngine/validationEngine/battery), never a hardcoded
 * assumption. PDF/print is a presentation concern layered on top (see
 * ExportReportModal.tsx), not reinvented here.
 */
export function buildEngineeringReport(
  result: SimulationResult,
  options: BuildEngineeringReportOptions = {}
): EngineeringReport {
  const { system, technical, financial, dispatchPriorities, warnings, mode, confidenceGrade, confidenceGradeReason, savings } = result;
  const intervalMinutes = options.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const daysPerYear = options.daysPerYear ?? DEFAULT_DAYS_PER_YEAR;

  return {
    generatedAt: new Date().toISOString(),
    reportModelVersion: REPORT_MODEL_VERSION,
    calculationEngineVersion: CALCULATION_ENGINE_VERSION,
    mode,
    executiveSummary: {
      configuredPowerKw: system.ratedPowerKw,
      configuredEnergyKwh: system.ratedEnergyKwh,
      sizingBasis: 'user_specified',
      batteryChemistry: system.batteryChemistry,
      firstYearNetSavingCurrency: financial.firstYearNetSaving,
      simplePaybackYears: financial.simplePaybackYears,
      roiPct: financial.roiPct,
      npv: financial.npv,
      irrPct: financial.irrPct,
      confidenceGrade,
      confidenceGradeReason
    },
    technicalDesign: {
      loadProfile: buildLoadProfile(result, intervalMinutes, daysPerYear),
      batteryConfiguration: {
        ratedPowerKw: system.ratedPowerKw,
        ratedEnergyKwh: system.ratedEnergyKwh,
        usableDodPct: system.usableDodPct,
        deliverableCapacityKwh: technical.deliverableCapacityKwh,
        chemistry: system.batteryChemistry,
        cycleLife: system.cycleLife,
        projectLifeYears: system.projectLifeYears
      },
      dispatchStrategy: {
        priorities: dispatchPriorities,
        equivalentFullCycles: technical.equivalentFullCycles,
        energyChargedKwh: technical.energyChargedKwh,
        energyDischargedKwh: technical.energyDischargedKwh,
        unservedBackupEnergyKwh: technical.unservedBackupEnergyKwh,
        curtailedSolarKwh: technical.curtailedSolarKwh
      },
      batteryUtilisation: buildBatteryUtilisation(result, daysPerYear)
    },
    financialAnalysis: {
      initialCapex: financial.initialInvestment,
      fixedAnnualOm: savings.omCost,
      opex: buildOpexBreakdown(result),
      firstYearGrossSaving: financial.firstYearGrossSaving,
      firstYearNetSaving: financial.firstYearNetSaving,
      npv: financial.npv,
      irrPct: financial.irrPct,
      roiPct: financial.roiPct,
      simplePaybackYears: financial.simplePaybackYears,
      discountedPaybackYears: financial.discountedPaybackYears,
      lcoePerKwh: financial.lcoePerKwh,
      annualCashFlows: financial.annualCashFlows.map(cf => ({
        year: cf.year,
        netCashFlow: cf.netCashFlow,
        cumulativeCashFlow: cf.cumulativeCashFlow
      }))
    },
    sensitivityAnalysis: {
      scenarios: buildSensitivityMatrix(result)
    },
    sohForecast: options.sohForecast ? buildSohForecastSection(options.sohForecast) : null,
    warningCount: warnings.length,
    warnings: warnings.map(w => ({ level: w.level, message: w.message }))
  };
}
