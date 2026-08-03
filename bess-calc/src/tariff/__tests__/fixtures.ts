import { BillingInterval, TariffDefinition } from '../types';

export function makeFlatTariff(overrides: Partial<TariffDefinition> = {}): TariffDefinition {
  return {
    id: 'test-flat',
    name: 'Test Flat Tariff',
    source: 'test fixture',
    version: '1.0.0',
    effectiveFrom: '2024-01-01',
    jurisdiction: 'TEST',
    consumerCategory: 'Test',
    voltageLevel: 'LT',
    timezone: 'Asia/Kolkata',
    currency: '₹',
    billingCycle: 'monthly',
    billingUnit: 'kW',
    demandIntegrationWindowMinutes: 15,
    energyCharges: { type: 'flat', flatRatePerKwh: 10 },
    demandCharges: { basis: 'measured_maximum', ratePerKw: 400 },
    exportRules: { policy: 'prohibited' },
    taxesAndDuties: [],
    applicabilityConditions: [],
    roundingRule: { mode: 'none', decimals: 2 },
    ...overrides
  };
}

/** Builds `count` intervals of `durationHours` each starting at `startIso`, all with the given import kW. */
export function makeFlatIntervals(
  count: number,
  importKw: number,
  startIso = '2024-06-15T00:00:00.000Z',
  durationHours = 0.25,
  overrides: Partial<BillingInterval> = {}
): BillingInterval[] {
  const startMs = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(startMs + i * durationHours * 3600 * 1000).toISOString(),
    durationHours,
    baselineGridImportKw: importKw,
    postBessGridImportKw: importKw,
    ...overrides
  }));
}
