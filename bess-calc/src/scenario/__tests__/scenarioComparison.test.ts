import { describe, it, expect } from 'vitest';
import { compareScenarios, assessComparability, fingerprintDataset, toScenarioMetrics } from '../index';
import { ScenarioComparisonEntry } from '../types';
import { runIntervalDispatch } from '../../engine/dispatchEngine';
import { runMultiYearSimulation } from '../../engine/multiYearSimulation';
import { calculateFinancialMetrics } from '../../engine/financialEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeFlatDay } from '../../engine/__tests__/fixtures';
import { BessSystemInput, FinancialInput, TariffInput } from '../../types/bess';

const ALL_PRIORITIES = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'] as const;

function peakyDay() {
  const intervals = makeFlatDay({ loadKw: 150, loadKva: 150, gridAvailable: true });
  for (let i = 76; i < 80; i++) intervals[i] = { ...intervals[i], loadKw: 450, loadKva: 450 };
  return intervals;
}

/** Runs the real engine end to end so the comparison is exercised on genuine output, not hand-written numbers. */
function evaluate(
  scenarioId: string,
  scenarioName: string,
  system: BessSystemInput,
  overrides: { tariff?: TariffInput; financial?: FinancialInput; datasetId?: string } = {}
): ScenarioComparisonEntry {
  const tariff = overrides.tariff ?? makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0 });
  const financial = overrides.financial ?? makeFinancial();
  const diesel = makeDiesel({ enableDieselDisplacement: false });
  const solar = makeSolar({ enableSolarIntegration: false });
  const intervals = peakyDay();

  const run = runIntervalDispatch(intervals, system, tariff, diesel, solar, financial, [...ALL_PRIORITIES], 15);
  const financialResult = calculateFinancialMetrics(run.savings, run.technical, financial, system);
  const multiYear = runMultiYearSimulation({
    intervals, system, tariff, diesel, solar, financial, priorities: [...ALL_PRIORITIES], intervalMinutes: 15
  });

  return {
    scenarioId,
    scenarioName,
    system,
    tariff,
    financialInput: financial,
    savings: run.savings,
    technical: run.technical,
    financial: financialResult,
    sohForecast: multiYear.sohForecast,
    confidenceGrade: 'B',
    warningCount: 0,
    dataset: fingerprintDataset(intervals, 15, overrides.datasetId ?? 'dataset-1')
  };
}

function smallDesign() {
  return evaluate('11111111-1111-1111-1111-111111111111', 'Small 60 kW / 130 kWh', makeSystem({ ratedPowerKw: 60, ratedEnergyKwh: 130 }));
}
function largeDesign() {
  return evaluate('22222222-2222-2222-2222-222222222222', 'Large 200 kW / 500 kWh', makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 500 }));
}

describe('scenario comparison metrics', () => {
  it('reports every required metric per scenario', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    expect(result.scenarios).toHaveLength(2);

    for (const metrics of result.scenarios) {
      expect(metrics.capex).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.annualNetSaving)).toBe(true);
      expect(Number.isFinite(metrics.peakReductionKw)).toBe(true);
      expect(Number.isFinite(metrics.energyArbitrageSaving)).toBe(true);
      expect(Number.isFinite(metrics.npv)).toBe(true);
      expect(metrics.irrPct === null || Number.isFinite(metrics.irrPct)).toBe(true);
      expect(Number.isFinite(metrics.roiPct)).toBe(true);
      expect(Number.isFinite(metrics.lcosPerKwh)).toBe(true);
      expect(metrics.simplePaybackYears === null || Number.isFinite(metrics.simplePaybackYears)).toBe(true);
      expect(metrics.batterySoh).not.toBeNull();
      expect(metrics.batterySoh!.endOfProjectSohPct).toBeLessThanOrEqual(100);
    }
  });

  it('is machine-readable: the whole result round-trips through JSON unchanged', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('derives peak reduction from the real dispatch result, not from the design size', () => {
    const entry = largeDesign();
    const metrics = toScenarioMetrics(entry);
    expect(metrics.peakReductionKw).toBeCloseTo(entry.technical.peakBeforeKw - entry.technical.peakAfterKw, 9);
    expect(metrics.peakReductionPct).toBeCloseTo((metrics.peakReductionKw / entry.technical.peakBeforeKw) * 100, 9);
  });

  it('returns null battery SOH rather than a fabricated one when no forecast was run', () => {
    const entry = { ...smallDesign(), sohForecast: undefined };
    expect(toScenarioMetrics(entry).batterySoh).toBeNull();
  });

  it('a larger battery shaves more peak than a smaller one on the same profile', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    const small = result.scenarios.find(s => s.scenarioName.startsWith('Small'))!;
    const large = result.scenarios.find(s => s.scenarioName.startsWith('Large'))!;
    expect(large.peakReductionKw).toBeGreaterThan(small.peakReductionKw);
  });
});

describe('comparability gating', () => {
  it('accepts two designs that differ only in battery sizing', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    expect(result.comparability.comparable).toBe(true);
    expect(result.comparability.reasons).toEqual([]);
    expect(result.comparability.heldConstant).toContain('tariff (currency, energy charge, demand charge, contract demand, TOU mode)');
    expect(result.ranking).not.toBeNull();
  });

  it('rejects a comparison across different tariffs and withholds the ranking', () => {
    const cheap = evaluate('11111111-1111-1111-1111-111111111111', 'Cheap tariff', makeSystem(), {
      tariff: makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0, energyChargePerKwh: 5 })
    });
    const expensive = evaluate('22222222-2222-2222-2222-222222222222', 'Expensive tariff', makeSystem(), {
      tariff: makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0, energyChargePerKwh: 15 })
    });

    const result = compareScenarios([cheap, expensive]);
    expect(result.comparability.comparable).toBe(false);
    expect(result.comparability.reasons.join(' ')).toContain('different energy charges');
    expect(result.ranking).toBeNull();
    // Per-scenario metrics remain individually valid and must still be returned.
    expect(result.scenarios).toHaveLength(2);
  });

  it('rejects a comparison across different discount rates', () => {
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'A', makeSystem(), { financial: makeFinancial({ discountRatePct: 8 }) });
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'B', makeSystem(), { financial: makeFinancial({ discountRatePct: 15 }) });

    const result = compareScenarios([a, b]);
    expect(result.comparability.reasons.join(' ')).toContain('different discount rates');
    expect(result.ranking).toBeNull();
  });

  it('rejects a comparison across different project lives, naming the unequal-life problem', () => {
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'A', makeSystem({ projectLifeYears: 10 }));
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'B', makeSystem({ projectLifeYears: 15 }));

    const result = compareScenarios([a, b]);
    expect(result.comparability.reasons.join(' ')).toContain('unequal-life');
    expect(result.ranking).toBeNull();
  });

  it('rejects a comparison across different interval datasets', () => {
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'A', makeSystem(), { datasetId: 'dataset-A' });
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'B', makeSystem(), { datasetId: 'dataset-B' });

    const result = compareScenarios([a, b]);
    expect(result.comparability.reasons.join(' ')).toContain('different interval datasets');
  });

  it('rejects a comparison across different currencies', () => {
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'A', makeSystem());
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'B', makeSystem(), {
      tariff: makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0, currency: '$' })
    });

    expect(compareScenarios([a, b]).comparability.reasons.join(' ')).toContain('different currencies');
  });

  it('rejects fewer than two scenarios', () => {
    expect(assessComparability([smallDesign()]).comparable).toBe(false);
    expect(assessComparability([]).reasons.join(' ')).toContain('At least two scenarios');
  });

  it('rejects the same scenario supplied twice', () => {
    const entry = smallDesign();
    expect(assessComparability([entry, { ...entry }]).reasons.join(' ')).toContain('cannot be compared against itself');
  });

  it('does not gate on battery sizing, chemistry or CapEx, since those are the design under test', () => {
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'LFP small', makeSystem({ ratedEnergyKwh: 130, batteryChemistry: 'LFP' }), { financial: makeFinancial({ initialCapex: 2_000_000 }) });
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'NMC large', makeSystem({ ratedEnergyKwh: 500, batteryChemistry: 'NMC' }), { financial: makeFinancial({ initialCapex: 7_000_000 }) });

    expect(compareScenarios([a, b]).comparability.comparable).toBe(true);
  });
});

describe('ranking', () => {
  it('ranks by NPV, highest first, and recommends that scenario', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    const ranking = result.ranking!;
    const npvById = new Map(result.scenarios.map(s => [s.scenarioId, s.npv]));

    for (let i = 1; i < ranking.byNpv.length; i++) {
      expect(npvById.get(ranking.byNpv[i - 1])!).toBeGreaterThanOrEqual(npvById.get(ranking.byNpv[i])!);
    }
    expect(ranking.recommendedScenarioId).toBe(ranking.byNpv[0]);
    expect(ranking.recommendationBasis).toContain('net present value');
  });

  it('warns explicitly when even the best scenario has a negative NPV', () => {
    const ruinous = makeFinancial({ initialCapex: 500_000_000 });
    const a = evaluate('11111111-1111-1111-1111-111111111111', 'A', makeSystem({ ratedEnergyKwh: 130 }), { financial: ruinous });
    const b = evaluate('22222222-2222-2222-2222-222222222222', 'B', makeSystem({ ratedEnergyKwh: 500 }), { financial: ruinous });

    const result = compareScenarios([a, b]);
    expect(result.scenarios.every(s => s.npv < 0)).toBe(true);
    expect(result.ranking!.recommendationBasis).toContain('least-bad');
  });

  it('places a never-paying-back scenario last rather than treating a null payback as zero', () => {
    const good = evaluate('11111111-1111-1111-1111-111111111111', 'Good', makeSystem({ ratedEnergyKwh: 500 }));
    const hopeless = evaluate('22222222-2222-2222-2222-222222222222', 'Hopeless', makeSystem({ ratedEnergyKwh: 500 }), {
      financial: makeFinancial({ initialCapex: 500_000_000 })
    });
    // Same discount rate/project life/tariff, so this stays comparable; only CapEx differs.
    const result = compareScenarios([good, hopeless]);
    const hopelessMetrics = result.scenarios.find(s => s.scenarioName === 'Hopeless')!;

    expect(hopelessMetrics.simplePaybackYears).toBeNull();
    expect(result.ranking!.bySimplePayback[result.ranking!.bySimplePayback.length - 1]).toBe(hopelessMetrics.scenarioId);
  });

  it('orders LCOS lowest-first, the opposite direction to NPV', () => {
    const result = compareScenarios([smallDesign(), largeDesign()]);
    const lcosById = new Map(result.scenarios.map(s => [s.scenarioId, s.lcosPerKwh]));
    const ordered = result.ranking!.byLcos.map(id => lcosById.get(id)!).filter(v => v > 0);

    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1]).toBeLessThanOrEqual(ordered[i]);
    }
  });
});

describe('fingerprintDataset', () => {
  it('summarises total energy and peak from the interval series', () => {
    const intervals = makeFlatDay({ loadKw: 100, gridAvailable: true });
    intervals[0] = { ...intervals[0], loadKw: 400 };

    const fingerprint = fingerprintDataset(intervals, 15, 'dataset-x');
    expect(fingerprint.datasetId).toBe('dataset-x');
    expect(fingerprint.intervalCount).toBe(96);
    expect(fingerprint.intervalMinutes).toBe(15);
    expect(fingerprint.peakLoadKw).toBe(400);
    expect(fingerprint.totalLoadKwh).toBeCloseTo((95 * 100 + 400) * 0.25, 6);
  });
});
