// Structured JSON report model. This is the floor deliverable for the engineering
// report generator - a well-typed, fully-derived-from-the-real-engine JSON document.
// PDF/print rendering (src/components/ExportReportModal.tsx) is a presentation layer
// on top of this; it must never claim to produce a PDF when it's actually the
// browser's print dialog (see that component's use of window.print()).

export interface ExecutiveSummarySection {
  recommendedPowerKw: number;
  recommendedEnergyKwh: number;
  batteryChemistry: string;
  firstYearNetSavingCurrency: number;
  simplePaybackYears: number | null;
  roiPct: number;
  npv: number;
  irrPct: number | null;
  confidenceGrade: string;
  confidenceGradeReason: string;
}

export interface TechnicalDesignSection {
  loadProfile: {
    peakBeforeKw: number;
    peakAfterKw: number;
    peakReductionKw: number;
    peakReductionPct: number;
  };
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
}

export interface FinancialAnalysisSection {
  initialCapex: number;
  fixedAnnualOm: number;
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
   * would be redundant, not more "real". This is NOT the same as Priority 4's
   * scenario-vs-scenario comparison, which re-runs the full dispatch+financial
   * pipeline for independently-configured saved scenarios.
   */
  scenarios: SensitivityScenario[];
}

export interface EngineeringReport {
  generatedAt: string;
  reportModelVersion: string;
  mode: 'quick' | 'interval' | 'legacy';
  executiveSummary: ExecutiveSummarySection;
  technicalDesign: TechnicalDesignSection;
  financialAnalysis: FinancialAnalysisSection;
  sensitivityAnalysis: SensitivityAnalysisSection;
  warningCount: number;
  warnings: Array<{ level: string; message: string }>;
}
