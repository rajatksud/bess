// Structured JSON report model. This is the floor deliverable for the engineering
// report generator - a well-typed, fully-derived-from-the-real-engine JSON document.
// PDF/print rendering (src/components/ExportReportModal.tsx) is a presentation layer
// on top of this; it must never claim to produce a PDF when it's actually the
// browser's print dialog (see that component's use of window.print()).

export interface ExecutiveSummarySection {
  /**
   * The battery power rating the user CONFIGURED. Renamed from `recommendedPowerKw`,
   * which was untruthful: it was a literal echo of system.ratedPowerKw, and no sizing
   * optimiser exists anywhere in this codebase to have recommended anything. See
   * `sizingBasis`.
   */
  configuredPowerKw: number;
  /** The battery energy rating the user CONFIGURED. Renamed from `recommendedEnergyKwh` for the same reason. */
  configuredEnergyKwh: number;
  /**
   * How the sizing above was arrived at. Only 'user_specified' is currently possible.
   * The value exists so that if a sizing optimiser is ever added, existing consumers
   * discover the distinction rather than silently reinterpreting an echo as advice.
   */
  sizingBasis: 'user_specified';
  batteryChemistry: string;
  firstYearNetSavingCurrency: number;
  simplePaybackYears: number | null;
  roiPct: number;
  npv: number;
  irrPct: number | null;
  confidenceGrade: string;
  confidenceGradeReason: string;
}

export interface LoadProfileDetail {
  peakBeforeKw: number;
  peakAfterKw: number;
  peakReductionKw: number;
  peakReductionPct: number;
  /** Number of intervals in the simulated horizon. */
  intervalCount: number;
  /** Cadence of those intervals in minutes. */
  intervalMinutes: number;
  /** Wall-clock duration the simulated horizon covers. */
  horizonHours: number;
  /** Gross site load energy over the simulated horizon (before solar and before the battery). */
  horizonGrossLoadKwh: number;
  /** The above scaled to a year on the same basis the engine annualises savings. */
  annualGrossLoadKwh: number;
  /** Meter-side grid import over the horizon with no battery present. */
  horizonPreBessGridImportKwh: number;
  /** Meter-side grid import over the horizon after the battery acts. */
  horizonPostBessGridImportKwh: number;
  averageLoadKw: number;
  /** Average load as a percentage of peak load. A low load factor is what makes peak shaving valuable. */
  loadFactorPct: number;
  /** States exactly how the annual figures above were derived, so no reader has to infer it. */
  annualisationBasis: string;
}

/**
 * How hard the battery is actually worked. Nothing computed this before, despite every
 * ingredient (the bessAction tags, the SOC trace, deliverableCapacityKwh) already being
 * present in the dispatch output.
 */
export interface BatteryUtilisationSection {
  intervalCount: number;
  idleIntervalCount: number;
  chargingIntervalCount: number;
  dischargingIntervalCount: number;
  /** Percentage of intervals in which the battery did anything at all. */
  activeIntervalPct: number;
  /** Count of intervals by dispatch reason (the bessAction tag). */
  intervalsByAction: Record<string, number>;
  minSocObservedPct: number;
  maxSocObservedPct: number;
  meanSocPct: number;
  /** Observed SOC range. A narrow swing on a large battery means the asset is oversized for its duty. */
  socSwingPct: number;
  peakDischargeKw: number;
  peakChargeKw: number;
  /** Peak discharge as a percentage of rated power - inverter utilisation. */
  peakDischargeUtilisationPct: number;
  deliverableCapacityKwh: number;
  /**
   * Annual discharge throughput divided by NAMEPLATE energy. A UTILISATION ratio.
   * This is TechnicalResult.equivalentFullCycles.
   */
  throughputEquivalentFullCycles: number;
  /**
   * DoD-weighted equivalent full cycles per year, counted from the SOC trace by
   * src/battery/cycleCounting.ts. This is the CANONICAL figure for ageing.
   */
  dodWeightedEquivalentFullCyclesPerYear: number;
  /**
   * The two cycle counts above are different quantities and will disagree. Spelled out
   * in the report itself rather than left as a trap for whoever reads both numbers.
   */
  cycleCountNote: string;
}

/**
 * Full annual operating cost. Previously only fixedAnnualOm was surfaced, even though
 * variable O&M, charging cost, auxiliary cost and degradation cost were all already
 * computed and sitting on SavingsBreakdown.
 */
export interface OpexBreakdownSection {
  fixedAnnualOm: number;
  /** Throughput-based variable O&M / degradation provision (SavingsBreakdown.degradationCost). */
  degradationCost: number;
  /** Cost of grid energy used to charge the battery. */
  chargingEnergyCost: number;
  /** Cost of continuous auxiliary load (HVAC/BMS). */
  auxiliaryEnergyCost: number;
  totalAnnualOpex: number;
  /** Rate the degradation provision was computed at (FinancialInput.variableOmPerKwhThroughput). */
  degradationCostRatePerKwhThroughput: number;
}

export interface SohForecastYear {
  year: number;
  sohPct: number;
  capacityKwh: number;
  usableEnergyKwh: number;
  cumulativeEquivalentFullCycles: number;
}

export interface SohForecastSection {
  /** The authoritative sohPct -> usable kWh convention, carried through verbatim from src/battery/sohForecast.ts. */
  convention: string;
  endOfLifeSohPct: number;
  /** First project year whose end-of-year SOH falls below the threshold, or null if it never does. */
  endOfLifeYear: number | null;
  warrantyYears: number | null;
  reachesEndOfLifeWithinWarranty: boolean;
  /** True when a manufacturer DoD-vs-cycle-life curve drove the projection rather than a single maxCycles rating. */
  usedDodCycleLifeCurve: boolean;
  years: SohForecastYear[];
}

export interface TechnicalDesignSection {
  loadProfile: LoadProfileDetail;
  batteryConfiguration: {
    ratedPowerKw: number;
    ratedEnergyKwh: number;
    usableDodPct: number;
    deliverableCapacityKwh: number;
    chemistry: string;
    cycleLife: number;
    projectLifeYears: number;
  };
  dispatchStrategy: {
    priorities: string[];
    equivalentFullCycles: number;
    energyChargedKwh: number;
    energyDischargedKwh: number;
    unservedBackupEnergyKwh: number;
    curtailedSolarKwh: number;
  };
  batteryUtilisation: BatteryUtilisationSection;
}

export interface FinancialAnalysisSection {
  initialCapex: number;
  fixedAnnualOm: number;
  opex: OpexBreakdownSection;
  firstYearGrossSaving: number;
  firstYearNetSaving: number;
  npv: number;
  irrPct: number | null;
  roiPct: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  /** See FinancialResult.lcoePerKwh doc comment - discounted cost / discounted energy, not a naive average. */
  lcoePerKwh: number;
  annualCashFlows: FinancialResultAnnualCashFlowSummary[];
}

export interface FinancialResultAnnualCashFlowSummary {
  year: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
}

export interface SensitivityScenario {
  label: 'conservative' | 'base' | 'optimistic';
  capexMultiplier: number;
  tariffEscalationDeltaPct: number;
  degradationMultiplier: number;
  npv: number;
  roiPct: number;
  simplePaybackYears: number | null;
}

export interface SensitivityAnalysisSection {
  /**
   * Each scenario re-runs the real financial engine (calculateFinancialMetrics) with
   * adjusted CapEx/tariff-escalation/degradation inputs against the SAME dispatch
   * output (savings/technical) as the base case - dispatch itself is unaffected by
   * these purely financial parameters under the current engine, so re-running it
   * would be redundant, not more "real". This is NOT the same as the
   * scenario-vs-scenario comparison in src/scenario/, which re-runs the full
   * dispatch+financial pipeline for independently-configured saved scenarios.
   */
  scenarios: SensitivityScenario[];
}

export interface EngineeringReport {
  generatedAt: string;
  reportModelVersion: string;
  /** The calculation engine that produced these numbers. Single source of truth, never a hardcoded string in a UI component. */
  calculationEngineVersion: string;
  mode: 'quick' | 'interval' | 'legacy';
  executiveSummary: ExecutiveSummarySection;
  technicalDesign: TechnicalDesignSection;
  financialAnalysis: FinancialAnalysisSection;
  sensitivityAnalysis: SensitivityAnalysisSection;
  /** Present only when a multi-year SOH simulation was supplied. Null - never a fabricated placeholder - when it was not. */
  sohForecast: SohForecastSection | null;
  warningCount: number;
  warnings: Array<{ level: string; message: string }>;
}
