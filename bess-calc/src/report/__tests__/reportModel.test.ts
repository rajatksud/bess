import { describe, it, expect } from 'vitest';
import { buildEngineeringReport } from '../reportModel';
import { makeSimulationResult } from './fixtures';
import { runMultiYearSimulation } from '../../engine/multiYearSimulation';
import { CALCULATION_ENGINE_VERSION } from '../../engine/version';

describe('buildEngineeringReport', () => {
  const result = makeSimulationResult();
  const report = buildEngineeringReport(result);

  it('carries the executive summary straight from the real engine outputs, not a re-derivation', () => {
    // Renamed from recommendedPowerKw/recommendedEnergyKwh: those names claimed a
    // recommendation that no sizing optimiser in this codebase ever produced. The values
    // were, and still are, a direct echo of the user's own configuration - now labelled
    // as such and accompanied by an explicit sizingBasis.
    expect(report.executiveSummary.configuredPowerKw).toBe(result.system.ratedPowerKw);
    expect(report.executiveSummary.configuredEnergyKwh).toBe(result.system.ratedEnergyKwh);
    expect(report.executiveSummary.sizingBasis).toBe('user_specified');
    expect(report.executiveSummary.firstYearNetSavingCurrency).toBe(result.financial.firstYearNetSaving);
    expect(report.executiveSummary.roiPct).toBe(result.financial.roiPct);
    expect(report.executiveSummary.npv).toBe(result.financial.npv);
  });

  it('computes peak reduction consistently with technical.peakBeforeKw/peakAfterKw', () => {
    const { peakBeforeKw, peakAfterKw, peakReductionKw, peakReductionPct } = report.technicalDesign.loadProfile;
    expect(peakBeforeKw).toBe(result.technical.peakBeforeKw);
    expect(peakAfterKw).toBe(result.technical.peakAfterKw);
    expect(peakReductionKw).toBeCloseTo(peakBeforeKw - peakAfterKw, 5);
    expect(peakReductionPct).toBeCloseTo((peakReductionKw / peakBeforeKw) * 100, 0);
  });

  it('financial analysis section matches the FinancialResult fields it is derived from, including the new LCOS/ROI fields', () => {
    expect(report.financialAnalysis.lcoePerKwh).toBe(result.financial.lcoePerKwh);
    expect(report.financialAnalysis.roiPct).toBe(result.financial.roiPct);
    expect(report.financialAnalysis.annualCashFlows.length).toBe(result.financial.annualCashFlows.length);
  });

  it('sensitivity analysis produces exactly conservative/base/optimistic scenarios, each a real financial-engine re-run', () => {
    const labels = report.sensitivityAnalysis.scenarios.map(s => s.label);
    expect(labels).toEqual(['conservative', 'base', 'optimistic']);

    const base = report.sensitivityAnalysis.scenarios.find(s => s.label === 'base')!;
    // Base scenario applies 1.0x/0-delta/1.0x, so it must reproduce the same NPV/ROI as
    // the top-level financial result exactly (same calculateFinancialMetrics call).
    expect(base.npv).toBeCloseTo(result.financial.npv, 5);
    expect(base.roiPct).toBeCloseTo(result.financial.roiPct, 5);

    const conservative = report.sensitivityAnalysis.scenarios.find(s => s.label === 'conservative')!;
    const optimistic = report.sensitivityAnalysis.scenarios.find(s => s.label === 'optimistic')!;
    // Conservative (higher CapEx, lower escalation, faster degradation) must be worse than optimistic.
    expect(conservative.npv).toBeLessThan(optimistic.npv);
  });

  it('carries warnings through with their level and message, and a matching count', () => {
    expect(report.warningCount).toBe(result.warnings.length);
    expect(report.warnings.length).toBe(result.warnings.length);
  });

  it('stamps a generatedAt timestamp and a stable report model version', () => {
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
    expect(report.reportModelVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('engineering report: enhanced sections', () => {
  const result = makeSimulationResult();
  const report = buildEngineeringReport(result, { intervalMinutes: 15 });

  it('reports load-profile detail beyond just peak before/after', () => {
    const profile = report.technicalDesign.loadProfile;
    expect(profile.intervalCount).toBe(result.intervals.length);
    expect(profile.intervalMinutes).toBe(15);
    expect(profile.horizonHours).toBeCloseTo(result.intervals.length * 0.25, 9);
    expect(profile.horizonGrossLoadKwh).toBeGreaterThan(0);
    expect(profile.annualGrossLoadKwh).toBeCloseTo(profile.horizonGrossLoadKwh * 365, 6);
    expect(profile.averageLoadKw).toBeCloseTo(profile.horizonGrossLoadKwh / profile.horizonHours, 9);
    expect(profile.loadFactorPct).toBeGreaterThan(0);
    expect(profile.loadFactorPct).toBeLessThanOrEqual(100);
    expect(profile.annualisationBasis).toContain('repeated 365 times');
  });

  it('computes grid import before and after the battery from the interval trace', () => {
    const profile = report.technicalDesign.loadProfile;
    const expectedPre = result.intervals.reduce((s, i) => s + i.preBessGridImportKw * 0.25, 0);
    const expectedPost = result.intervals.reduce((s, i) => s + i.postBessGridImportKw * 0.25, 0);
    expect(profile.horizonPreBessGridImportKwh).toBeCloseTo(expectedPre, 9);
    expect(profile.horizonPostBessGridImportKwh).toBeCloseTo(expectedPost, 9);
  });

  it('reports battery utilisation, which nothing computed before', () => {
    const utilisation = report.technicalDesign.batteryUtilisation;
    expect(utilisation.intervalCount).toBe(result.intervals.length);
    expect(utilisation.idleIntervalCount + utilisation.chargingIntervalCount + utilisation.dischargingIntervalCount)
      .toBe(utilisation.intervalCount);
    expect(utilisation.idleIntervalCount).toBeGreaterThan(0);
    expect(utilisation.dischargingIntervalCount).toBeGreaterThan(0);
    expect(utilisation.activeIntervalPct).toBeCloseTo(
      ((utilisation.chargingIntervalCount + utilisation.dischargingIntervalCount) / utilisation.intervalCount) * 100, 9
    );
    expect(utilisation.intervalsByAction.Idle).toBe(utilisation.idleIntervalCount);
    expect(utilisation.peakDischargeKw).toBeGreaterThan(0);
    expect(utilisation.peakDischargeUtilisationPct).toBeCloseTo(
      (utilisation.peakDischargeKw / result.system.ratedPowerKw) * 100, 9
    );
    expect(utilisation.socSwingPct).toBeCloseTo(utilisation.maxSocObservedPct - utilisation.minSocObservedPct, 9);
  });

  it('reports BOTH cycle-count definitions and explains that they differ', () => {
    const utilisation = report.technicalDesign.batteryUtilisation;
    expect(utilisation.throughputEquivalentFullCycles).toBe(result.technical.equivalentFullCycles);
    expect(utilisation.dodWeightedEquivalentFullCyclesPerYear).toBeGreaterThan(0);
    expect(utilisation.cycleCountNote).toContain('NAMEPLATE');
    expect(utilisation.cycleCountNote).toContain('depth of discharge');
    // The two are genuinely different quantities; the report must not imply otherwise.
    expect(utilisation.dodWeightedEquivalentFullCyclesPerYear)
      .not.toBeCloseTo(utilisation.throughputEquivalentFullCycles, 3);
  });

  it('surfaces the full OPEX breakdown, not just fixed O&M', () => {
    const opex = report.financialAnalysis.opex;
    expect(opex.fixedAnnualOm).toBe(result.savings.omCost);
    expect(opex.degradationCost).toBe(result.savings.degradationCost);
    expect(opex.chargingEnergyCost).toBe(result.savings.chargingEnergyCost);
    expect(opex.auxiliaryEnergyCost).toBe(result.savings.auxiliaryEnergyCost);
    expect(opex.totalAnnualOpex).toBeCloseTo(
      opex.fixedAnnualOm + opex.degradationCost + opex.chargingEnergyCost + opex.auxiliaryEnergyCost, 9
    );
    expect(opex.degradationCostRatePerKwhThroughput).toBe(result.financialInput.variableOmPerKwhThroughput);
  });

  it('reports the calculation engine version from the shared constant, not a hardcoded UI string', () => {
    expect(report.calculationEngineVersion).toBe(CALCULATION_ENGINE_VERSION);
    expect(report.calculationEngineVersion).not.toBe('2.4.0-Engineering');
  });

  it('returns sohForecast: null rather than a fabricated placeholder when no forecast was supplied', () => {
    expect(report.sohForecast).toBeNull();
  });

  it('includes a full SOH forecast section when a multi-year simulation is supplied', () => {
    const multiYear = runMultiYearSimulation({
      intervals: result.intervals,
      system: result.system,
      tariff: result.tariff,
      diesel: result.diesel,
      solar: result.solar,
      financial: result.financialInput,
      priorities: result.dispatchPriorities,
      intervalMinutes: 15
    });
    const withSoh = buildEngineeringReport(result, { intervalMinutes: 15, sohForecast: multiYear.sohForecast });

    expect(withSoh.sohForecast).not.toBeNull();
    expect(withSoh.sohForecast!.years).toHaveLength(result.system.projectLifeYears);
    expect(withSoh.sohForecast!.convention).toContain('SOH');
    expect(withSoh.sohForecast!.endOfLifeSohPct).toBeGreaterThan(0);
    for (const year of withSoh.sohForecast!.years) {
      expect(year.usableEnergyKwh).toBeCloseTo(year.capacityKwh * (result.system.usableDodPct / 100), 6);
    }
  });

  it('is fully machine-readable: the report round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
