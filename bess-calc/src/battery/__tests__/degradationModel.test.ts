import { describe, it, expect } from 'vitest';
import { estimateDegradation } from '../degradationModel';
import { makeBatteryConfig } from './fixtures';

const shallowHalfCycles = [
  { fromSocPct: 60, toSocPct: 50, depthOfDischargePct: 10 },
  { fromSocPct: 50, toSocPct: 60, depthOfDischargePct: 10 }
];
const deepHalfCycles = [
  { fromSocPct: 90, toSocPct: 10, depthOfDischargePct: 80 },
  { fromSocPct: 10, toSocPct: 90, depthOfDischargePct: 80 }
];

describe('estimateDegradation', () => {
  it('never exceeds 0 or the configured initialSohPct', () => {
    const result = estimateDegradation({
      config: makeBatteryConfig(),
      halfCycles: [],
      throughputKwh: 0,
      elapsedYears: 0
    });
    expect(result.sohPct).toBeLessThanOrEqual(100);
    expect(result.sohPct).toBeGreaterThanOrEqual(0);
  });

  it('SOH floors at 0 even under extreme stress (never goes negative)', () => {
    const result = estimateDegradation({
      config: makeBatteryConfig({ maxCycles: 10, calendarLifeYears: 1 }),
      halfCycles: Array(200).fill({ fromSocPct: 100, toSocPct: 0, depthOfDischargePct: 100 }),
      throughputKwh: 1_000_000,
      elapsedYears: 50
    });
    expect(result.sohPct).toBe(0);
  });

  it('with zero elapsed time and zero cycling, degradation is zero and SOH equals initialSohPct', () => {
    const config = makeBatteryConfig({ initialSohPct: 97 });
    const result = estimateDegradation({ config, halfCycles: [], throughputKwh: 0, elapsedYears: 0 });
    expect(result.totalAgeingPct).toBe(0);
    expect(result.sohPct).toBe(97);
  });

  it('degradation increases with throughput (more cycling over the same period ages the battery more)', () => {
    const config = makeBatteryConfig();
    const low = estimateDegradation({ config, halfCycles: shallowHalfCycles, throughputKwh: 100, elapsedYears: 1 });
    const high = estimateDegradation({
      config,
      halfCycles: [...shallowHalfCycles, ...shallowHalfCycles, ...shallowHalfCycles],
      throughputKwh: 300,
      elapsedYears: 1
    });
    expect(high.totalAgeingPct).toBeGreaterThan(low.totalAgeingPct);
    expect(high.sohPct).toBeLessThan(low.sohPct);
  });

  it('deeper cycles degrade the battery faster than shallow cycles for the same cycle count', () => {
    const config = makeBatteryConfig();
    const shallow = estimateDegradation({ config, halfCycles: shallowHalfCycles, throughputKwh: 20, elapsedYears: 1 });
    const deep = estimateDegradation({ config, halfCycles: deepHalfCycles, throughputKwh: 160, elapsedYears: 1 });
    expect(deep.cycleAgeingPct).toBeGreaterThan(shallow.cycleAgeingPct);
    expect(deep.sohPct).toBeLessThan(shallow.sohPct);
  });

  it('higher C-rate increases cycle ageing versus the reference C-rate', () => {
    const config = makeBatteryConfig();
    const reference = estimateDegradation({ config, halfCycles: deepHalfCycles, throughputKwh: 160, elapsedYears: 1, averageCRate: 0.5 });
    const fast = estimateDegradation({ config, halfCycles: deepHalfCycles, throughputKwh: 160, elapsedYears: 1, averageCRate: 2 });
    expect(fast.cycleAgeingPct).toBeGreaterThan(reference.cycleAgeingPct);
  });

  it('higher temperature increases calendar ageing versus the reference temperature', () => {
    const config = makeBatteryConfig();
    const reference = estimateDegradation({ config, halfCycles: [], throughputKwh: 0, elapsedYears: 2, averageTemperatureC: 25 });
    const hot = estimateDegradation({ config, halfCycles: [], throughputKwh: 0, elapsedYears: 2, averageTemperatureC: 45 });
    expect(hot.calendarAgeingPct).toBeGreaterThan(reference.calendarAgeingPct);
  });

  it('elapsed time alone (calendar ageing) reduces SOH even with zero cycling', () => {
    const config = makeBatteryConfig();
    const result = estimateDegradation({ config, halfCycles: [], throughputKwh: 0, elapsedYears: 5 });
    expect(result.calendarAgeingPct).toBeGreaterThan(0);
    expect(result.sohPct).toBeLessThan(config.initialSohPct);
  });

  it('rejects negative elapsedYears', () => {
    expect(() => estimateDegradation({ config: makeBatteryConfig(), halfCycles: [], throughputKwh: 0, elapsedYears: -1 })).toThrow();
  });

  it('rejects negative throughputKwh', () => {
    expect(() => estimateDegradation({ config: makeBatteryConfig(), halfCycles: [], throughputKwh: -1, elapsedYears: 1 })).toThrow();
  });

  it('rejects non-positive averageCRate', () => {
    expect(() => estimateDegradation({ config: makeBatteryConfig(), halfCycles: [], throughputKwh: 0, elapsedYears: 1, averageCRate: 0 })).toThrow();
  });
});
