import { describe, it, expect } from 'vitest';
import { runOptimisedDispatch } from '../optimisedDispatch';
import { makeBattery, makeOptions, makeIntervals } from './fixtures';

describe('known-optimal hand-checkable case', () => {
  it('fully covers a single-interval import spike within battery power and energy limits, minimising cost', () => {
    // Single 1-hour interval, net load 80kW, battery can supply up to 100kW and has
    // ample energy. With no demand charge, discharging to zero import strictly
    // reduces the objective (avoided import cost > degradation cost), so the LP
    // should discharge exactly enough to zero out grid import.
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0, degradationCostPerKwh: 0.01 });
    const intervals = makeIntervals(1, { netLoadKw: 80, importRatePerKwh: 10 }, undefined, 1);
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));

    expect(result.solverStatus).toBe('optimal');
    expect(result.dispatchIntervals[0].dischargeKw).toBeCloseTo(80, 2);
    expect(result.dispatchIntervals[0].gridImportKw).toBeCloseTo(0, 2);
  });

  it('does not discharge when there is no positive net load and no demand-charge/arbitrage incentive', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 50, minSocPct: 0, degradationCostPerKwh: 1 });
    const intervals = makeIntervals(1, { netLoadKw: 0, importRatePerKwh: 10 }, undefined, 1);
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));

    expect(result.solverStatus).toBe('optimal');
    expect(result.dispatchIntervals[0].dischargeKw).toBeCloseTo(0, 3);
    expect(result.dispatchIntervals[0].chargeKw).toBeCloseTo(0, 3);
  });
});

describe('solver timeout handling', () => {
  it('falls back to the heuristic engine when the configured solver timeout is effectively zero', () => {
    const battery = makeBattery();
    const intervals = makeIntervals(4, { netLoadKw: 100 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ solverTimeoutMs: -1 }));
    expect(result.solverStatus).toBe('timeout');
    expect(result.dispatchIntervals.every(di => di.mode === 'heuristic')).toBe(true);
  });
});
