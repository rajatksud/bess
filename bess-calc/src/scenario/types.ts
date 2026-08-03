import {
  BessSystemInput,
  TariffInput,
  FinancialInput,
  SavingsBreakdown,
  TechnicalResult,
  FinancialResult
} from '../types/bess';
import { SohForecast } from '../battery';

/**
 * Scenario-vs-scenario DESIGN comparison.
 *
 * Deliberately NOT built on src/optimisation/comparison.ts. That module compares
 * heuristic-vs-LP dispatch for a SINGLE scenario: it is grid-energy-cost-only (no
 * NPV/IRR/payback/CAPEX), and its comparability gates (equal initialSocKwh, equal
 * demandChargeScopeNote) fire by construction for two differently-configured designs,
 * so it would report every real design comparison as incomparable. What IS reused is its
 * design pattern — explicit comparability gating with a reasons[] array, and never
 * presenting a ranking whose basis does not hold.
 */

/** One scenario's already-computed results. Pure input: this module never runs the engine itself. */
export interface ScenarioComparisonEntry {
  scenarioId: string;
  scenarioName: string;
  system: BessSystemInput;
  tariff: TariffInput;
  financialInput: FinancialInput;
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  financial: FinancialResult;
  /** Per-year state-of-health projection, when a multi-year simulation was run. */
  sohForecast?: SohForecast;
  confidenceGrade: string;
  warningCount: number;
  dataset: ScenarioDatasetFingerprint;
}

/**
 * Enough of the load dataset to tell whether two scenarios were evaluated against the
 * same physical site. A datasetId match is conclusive; the numeric fields let scenarios
 * that came from different sources (or from the UI's generated profiles, which have no
 * dataset id at all) still be checked.
 */
export interface ScenarioDatasetFingerprint {
  datasetId?: string;
  intervalCount: number;
  intervalMinutes: number;
  totalLoadKwh: number;
  peakLoadKw: number;
}

export interface ScenarioSohSummary {
  endOfProjectSohPct: number;
  endOfLifeSohPct: number;
  /** First project year below the end-of-life threshold, or null if never within the horizon. */
  endOfLifeYear: number | null;
  reachesEndOfLifeWithinWarranty: boolean;
  finalUsableEnergyKwh: number;
}

/** Machine-readable per-scenario metrics. Every field traces to the real engine. */
export interface ScenarioMetrics {
  scenarioId: string;
  scenarioName: string;

  // Design
  ratedPowerKw: number;
  ratedEnergyKwh: number;
  batteryChemistry: string;
  usableDodPct: number;

  // Cost
  capex: number;
  fixedAnnualOm: number;

  // Annual performance
  annualGrossSaving: number;
  annualNetSaving: number;
  demandChargeSaving: number;
  energyArbitrageSaving: number;
  dieselFuelSaving: number;
  solarSelfConsumptionSaving: number;
  annualEnergyDischargedKwh: number;

  // Peak
  peakBeforeKw: number;
  peakAfterKw: number;
  peakReductionKw: number;
  peakReductionPct: number;

  // Financial
  npv: number;
  irrPct: number | null;
  roiPct: number;
  lcosPerKwh: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;

  // Battery health
  batterySoh: ScenarioSohSummary | null;

  confidenceGrade: string;
  warningCount: number;
}

export interface ComparabilityAssessment {
  comparable: boolean;
  /** Empty when comparable. Each entry names one dimension that differs and why it invalidates a like-for-like ranking. */
  reasons: string[];
  /** Dimensions confirmed identical across every scenario — what the comparison is actually holding constant. */
  heldConstant: string[];
}

export interface ScenarioRanking {
  /** Scenario ids, best first. */
  byNpv: string[];
  byLcos: string[];
  bySimplePayback: string[];
  recommendedScenarioId: string;
  recommendationBasis: string;
}

export interface ScenarioComparisonResult {
  generatedAt: string;
  comparisonModelVersion: string;
  scenarios: ScenarioMetrics[];
  comparability: ComparabilityAssessment;
  /**
   * Null whenever comparability.comparable is false. Per-scenario metrics above remain
   * individually valid and are always returned — it is only the RANKING that is withheld,
   * because ranking two designs evaluated under different tariffs, load profiles or
   * discount rates conflates the design difference with the assumption difference.
   */
  ranking: ScenarioRanking | null;
}
