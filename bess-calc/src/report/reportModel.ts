import { SimulationResult } from '../types/bess';
import { EngineeringReport } from './types';
import { buildSensitivityMatrix } from './sensitivityAnalysis';

export const REPORT_MODEL_VERSION = '1.0.0';

/**
 * Builds the structured JSON engineering report from a completed SimulationResult.
 * Pure function, no I/O - every number here traces back to the real engine
 * (dispatchEngine/financialEngine/validationEngine), never a hardcoded assumption.
 * This is the floor deliverable per the productisation brief: PDF/print is a
 * presentation concern layered on top (see ExportReportModal.tsx), not reinvented here.
 */
export function buildEngineeringReport(result: SimulationResult): EngineeringReport {
  const { system, technical, financial, dispatchPriorities, warnings, mode, confidenceGrade, confidenceGradeReason, savings } = result;

  const peakReductionKw = technical.peakBeforeKw - technical.peakAfterKw;
  const peakReductionPct = technical.peakBeforeKw > 0 ? (peakReductionKw / technical.peakBeforeKw) * 100 : 0;

  return {
    generatedAt: new Date().toISOString(),
    reportModelVersion: REPORT_MODEL_VERSION,
    mode,
    executiveSummary: {
      recommendedPowerKw: system.ratedPowerKw,
      recommendedEnergyKwh: system.ratedEnergyKwh,
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
      loadProfile: {
        peakBeforeKw: technical.peakBeforeKw,
        peakAfterKw: technical.peakAfterKw,
        peakReductionKw,
        peakReductionPct: Math.round(peakReductionPct * 10) / 10
      },
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
      }
    },
    financialAnalysis: {
      initialCapex: financial.initialInvestment,
      fixedAnnualOm: savings.omCost,
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
    warningCount: warnings.length,
    warnings: warnings.map(w => ({ level: w.level, message: w.message }))
  };
}
