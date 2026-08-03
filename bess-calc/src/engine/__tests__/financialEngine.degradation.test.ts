import { describe, it, expect } from 'vitest';
import { calculateFinancialMetrics, DegradedYearInput, MIN_MODEL_VALID_CAPACITY_FACTOR } from '../financialEngine';
import { runMultiYearSimulation } from '../multiYearSimulation';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeFlatDay } from './fixtures';
import { SavingsBreakdown, TechnicalResult } from '../../types/bess';

const ALL_PRIORITIES = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'] as const;

function makeSavings(overrides: Partial<SavingsBreakdown> = {}): SavingsBreakdown {
  const base: SavingsBreakdown = {
    demandChargeSaving: 500_000,
    dieselFuelSaving: 200_000,
    dgMaintenanceSaving: 50_000,
    solarSelfConsumptionSaving: 100_000,
    energyArbitrageSaving: 150_000,
    exportRevenueChange: 0,
    chargingEnergyCost: 80_000,
    auxiliaryEnergyCost: 20_000,
    degradationCost: 30_000,
    omCost: 200_000,
    grossSaving: 0,
    netOperatingSaving: 0
  };
  const merged = { ...base, ...overrides };
  merged.grossSaving =
    merged.demandChargeSaving + merged.dieselFuelSaving + merged.dgMaintenanceSaving +
    merged.solarSelfConsumptionSaving + merged.energyArbitrageSaving;
  merged.netOperatingSaving =
    merged.grossSaving - merged.chargingEnergyCost - merged.auxiliaryEnergyCost -
    merged.degradationCost - merged.omCost;
  return merged;
}

function makeTechnical(overrides: Partial<TechnicalResult> = {}): TechnicalResult {
  return {
    peakBeforeKw: 400, peakAfterKw: 300, peakBeforeKva: 400, peakAfterKva: 300,
    energyChargedKwh: 100_000, energyDischargedKwh: 90_000,
    solarEnergyStoredKwh: 20_000, dgEnergyDisplacedKwh: 10_000,
    equivalentFullCycles: 345, minimumSocPct: 25, maximumSocPct: 100,
    unservedBackupEnergyKwh: 0, curtailedSolarKwh: 0, deliverableCapacityKwh: 234.9,
    ...overrides
  };
}

/** Flat SOH across every year: the degradedYears path with degradation switched off. */
function flatDegradedYears(savings: SavingsBreakdown, energyDischargedKwh: number, years: number): DegradedYearInput[] {
  return Array.from({ length: years }, (_, i) => ({
    year: i + 1,
    savings,
    energyDischargedKwh,
    sohPctStartOfYear: 100
  }));
}

describe('financial engine: the legacy flat-degradation path is untouched', () => {
  it('omitting options produces the same result as passing an empty options object', () => {
    const savings = makeSavings();
    const technical = makeTechnical();
    const financial = makeFinancial();
    const system = makeSystem();

    expect(calculateFinancialMetrics(savings, technical, financial, system, {}))
      .toEqual(calculateFinancialMetrics(savings, technical, financial, system));
  });

  it('an empty degradedYears array falls back to the legacy path rather than silently zeroing savings', () => {
    const savings = makeSavings();
    const technical = makeTechnical();

    expect(calculateFinancialMetrics(savings, technical, makeFinancial(), makeSystem(), { degradedYears: [] }))
      .toEqual(calculateFinancialMetrics(savings, technical, makeFinancial(), makeSystem()));
  });

  it('still applies the documented model-validity floor to the flat multiplier', () => {
    // 12%/yr over 10 years would reach 0.0 by year 9 without the floor.
    const system = makeSystem({ annualDegradationPct: 12, projectLifeYears: 10 });
    const result = calculateFinancialMetrics(makeSavings(), makeTechnical(), makeFinancial(), system);

    const lastYear = result.annualCashFlows[result.annualCashFlows.length - 1];
    expect(lastYear.effectiveCapacityPct).toBe(Math.round(MIN_MODEL_VALID_CAPACITY_FACTOR * 100));
    expect(lastYear.grossSaving).toBeGreaterThan(0);
  });
});

describe('TRAP 1: an SOH forecast reaching zero must not zero the whole financial model', () => {
  it('a dead-battery year still floors at the documented model-validity factor, not at zero', () => {
    const savings = makeSavings();
    const system = makeSystem({ annualDegradationPct: 50, projectLifeYears: 10 });

    const result = calculateFinancialMetrics(savings, makeTechnical(), makeFinancial(), system);

    // Without the floor, 1 - 0.5*(year-1) is negative from year 4 onward, which would
    // produce negative savings streams and a meaningless NPV.
    expect(result.annualCashFlows.every(cf => cf.grossSaving > 0)).toBe(true);
    expect(result.annualCashFlows.every(cf => cf.effectiveCapacityPct >= 50)).toBe(true);
    expect(Number.isFinite(result.npv)).toBe(true);
  });

  it('reports the real state of health per year on the simulated path, rather than a hardcoded 100', () => {
    const savings = makeSavings();
    const degradedYears: DegradedYearInput[] = [
      { year: 1, savings, energyDischargedKwh: 90_000, sohPctStartOfYear: 100 },
      { year: 2, savings: makeSavings({ demandChargeSaving: 450_000 }), energyDischargedKwh: 85_000, sohPctStartOfYear: 94 },
      { year: 3, savings: makeSavings({ demandChargeSaving: 400_000 }), energyDischargedKwh: 80_000, sohPctStartOfYear: 88 }
    ];

    const result = calculateFinancialMetrics(
      savings, makeTechnical(), makeFinancial(), makeSystem({ projectLifeYears: 3 }), { degradedYears }
    );

    expect(result.annualCashFlows.map(cf => cf.effectiveCapacityPct)).toEqual([100, 94, 88]);
  });
});

describe('TRAP 2: LCOS must not derate throughput twice', () => {
  const years = 10;

  it('flat simulated years reproduce the legacy path with degradation switched off', () => {
    const savings = makeSavings();
    const technical = makeTechnical();
    const financial = makeFinancial();

    const legacyNoDegradation = calculateFinancialMetrics(
      savings, technical, financial, makeSystem({ annualDegradationPct: 0, projectLifeYears: years })
    );
    const simulatedFlat = calculateFinancialMetrics(
      savings, technical, financial, makeSystem({ annualDegradationPct: 0, projectLifeYears: years }),
      { degradedYears: flatDegradedYears(savings, technical.energyDischargedKwh, years) }
    );

    expect(simulatedFlat.npv).toBeCloseTo(legacyNoDegradation.npv, 6);
    expect(simulatedFlat.lcoePerKwh).toBeCloseTo(legacyNoDegradation.lcoePerKwh, 9);
    expect(simulatedFlat.irrPct).toBe(legacyNoDegradation.irrPct);
  });

  it('the simulated path ignores annualDegradationPct entirely, because degradation is already in the per-year figures', () => {
    const savings = makeSavings();
    const technical = makeTechnical();
    const degradedYears = flatDegradedYears(savings, technical.energyDischargedKwh, years);

    const withFlatRate = calculateFinancialMetrics(
      savings, technical, makeFinancial(), makeSystem({ annualDegradationPct: 3, projectLifeYears: years }), { degradedYears }
    );
    const withoutFlatRate = calculateFinancialMetrics(
      savings, technical, makeFinancial(), makeSystem({ annualDegradationPct: 0, projectLifeYears: years }), { degradedYears }
    );

    expect(withFlatRate.npv).toBeCloseTo(withoutFlatRate.npv, 9);
    expect(withFlatRate.lcoePerKwh).toBeCloseTo(withoutFlatRate.lcoePerKwh, 9);
  });

  it('the LCOS denominator equals the discounted sum of the supplied per-year throughput, not a re-derated version of it', () => {
    const savings = makeSavings();
    const technical = makeTechnical();
    const financial = makeFinancial({ discountRatePct: 12 });
    const system = makeSystem({ annualDegradationPct: 2, projectLifeYears: years });

    // A genuinely declining throughput series, as a real degraded dispatch would produce.
    const degradedYears: DegradedYearInput[] = Array.from({ length: years }, (_, i) => ({
      year: i + 1,
      savings,
      energyDischargedKwh: 90_000 * (1 - 0.02 * i),
      sohPctStartOfYear: 100 - 2 * i
    }));

    const result = calculateFinancialMetrics(savings, technical, financial, system, { degradedYears });

    const discountRate = 0.12;
    const expectedDenominator = degradedYears.reduce(
      (sum, entry) => sum + entry.energyDischargedKwh / Math.pow(1 + discountRate, entry.year), 0
    );
    // The double-counted denominator would additionally multiply each year by
    // (1 - 0.02*(y-1)) - a materially smaller number and hence a larger LCOS.
    const doubleCountedDenominator = degradedYears.reduce(
      (sum, entry) => sum + (entry.energyDischargedKwh * Math.max(0.5, 1 - 0.02 * (entry.year - 1))) / Math.pow(1 + discountRate, entry.year), 0
    );

    const discountedLifetimeCost = result.lcoePerKwh * expectedDenominator;
    expect(result.lcoePerKwh).toBeCloseTo(discountedLifetimeCost / expectedDenominator, 9);
    expect(discountedLifetimeCost / doubleCountedDenominator).toBeGreaterThan(result.lcoePerKwh);
    expect(expectedDenominator).toBeGreaterThan(doubleCountedDenominator);
  });

  it('end to end: a real multi-year simulation feeds the financial engine without double counting', () => {
    const intervals = makeFlatDay({ loadKw: 150, loadKva: 150, gridAvailable: true });
    for (let i = 76; i < 78; i++) intervals[i] = { ...intervals[i], loadKw: 450, loadKva: 450 };

    const system = makeSystem({ projectLifeYears: 10 });
    const multi = runMultiYearSimulation({
      intervals,
      system,
      tariff: makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0 }),
      diesel: makeDiesel({ enableDieselDisplacement: false }),
      solar: makeSolar({ enableSolarIntegration: false }),
      financial: makeFinancial(),
      priorities: [...ALL_PRIORITIES],
      intervalMinutes: 15,
      batteryOverrides: { calendarLifeYears: 8 }
    });

    const degradedYears: DegradedYearInput[] = multi.years.map(year => ({
      year: year.year,
      savings: year.savings,
      energyDischargedKwh: year.technical.energyDischargedKwh,
      sohPctStartOfYear: year.sohPctStartOfYear
    }));

    const result = calculateFinancialMetrics(
      multi.years[0].savings, multi.years[0].technical, makeFinancial(), system, { degradedYears }
    );

    expect(Number.isFinite(result.npv)).toBe(true);
    expect(result.lcoePerKwh).toBeGreaterThan(0);
    // Year 1 headline figures must match the year-1 dispatch exactly.
    expect(result.firstYearGrossSaving).toBe(multi.years[0].savings.grossSaving);
    expect(result.firstYearNetSaving).toBe(multi.years[0].savings.netOperatingSaving);
    // And the reported capacity trajectory must be the real SOH, declining.
    const capacities = result.annualCashFlows.map(cf => cf.effectiveCapacityPct);
    expect(capacities[0]).toBe(100);
    expect(capacities[capacities.length - 1]).toBeLessThan(100);
  });
});
