import { describe, it, expect } from 'vitest';
import { attributeLpDispatch, heuristicOptimizer, lpOptimizer, toOptimisationIntervals } from '../index';
import { attributionViolations } from '../../engine/savingsAggregator';
import { DispatchOptimizerInput } from '../optimizer';
import { DispatchInterval } from '../types';
import {
  makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval, makeFlatDay
} from '../../engine/__tests__/fixtures';
import { IntervalRecord } from '../../types/bess';

const ALL_PRIORITIES = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'] as const;

function baseInput(intervals: IntervalRecord[], overrides: Partial<DispatchOptimizerInput> = {}): DispatchOptimizerInput {
  return {
    intervals,
    system: makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 600 }),
    tariff: makeTariff({ powerFactor: 1, contractDemandKva: 2000, minimumBillingDemandPct: 0 }),
    diesel: makeDiesel({ enableDieselDisplacement: false }),
    solar: makeSolar({ enableSolarIntegration: false, exportAllowed: false }),
    financial: makeFinancial(),
    priorities: [...ALL_PRIORITIES],
    intervalMinutes: 15,
    ...overrides
  };
}

/** A day with a sharp evening peak plus a cheap overnight window, so both peak shaving and arbitrage are on the table. */
function mixedTariffDay(): IntervalRecord[] {
  const intervals = makeFlatDay({ loadKw: 150, loadKva: 150, gridAvailable: true, tariffImportRate: 9.5, tariffPeriod: 'Standard' });
  for (let i = 0; i < 24; i++) {
    intervals[i] = { ...intervals[i], tariffImportRate: 5, tariffPeriod: 'Off-Peak Discount' };
  }
  for (let i = 72; i < 80; i++) {
    intervals[i] = { ...intervals[i], loadKw: 500, loadKva: 500, tariffImportRate: 15, tariffPeriod: 'Peak Surge' };
  }
  return intervals;
}

function fakeDispatch(intervals: IntervalRecord[], schedule: Array<Partial<DispatchInterval>>): DispatchInterval[] {
  return intervals.map((_, i) => ({
    timestamp: `1970-01-01T00:${String(i * 15).padStart(2, '0')}:00.000Z`,
    chargeKw: 0,
    dischargeKw: 0,
    gridImportKw: 0,
    gridExportKw: 0,
    socKwh: 300,
    socPct: 50,
    mode: 'optimised' as const,
    ...schedule[i]
  }));
}

describe('LP attribution rule: Rule 2 holds by construction', () => {
  it('attributed discharge sums exactly to physical discharge on a real LP solve', () => {
    const result = lpOptimizer.optimise(baseInput(mixedTariffDay()));

    expect(result.attribution.totalDischargedKwh).toBeGreaterThan(0);
    expect(attributionViolations(result.attribution)).toEqual([]);
    expect(
      result.attribution.dgDisplacedKwh + result.attribution.peakShavingKwh + result.attribution.arbitrageDischargeKwh
    ).toBeCloseTo(result.attribution.totalDischargedKwh, 9);
  });

  it('attributed charge sums exactly to physical charge, and arbitrage charge never exceeds grid charge', () => {
    const result = lpOptimizer.optimise(baseInput(mixedTariffDay()));

    expect(
      result.attribution.solarStoredKwh + result.attribution.gridChargedKwh
    ).toBeCloseTo(result.attribution.totalChargedKwh, 9);
    expect(result.attribution.arbitrageChargedKwh).toBeLessThanOrEqual(result.attribution.gridChargedKwh + 1e-9);
  });

  it('holds on an outage-only profile, where every kWh must land in the diesel bucket', () => {
    const intervals = Array.from({ length: 8 }, (_, i) =>
      makeInterval({ intervalIndex: i, loadKw: 120, gridAvailable: false, dgRequiredKw: 120 })
    );
    const result = lpOptimizer.optimise(baseInput(intervals));

    expect(result.attribution.totalDischargedKwh).toBeGreaterThan(0);
    expect(result.attribution.dgDisplacedKwh).toBeCloseTo(result.attribution.totalDischargedKwh, 9);
    expect(result.attribution.peakShavingKwh).toBe(0);
    expect(result.attribution.arbitrageDischargeKwh).toBe(0);
    expect(result.savings.energyArbitrageSaving).toBe(0);
    expect(attributionViolations(result.attribution)).toEqual([]);
  });

  it('credits no arbitrage for energy discharged purely to shave a peak', () => {
    const intervals = makeFlatDay({ loadKw: 100, loadKva: 100, gridAvailable: true, tariffImportRate: 9.5 });
    intervals[50] = { ...intervals[50], loadKw: 600, loadKva: 600 };

    // A schedule that discharges ONLY in the spike interval, exactly enough to reach the
    // next-highest level. Every one of those kWh is above the achieved peak, so all of it
    // must be peak shaving and none of it arbitrage.
    const dispatch = fakeDispatch(intervals, intervals.map((_, i) => (i === 50 ? { dischargeKw: 200 } : {})));
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    expect(attributed.achievedBillingPeakKw).toBeCloseTo(400, 9); // 600 - 200
    expect(attributed.attribution.peakShavingKwh).toBeCloseTo(200 * 0.25, 9);
    expect(attributed.attribution.arbitrageDischargeKwh).toBe(0);
    expect(attributionViolations(attributed.attribution)).toEqual([]);
  });

  it('sends discharge BELOW the achieved billing peak to arbitrage, never to demand-charge credit', () => {
    const intervals = makeFlatDay({ loadKw: 100, loadKva: 100, gridAvailable: true, tariffImportRate: 9.5 });
    intervals[50] = { ...intervals[50], loadKw: 600, loadKva: 600 };

    // Discharge in the spike (real peak shaving) AND in an ordinary 100 kW interval.
    // The second discharge cannot have moved the billed peak - it happened at a level
    // already far below it - so crediting it with demand-charge value would be the exact
    // double count Rule 2 forbids.
    const dispatch = fakeDispatch(intervals, intervals.map((_, i) => {
      if (i === 50) return { dischargeKw: 200 };
      if (i === 20) return { dischargeKw: 40 };
      return {};
    }));
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    expect(attributed.attribution.peakShavingKwh).toBeCloseTo(200 * 0.25, 9);
    expect(attributed.attribution.arbitrageDischargeKwh).toBeCloseTo(40 * 0.25, 9);
    expect(attributed.attribution.totalDischargedKwh).toBeCloseTo((200 + 40) * 0.25, 9);
    expect(attributionViolations(attributed.attribution)).toEqual([]);
  });

  it('splits a single interval across categories when it genuinely straddles the peak line, and flags it as mixed', () => {
    const intervals = makeFlatDay({ loadKw: 100, loadKva: 100, gridAvailable: true, tariffImportRate: 9.5 });
    intervals[50] = { ...intervals[50], loadKw: 600, loadKva: 600 };

    // Discharge 500 kW in the spike: import falls to 100 kW, which equals the ordinary
    // level, so the achieved peak is 100 kW. Only 500 of the 500 kW discharged sat above
    // that line... precisely 600 - 100 = 500, so this is fully peak shaving. Push it to
    // 550 kW and the extra 50 kW has nothing left to shave.
    const dispatch = fakeDispatch(intervals, intervals.map((_, i) => (i === 50 ? { dischargeKw: 550 } : {})));
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    expect(attributed.achievedBillingPeakKw).toBeCloseTo(100, 9);
    expect(attributed.attribution.peakShavingKwh).toBeCloseTo(500 * 0.25, 9);
    expect(attributed.attribution.arbitrageDischargeKwh).toBeCloseTo(50 * 0.25, 9);
    expect(attributed.mixedAttributionIntervals).toBe(1);
    expect(attributed.actionTags[50]).toContain('(mixed)');
    expect(attributionViolations(attributed.attribution)).toEqual([]);
  });

  it('caps diesel attribution at the load diesel could actually have served', () => {
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 300, gridAvailable: true, dgRequiredKw: 100, tariffImportRate: 9.5 }),
      makeInterval({ intervalIndex: 1, loadKw: 300, gridAvailable: true, dgRequiredKw: 0, tariffImportRate: 9.5 })
    ];
    const dispatch = fakeDispatch(intervals, [{ dischargeKw: 200 }, {}]);
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    // Only 100 kW of DG was running, so only 100 kW-worth may be credited as diesel
    // displacement; the other 100 kW cascades onward.
    expect(attributed.attribution.dgDisplacedKwh).toBeCloseTo(100 * 0.25, 9);
    expect(
      attributed.attribution.peakShavingKwh + attributed.attribution.arbitrageDischargeKwh
    ).toBeCloseTo(100 * 0.25, 9);
    expect(attributionViolations(attributed.attribution)).toEqual([]);
  });

  it('attributes charge to surplus solar first and the remainder to the grid', () => {
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 50, solarKw: 150, gridAvailable: true, tariffImportRate: 5 })
    ];
    // 150 kW charge against a 100 kW solar surplus: 100 solar-sourced, 50 grid-sourced.
    const dispatch = fakeDispatch(intervals, [{ chargeKw: 150 }]);
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    expect(attributed.attribution.solarStoredKwh).toBeCloseTo(100 * 0.25, 9);
    expect(attributed.attribution.gridChargedKwh).toBeCloseTo(50 * 0.25, 9);
    expect(attributed.attribution.totalChargedKwh).toBeCloseTo(150 * 0.25, 9);
    expect(attributed.mixedAttributionIntervals).toBe(1);
    expect(attributionViolations(attributed.attribution)).toEqual([]);
  });

  it('never attributes energy the optimiser did not dispatch', () => {
    const intervals = makeFlatDay({ loadKw: 100, gridAvailable: true });
    const dispatch = fakeDispatch(intervals, intervals.map(() => ({})));
    const attributed = attributeLpDispatch({ originals: intervals, dispatch, intervalMinutes: 15 });

    expect(attributed.attribution.totalDischargedKwh).toBe(0);
    expect(attributed.attribution.dgDisplacedKwh).toBe(0);
    expect(attributed.attribution.peakShavingKwh).toBe(0);
    expect(attributed.attribution.arbitrageDischargeKwh).toBe(0);
    expect(attributed.actionTags.every(tag => tag === 'Idle')).toBe(true);
  });

  it('rejects a schedule whose length does not match the interval count', () => {
    const intervals = makeFlatDay({ loadKw: 100, gridAvailable: true });
    expect(() => attributeLpDispatch({ originals: intervals, dispatch: [], intervalMinutes: 15 }))
      .toThrow(/does not match the interval count/);
  });
});

describe('unified DispatchOptimizer interface', () => {
  it('both layers return the same result shape from the same input', () => {
    const input = baseInput(mixedTariffDay());
    const heuristic = heuristicOptimizer.optimise(input);
    const lp = lpOptimizer.optimise(input);

    for (const result of [heuristic, lp]) {
      expect(result.simulatedIntervals).toHaveLength(input.intervals.length);
      expect(Object.keys(result.savings).sort()).toEqual(Object.keys(lp.savings).sort());
      expect(Object.keys(result.technical).sort()).toEqual(Object.keys(lp.technical).sort());
      expect(attributionViolations(result.attribution)).toEqual([]);
    }
    expect(heuristic.layer).toBe('rule_based');
    expect(lp.layer).toBe('linear_programming');
  });

  it('the rule-based optimiser is a pure wrapper: its output equals runIntervalDispatch exactly', async () => {
    const { runIntervalDispatch } = await import('../../engine/dispatchEngine');
    const input = baseInput(mixedTariffDay());

    const direct = runIntervalDispatch(
      input.intervals, input.system, input.tariff, input.diesel, input.solar, input.financial,
      input.priorities, input.intervalMinutes
    );
    const viaInterface = heuristicOptimizer.optimise(input);

    expect(viaInterface.savings).toEqual(direct.savings);
    expect(viaInterface.technical).toEqual(direct.technical);
    expect(viaInterface.simulatedIntervals).toEqual(direct.simulatedIntervals);
  });

  it('the LP path produces a real SavingsBreakdown, which it could not do before', () => {
    const lp = lpOptimizer.optimise(baseInput(mixedTariffDay()));

    expect(Number.isFinite(lp.savings.grossSaving)).toBe(true);
    expect(Number.isFinite(lp.savings.netOperatingSaving)).toBe(true);
    expect(lp.technical.energyDischargedKwh).toBeGreaterThan(0);
    expect(lp.technical.peakBeforeKw).toBeGreaterThan(0);
    expect(lp.diagnostics.solverStatus).toBeDefined();
  });

  it('discloses the attribution rule in its assumptions rather than presenting the split as fact', () => {
    const lp = lpOptimizer.optimise(baseInput(mixedTariffDay()));
    expect(lp.assumptions.join(' ')).toContain('LP_ENERGY_ATTRIBUTION');
    expect(lp.assumptions.join(' ')).toContain('attributed to avoided-cost categories ex post');
  });

  it('state of health constrains the LP path too, not only the rule-based one', () => {
    const input = baseInput(mixedTariffDay());
    const healthy = lpOptimizer.optimise(input);
    const degraded = lpOptimizer.optimise({ ...input, dispatchOptions: { batterySohPct: 40 } });

    expect(healthy.technical.deliverableCapacityKwh).toBeGreaterThan(degraded.technical.deliverableCapacityKwh);
    expect(degraded.technical.energyDischargedKwh).toBeLessThanOrEqual(healthy.technical.energyDischargedKwh);
  });

  it('rejects an out-of-range SOH on the LP path as well', () => {
    expect(() => lpOptimizer.optimise({ ...baseInput(mixedTariffDay()), dispatchOptions: { batterySohPct: 150 } }))
      .toThrow(/batterySohPct must be in \[0, 100\]/);
  });
});

describe('IntervalRecord <-> OptimisationInterval adapters', () => {
  it('converts gross load to net-of-solar load, matching the engine preBessGridImport definition', () => {
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 200, solarKw: 80, gridAvailable: true, tariffImportRate: 9.5 }),
      makeInterval({ intervalIndex: 1, loadKw: 60, solarKw: 150, gridAvailable: true, tariffImportRate: 9.5 })
    ];
    const converted = toOptimisationIntervals(intervals, { intervalMinutes: 15, solar: makeSolar() });

    expect(converted[0].netLoadKw).toBe(120);
    // Solar exceeds load: net import floors at 0, never negative.
    expect(converted[1].netLoadKw).toBe(0);
  });

  it('synthesises real ISO timestamps from the interval index, since timeLabel carries no date', () => {
    const intervals = makeFlatDay({ loadKw: 100, gridAvailable: true }).slice(0, 4);
    const converted = toOptimisationIntervals(intervals, {
      intervalMinutes: 15,
      solar: makeSolar(),
      horizonStartIso: '2026-03-01T00:00:00.000Z'
    });

    expect(converted[0].timestamp).toBe('2026-03-01T00:00:00.000Z');
    expect(converted[3].timestamp).toBe('2026-03-01T00:45:00.000Z');
    expect(converted.every(i => i.durationHours === 0.25)).toBe(true);
  });

  it('inverts gridAvailable into isOutage', () => {
    const intervals = [
      makeInterval({ intervalIndex: 0, gridAvailable: true }),
      makeInterval({ intervalIndex: 1, gridAvailable: false })
    ];
    const converted = toOptimisationIntervals(intervals, { intervalMinutes: 15, solar: makeSolar() });
    expect(converted.map(i => i.isOutage)).toEqual([false, true]);
  });

  it('rejects an invalid horizon start rather than silently producing Invalid Date timestamps', () => {
    expect(() => toOptimisationIntervals(makeFlatDay({ loadKw: 100 }), {
      intervalMinutes: 15, solar: makeSolar(), horizonStartIso: 'not-a-date'
    })).toThrow(/valid ISO timestamp/);
  });
});
