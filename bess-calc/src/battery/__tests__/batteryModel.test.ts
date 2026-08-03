import { describe, it, expect } from 'vitest';
import { validateBatteryModelConfig } from '../batteryModel';
import { makeBatteryConfig } from './fixtures';

describe('validateBatteryModelConfig', () => {
  it('accepts a valid config', () => {
    expect(() => validateBatteryModelConfig(makeBatteryConfig())).not.toThrow();
  });

  it.each([
    ['capacityKwh', { capacityKwh: 0 }],
    ['powerKw', { powerKw: -1 }],
    ['roundTripEfficiencyPct', { roundTripEfficiencyPct: 0 }],
    ['roundTripEfficiencyPct', { roundTripEfficiencyPct: 101 }],
    ['initialSohPct', { initialSohPct: 0 }],
    ['initialSohPct', { initialSohPct: 150 }],
    ['maxCycles', { maxCycles: 0 }],
    ['calendarLifeYears', { calendarLifeYears: 0 }]
  ])('rejects an invalid %s', (_field, overrides) => {
    expect(() => validateBatteryModelConfig(makeBatteryConfig(overrides))).toThrow();
  });
});
