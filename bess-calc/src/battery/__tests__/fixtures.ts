import { BatteryModelConfig } from '../batteryModel';

export function makeBatteryConfig(overrides: Partial<BatteryModelConfig> = {}): BatteryModelConfig {
  return {
    manufacturer: 'Test',
    model: 'TEST-100',
    capacityKwh: 100,
    powerKw: 50,
    roundTripEfficiencyPct: 90,
    initialSohPct: 100,
    maxCycles: 4000,
    calendarLifeYears: 10,
    ...overrides
  };
}
