import { OptimisationBatteryConfig, OptimisationInterval, OptimisationOptions } from '../types';

export function makeBattery(overrides: Partial<OptimisationBatteryConfig> = {}): OptimisationBatteryConfig {
  return {
    ratedPowerKw: 100,
    ratedEnergyKwh: 400,
    minSocPct: 10,
    maxSocPct: 100,
    initialSocPct: 50,
    reserveSocPct: 0,
    chargeEfficiencyPct: 95,
    dischargeEfficiencyPct: 95,
    degradationCostPerKwh: 0.1,
    ...overrides
  };
}

export function makeOptions(overrides: Partial<OptimisationOptions> = {}): OptimisationOptions {
  return {
    terminalSocRule: 'equal_to_initial',
    ...overrides
  };
}

export function makeIntervals(
  count: number,
  overrides: Partial<OptimisationInterval> = {},
  startIso = '2024-06-15T00:00:00.000Z',
  durationHours = 0.25
): OptimisationInterval[] {
  const startMs = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(startMs + i * durationHours * 3600 * 1000).toISOString(),
    durationHours,
    netLoadKw: 100,
    importRatePerKwh: 10,
    exportAllowed: false,
    isOutage: false,
    ...overrides
  }));
}
