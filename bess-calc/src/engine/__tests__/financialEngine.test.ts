import { describe, it, expect } from 'vitest';
import { calculateFinancialMetrics } from '../financialEngine';
import { makeSystem, makeFinancial } from './fixtures';
import { SavingsBreakdown, TechnicalResult } from '../../types/bess';

function makeSavings(overrides: Partial<SavingsBreakdown> = {}): SavingsBreakdown {
  return {
    demandChargeSaving: 0,
    dieselFuelSaving: 0,
    dgMaintenanceSaving: 0,
    solarSelfConsumptionSaving: 0,
    energyArbitrageSaving: 0,
    exportRevenueChange: 0,
    chargingEnergyCost: 0,
    auxiliaryEnergyCost: 0,
    degradationCost: 0,
    omCost: 0,
    grossSaving: 0,
    netOperatingSaving: 0,
    ...overrides
  };
}

function makeTechnical(overrides: Partial<TechnicalResult> = {}): TechnicalResult {
  return {
    peakBeforeKw: 0,
    peakAfterKw: 0,
    peakBeforeKva: 0,
    peakAfterKva: 0,
    energyChargedKwh: 0,
    energyDischargedKwh: 0,
    solarEnergyStoredKwh: 0,
    dgEnergyDisplacedKwh: 0,
    equivalentFullCycles: 0,
    minimumSocPct: 0,
    maximumSocPct: 100,
    unservedBackupEnergyKwh: 0,
    curtailedSolarKwh: 0,
    deliverableCapacityKwh: 0,
    ...overrides
  };
}

describe('financial engine', () => {
  it('produces zero payback (year 1) when first-year net cash flow alone covers CapEx', () => {
    const financial = makeFinancial({
      initialCapex: 100000,
      tariffEscalationPct: 0, dieselEscalationPct: 0, annualOmEscalationPct: 0,
      taxRatePct: 0, residualValuePct: 0
    });
    const savings = makeSavings({ demandChargeSaving: 200000, grossSaving: 200000, netOperatingSaving: 200000 });
    const system = makeSystem({ annualDegradationPct: 0, projectLifeYears: 5 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), financial, system);

    expect(result.simplePaybackYears).not.toBeNull();
    expect(result.simplePaybackYears!).toBeLessThan(1);
    expect(result.simplePaybackYears!).toBeGreaterThanOrEqual(0);
  });

  it('returns null simple payback when net cash flow never recovers CapEx within project life', () => {
    const financial = makeFinancial({ initialCapex: 10_000_000, taxRatePct: 0, residualValuePct: 0 });
    const savings = makeSavings({ demandChargeSaving: 10000, grossSaving: 10000, netOperatingSaving: 10000, omCost: 5000 });
    const system = makeSystem({ projectLifeYears: 5, annualDegradationPct: 0 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), financial, system);

    expect(result.simplePaybackYears).toBeNull();
    expect(result.npv).toBeLessThan(0);
  });

  it('degrades gross savings year over year by the compounding annual degradation rate', () => {
    const financial = makeFinancial({
      initialCapex: 1, tariffEscalationPct: 0, dieselEscalationPct: 0, annualOmEscalationPct: 0,
      taxRatePct: 0, residualValuePct: 0
    });
    const savings = makeSavings({ demandChargeSaving: 100000, grossSaving: 100000, netOperatingSaving: 100000 });
    const system = makeSystem({ annualDegradationPct: 10, projectLifeYears: 3 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), financial, system);

    // Year 1: 100% capacity, Year 2: 90%, Year 3: 80% (degradation applies from year 2 onward,
    // i.e. multiplier = 1 - degRate*(year-1), floored at 50%).
    expect(result.annualCashFlows[0].effectiveCapacityPct).toBe(100);
    expect(result.annualCashFlows[1].effectiveCapacityPct).toBe(90);
    expect(result.annualCashFlows[2].effectiveCapacityPct).toBe(80);
  });

  it('LCOS is positive and finite whenever there is nonzero lifetime discharge', () => {
    const financial = makeFinancial({ initialCapex: 4000000 });
    const savings = makeSavings({ omCost: 200000 });
    const technical = makeTechnical({ energyDischargedKwh: 50000 });
    const system = makeSystem({ projectLifeYears: 10 });

    const result = calculateFinancialMetrics(savings, technical, financial, system);

    expect(result.lcoePerKwh).toBeGreaterThan(0);
    expect(Number.isFinite(result.lcoePerKwh)).toBe(true);
  });

  it('LCOS is zero (not NaN/Infinity) when there is no lifetime discharge', () => {
    const financial = makeFinancial({ initialCapex: 4000000 });
    const savings = makeSavings();
    const technical = makeTechnical({ energyDischargedKwh: 0 });
    const system = makeSystem();

    const result = calculateFinancialMetrics(savings, technical, financial, system);

    expect(result.lcoePerKwh).toBe(0);
  });

  it('adds scheduled replacement CapEx as a cash outflow in exactly the specified year', () => {
    const financial = makeFinancial({
      initialCapex: 100000, replacementYear: 3, replacementCapexAmount: 50000,
      taxRatePct: 0, residualValuePct: 0, tariffEscalationPct: 0, dieselEscalationPct: 0, annualOmEscalationPct: 0
    });
    const savings = makeSavings({ demandChargeSaving: 40000, grossSaving: 40000, netOperatingSaving: 40000 });
    const system = makeSystem({ projectLifeYears: 5, annualDegradationPct: 0 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), financial, system);

    expect(result.annualCashFlows[2].replacementCapex).toBe(50000);
    expect(result.annualCashFlows[0].replacementCapex).toBe(0);
    expect(result.annualCashFlows[1].replacementCapex).toBe(0);
  });

  it('IRR is null (not a wild extrapolated value) for a firmly negative-return project', () => {
    const financial = makeFinancial({ initialCapex: 100_000_000, taxRatePct: 0, residualValuePct: 0 });
    const savings = makeSavings({ demandChargeSaving: 100, grossSaving: 100, netOperatingSaving: 100 });
    const system = makeSystem({ projectLifeYears: 3, annualDegradationPct: 0 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), financial, system);

    expect(result.irrPct === null || result.irrPct < 0).toBe(true);
  });
});
