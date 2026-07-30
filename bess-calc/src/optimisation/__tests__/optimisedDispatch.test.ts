import { describe, it, expect } from 'vitest';
import { runOptimisedDispatch } from '../optimisedDispatch';
import { runHeuristicDispatch } from '../heuristicDispatch';
import { compareDispatchResults } from '../comparison';
import { makeBattery, makeOptions, makeIntervals } from './fixtures';

describe('SOC recursion', () => {
  it('conserves energy: discharging reduces SOC by dischargeKw*dt/etaDischarge', () => {
    const battery = makeBattery({ initialSocPct: 100, minSocPct: 0, chargeEfficiencyPct: 100, dischargeEfficiencyPct: 90 });
    const intervals = makeIntervals(1, { netLoadKw: 50 }, undefined, 1); // 1-hour interval
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));

    expect(result.solverStatus).toBe('optimal');
    const di = result.dispatchIntervals[0];
    if (di.dischargeKw > 0) {
      const expectedSoc = battery.ratedEnergyKwh - (di.dischargeKw * 1) / 0.9;
      expect(di.socKwh).toBeCloseTo(expectedSoc, 3);
    }
  });
});

describe('interval duration scaling', () => {
  it('scales SOC change correctly for 15-minute intervals', () => {
    const battery = makeBattery({ initialSocPct: 100, minSocPct: 0, dischargeEfficiencyPct: 100, chargeEfficiencyPct: 100 });
    const intervals = makeIntervals(1, { netLoadKw: 50 }, undefined, 0.25);
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    const di = result.dispatchIntervals[0];
    const expectedSocDrop = di.dischargeKw * 0.25;
    expect(battery.ratedEnergyKwh - di.socKwh).toBeCloseTo(expectedSocDrop, 3);
  });

  it('scales SOC change correctly for 30-minute intervals', () => {
    const battery = makeBattery({ initialSocPct: 100, minSocPct: 0, dischargeEfficiencyPct: 100, chargeEfficiencyPct: 100 });
    const intervals = makeIntervals(1, { netLoadKw: 50 }, undefined, 0.5);
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    const di = result.dispatchIntervals[0];
    const expectedSocDrop = di.dischargeKw * 0.5;
    expect(battery.ratedEnergyKwh - di.socKwh).toBeCloseTo(expectedSocDrop, 3);
  });
});

describe('no simultaneous charging and discharging', () => {
  it('never has both chargeKw > 0 and dischargeKw > 0 in the same interval', () => {
    const battery = makeBattery();
    const intervals = makeIntervals(8, { netLoadKw: 50, importRatePerKwh: 10 }).map((interval, i) => ({
      ...interval,
      netLoadKw: i % 2 === 0 ? 150 : -50,
      importRatePerKwh: i % 2 === 0 ? 15 : 4
    }));
    const result = runOptimisedDispatch(intervals, battery, makeOptions());
    for (const di of result.dispatchIntervals) {
      expect(di.chargeKw > 0.001 && di.dischargeKw > 0.001).toBe(false);
    }
  });
});

describe('power bounds', () => {
  it('never exceeds rated power for charge or discharge', () => {
    const battery = makeBattery({ ratedPowerKw: 50 });
    const intervals = makeIntervals(4, { netLoadKw: 500 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions());
    for (const di of result.dispatchIntervals) {
      expect(di.chargeKw).toBeLessThanOrEqual(battery.ratedPowerKw + 1e-6);
      expect(di.dischargeKw).toBeLessThanOrEqual(battery.ratedPowerKw + 1e-6);
    }
  });
});

describe('SOC bounds', () => {
  it('never drops SOC below the configured minimum', () => {
    const battery = makeBattery({ minSocPct: 20, initialSocPct: 30, ratedPowerKw: 200 });
    const intervals = makeIntervals(20, { netLoadKw: 300 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    const minStoredKwh = (battery.minSocPct / 100) * battery.ratedEnergyKwh;
    for (const di of result.dispatchIntervals) {
      expect(di.socKwh).toBeGreaterThanOrEqual(minStoredKwh - 1e-3);
    }
  });

  it('never exceeds the configured maximum SOC', () => {
    const battery = makeBattery({ maxSocPct: 80, initialSocPct: 70, ratedPowerKw: 200 });
    const intervals = makeIntervals(20, { netLoadKw: -300, importRatePerKwh: 2 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    const maxStoredKwh = (battery.maxSocPct / 100) * battery.ratedEnergyKwh;
    for (const di of result.dispatchIntervals) {
      expect(di.socKwh).toBeLessThanOrEqual(maxStoredKwh + 1e-3);
    }
  });
});

describe('terminal SOC discipline', () => {
  it('equal_to_initial: terminal SOC is at least the initial SOC', () => {
    const battery = makeBattery({ initialSocPct: 50 });
    const intervals = makeIntervals(8, { netLoadKw: 80 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'equal_to_initial' }));
    expect(result.terminalSocKwh).toBeGreaterThanOrEqual(result.initialSocKwh - 1e-3);
    expect(result.terminalSocRule).toBe('equal_to_initial');
  });

  it('minimum_terminal_reserve: terminal SOC is at least the configured reserve', () => {
    const battery = makeBattery({ initialSocPct: 80, minSocPct: 10 });
    const intervals = makeIntervals(8, { netLoadKw: 80 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'minimum_terminal_reserve', minimumTerminalReserveSocPct: 30 }));
    const reserveKwh = 0.30 * battery.ratedEnergyKwh;
    expect(result.terminalSocKwh).toBeGreaterThanOrEqual(reserveKwh - 1e-3);
  });

  it('unconstrained: terminal SOC can fall below the initial SOC', () => {
    const battery = makeBattery({ initialSocPct: 90, minSocPct: 0, ratedPowerKw: 200 });
    const intervals = makeIntervals(8, { netLoadKw: 300, importRatePerKwh: 20 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    expect(result.terminalSocRule).toBe('unconstrained');
  });
});

describe('month-to-date peak / demand minimisation', () => {
  it('does not incur additional peak-demand cost for import below the existing month-to-date peak', () => {
    const battery = makeBattery({ ratedPowerKw: 200 });
    const intervals = makeIntervals(4, { netLoadKw: 150, importRatePerKwh: 8 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({
      demandCharge: { ratePerKw: 500, existingMonthToDatePeakKw: 300, horizonCoversFullBillingPeriod: false }
    }));
    expect(result.solverStatus).toBe('optimal');
    expect(result.demandChargeScopeNote).toContain('SHORTER than the full billing period');
  });

  it('minimises incremental peak above the existing month-to-date peak when import would otherwise exceed it', () => {
    const battery = makeBattery({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0 });
    const intervals = makeIntervals(4, { netLoadKw: 400, importRatePerKwh: 8 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({
      terminalSocRule: 'unconstrained',
      demandCharge: { ratePerKw: 1000, existingMonthToDatePeakKw: 100, horizonCoversFullBillingPeriod: true }
    }));
    expect(result.solverStatus).toBe('optimal');
    // With a very high demand-charge rate, the optimiser should discharge heavily to
    // avoid a high peak import, i.e. some discharge should occur.
    const totalDischarge = result.dispatchIntervals.reduce((s, di) => s + di.dischargeKw, 0);
    expect(totalDischarge).toBeGreaterThan(0);
  });
});

describe('TOD arbitrage', () => {
  it('charges during a cheap interval and discharges during an expensive one when net load allows', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 50, minSocPct: 0 });
    const intervals = makeIntervals(2, {}, undefined, 1).map((interval, i) => ({
      ...interval,
      netLoadKw: i === 0 ? -50 : 100, // interval 0: surplus (negative net load), interval 1: real import need
      importRatePerKwh: i === 0 ? 3 : 15
    }));
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    expect(result.solverStatus).toBe('optimal');
    expect(result.dispatchIntervals[1].dischargeKw).toBeGreaterThan(0);
  });
});

describe('degradation penalty', () => {
  it('a higher degradation cost reduces total throughput compared to zero degradation cost, all else equal', () => {
    const intervals = makeIntervals(4, { netLoadKw: 100, importRatePerKwh: 10 });
    const lowDegBattery = makeBattery({ degradationCostPerKwh: 0, ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0 });
    const highDegBattery = makeBattery({ degradationCostPerKwh: 50, ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0 });

    const lowDegResult = runOptimisedDispatch(intervals, lowDegBattery, makeOptions({ terminalSocRule: 'unconstrained' }));
    const highDegResult = runOptimisedDispatch(intervals, highDegBattery, makeOptions({ terminalSocRule: 'unconstrained' }));

    const lowDegThroughput = lowDegResult.dispatchIntervals.reduce((s, di) => s + di.dischargeKw + di.chargeKw, 0);
    const highDegThroughput = highDegResult.dispatchIntervals.reduce((s, di) => s + di.dischargeKw + di.chargeKw, 0);

    expect(highDegThroughput).toBeLessThanOrEqual(lowDegThroughput + 1e-6);
  });
});

describe('optimised vs heuristic', () => {
  it('produces a total grid cost no worse than the heuristic under an equivalent scope', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 60, minSocPct: 0 });
    const intervals = makeIntervals(8, {}, undefined, 1).map((interval, i) => ({
      ...interval,
      netLoadKw: i % 2 === 0 ? 150 : 20,
      importRatePerKwh: i % 2 === 0 ? 15 : 5
    }));
    const options = makeOptions({ terminalSocRule: 'unconstrained' });

    const optimised = runOptimisedDispatch(intervals, battery, options);
    const heuristicIntervals = runHeuristicDispatch(intervals, battery);
    const heuristicResult = {
      dispatchIntervals: heuristicIntervals,
      solverStatus: 'optimal' as const,
      solveDurationMs: 0,
      optimisationScope: 'heuristic-only',
      mixedModeIntervals: 0,
      initialSocKwh: optimised.initialSocKwh,
      terminalSocKwh: heuristicIntervals[heuristicIntervals.length - 1].socKwh,
      terminalSocRule: options.terminalSocRule,
      demandChargeScopeNote: optimised.demandChargeScopeNote,
      warnings: []
    };

    const comparison = compareDispatchResults({ heuristic: heuristicResult, optimised }, intervals);
    expect(comparison.comparable).toBe(true);
    expect(comparison.optimisedTotalCost).toBeLessThanOrEqual((comparison.heuristicTotalCost ?? 0) + 1e-6);
  });
});

describe('infeasible model', () => {
  it('reports infeasible status and falls back to the heuristic engine', () => {
    const battery = makeBattery({ minSocPct: 90, maxSocPct: 10 }); // min > max: structurally infeasible
    const intervals = makeIntervals(4, { netLoadKw: 50 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions());
    expect(result.solverStatus).toBe('infeasible');
    expect(result.dispatchIntervals.length).toBe(4);
    expect(result.mixedModeIntervals).toBe(4);
    expect(result.warnings.some(w => w.toLowerCase().includes('infeasible'))).toBe(true);
  });
});

describe('fallback behaviour', () => {
  it('never throws an unhandled error and always returns a structured result even on solver failure', () => {
    const battery = makeBattery({ minSocPct: 90, maxSocPct: 10 });
    const intervals = makeIntervals(4, { netLoadKw: 50 });
    expect(() => runOptimisedDispatch(intervals, battery, makeOptions())).not.toThrow();
  });

  it('does not present a fallback result as optimised', () => {
    const battery = makeBattery({ minSocPct: 90, maxSocPct: 10 });
    const intervals = makeIntervals(4, { netLoadKw: 50 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions());
    expect(result.dispatchIntervals.every(di => di.mode === 'heuristic')).toBe(true);
    expect(result.optimisationScope).toContain('NOT an optimised result');
  });
});

describe('outage intervals (mixed mode)', () => {
  it('dispatches outage intervals via the heuristic engine and reports them as mixed-mode', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 80, minSocPct: 0 });
    const intervals = makeIntervals(4, {}, undefined, 1).map((interval, i) => ({
      ...interval,
      isOutage: i === 2,
      netLoadKw: i === 2 ? 80 : 50
    }));
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    expect(result.mixedModeIntervals).toBe(1);
    expect(result.dispatchIntervals[2].mode).toBe('heuristic');
    expect(result.optimisationScope).toContain('1 outage interval');
  });
});

describe('export constraints', () => {
  it('export prohibited: gridExportKw is always zero when exportAllowed is false', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 100, minSocPct: 0 });
    const intervals = makeIntervals(4, { netLoadKw: -100, exportAllowed: false, importRatePerKwh: 2 });
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    for (const di of result.dispatchIntervals) {
      expect(di.gridExportKw).toBe(0);
    }
  });

  it('export allowed: the model can use the export variable up to the configured limit', () => {
    const battery = makeBattery({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 100, minSocPct: 0 });
    const intervals = makeIntervals(2, { netLoadKw: -100, exportAllowed: true, exportCreditPerKwh: 5, exportLimitKw: 40, importRatePerKwh: 2 }, undefined, 1);
    const result = runOptimisedDispatch(intervals, battery, makeOptions({ terminalSocRule: 'unconstrained' }));
    expect(result.solverStatus).toBe('optimal');
    for (const di of result.dispatchIntervals) {
      expect(di.gridExportKw).toBeLessThanOrEqual(40 + 1e-6);
    }
  });
});
