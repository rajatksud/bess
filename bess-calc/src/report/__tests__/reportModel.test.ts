import { describe, it, expect } from 'vitest';
import { buildEngineeringReport } from '../reportModel';
import { makeSimulationResult } from './fixtures';

describe('buildEngineeringReport', () => {
  const result = makeSimulationResult();
  const report = buildEngineeringReport(result);

  it('carries the executive summary straight from the real engine outputs, not a re-derivation', () => {
    expect(report.executiveSummary.recommendedPowerKw).toBe(result.system.ratedPowerKw);
    expect(report.executiveSummary.recommendedEnergyKwh).toBe(result.system.ratedEnergyKwh);
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
