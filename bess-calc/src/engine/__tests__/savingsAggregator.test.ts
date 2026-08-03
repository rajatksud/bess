import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { aggregateSavings, emptyAttribution, attributionViolations, DispatchAttribution } from '../savingsAggregator';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval, makeFlatDay } from './fixtures';

const ALL_PRIORITIES = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'] as const;

function mixedDutyProfile() {
  const tariff = makeTariff({
    enableTou: true,
    energyChargePerKwh: 9.5,
    touPeriods: [
      { id: 'off', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 5 },
      { id: 'peak', name: 'Peak Surge', startTime: '18:00', endTime: '22:00', importRatePerKwh: 15 }
    ]
  });
  // Deliberately exercises every attribution category in one run: an outage (DG),
  // a large spike (peak shaving), surplus solar (solar charge), an off-peak window
  // (arbitrage charge) and a TOU-peak window (arbitrage discharge).
  const intervals = [
    makeInterval({ intervalIndex: 0, timeLabel: '02:00', loadKw: 60, gridAvailable: false, dgRequiredKw: 60, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
    makeInterval({ intervalIndex: 1, timeLabel: '03:00', loadKw: 20, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
    makeInterval({ intervalIndex: 2, timeLabel: '11:00', loadKw: 30, solarKw: 140, gridAvailable: true, tariffPeriod: 'Standard', tariffImportRate: 9.5 }),
    makeInterval({ intervalIndex: 3, timeLabel: '12:00', loadKw: 400, loadKva: 400, gridAvailable: true, tariffPeriod: 'Standard', tariffImportRate: 9.5 }),
    makeInterval({ intervalIndex: 4, timeLabel: '19:00', loadKw: 90, gridAvailable: true, tariffPeriod: 'Peak Surge', tariffImportRate: 15 })
  ];
  return { tariff, intervals };
}

describe('savingsAggregator extraction', () => {
  it('an omitted options object produces results identical to an explicitly empty one', () => {
    const { tariff, intervals } = mixedDutyProfile();
    const system = makeSystem();

    const withoutOptions = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15
    );
    const withEmptyOptions = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15, {}
    );

    expect(withEmptyOptions.savings).toEqual(withoutOptions.savings);
    expect(withEmptyOptions.technical).toEqual(withoutOptions.technical);
    expect(withEmptyOptions.simulatedIntervals).toEqual(withoutOptions.simulatedIntervals);
  });

  it('an explicit 100% SOH is identical to omitting SOH entirely', () => {
    const { tariff, intervals } = mixedDutyProfile();
    const system = makeSystem();

    const bol = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15
    );
    const explicit100 = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15,
      { batterySohPct: 100 }
    );

    expect(explicit100.savings).toEqual(bol.savings);
    expect(explicit100.technical).toEqual(bol.technical);
  });

  it('calling the aggregator directly with the dispatch attribution reproduces the engine output', () => {
    const { tariff, intervals } = mixedDutyProfile();
    const system = makeSystem();
    const diesel = makeDiesel();
    const solar = makeSolar();
    const financial = makeFinancial();

    const run = runIntervalDispatch(intervals, system, tariff, diesel, solar, financial, [...ALL_PRIORITIES], 15);

    const reAggregated = aggregateSavings(
      {
        simulatedIntervals: run.simulatedIntervals,
        attribution: run.attribution,
        peakBeforeKw: run.technical.peakBeforeKw,
        peakBeforeKva: run.technical.peakBeforeKva,
        powerFactor: tariff.powerFactor,
        minimumSocPct: run.technical.minimumSocPct,
        maximumSocPct: run.technical.maximumSocPct,
        deliverableCapacityKwh: run.technical.deliverableCapacityKwh
      },
      system, tariff, diesel, solar, financial
    );

    expect(reAggregated.savings).toEqual(run.savings);
    expect(reAggregated.technical).toEqual(run.technical);
  });
});

describe('Rule 2 invariant on the rule-based dispatch path', () => {
  it('attributed discharge sums exactly to physical discharge across a mixed-duty day', () => {
    const { tariff, intervals } = mixedDutyProfile();
    const { attribution } = runIntervalDispatch(
      intervals, makeSystem(), tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15
    );

    expect(attribution.totalDischargedKwh).toBeGreaterThan(0);
    expect(attributionViolations(attribution)).toEqual([]);
    expect(
      attribution.dgDisplacedKwh + attribution.peakShavingKwh + attribution.arbitrageDischargeKwh
    ).toBeCloseTo(attribution.totalDischargedKwh, 9);
  });

  it('attributed charge sums exactly to physical charge, and arbitrage charge is a subset of grid charge', () => {
    const { tariff, intervals } = mixedDutyProfile();
    const { attribution } = runIntervalDispatch(
      intervals, makeSystem(), tariff, makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15
    );

    expect(attribution.totalChargedKwh).toBeGreaterThan(0);
    expect(attribution.solarStoredKwh + attribution.gridChargedKwh).toBeCloseTo(attribution.totalChargedKwh, 9);
    expect(attribution.arbitrageChargedKwh).toBeLessThanOrEqual(attribution.gridChargedKwh + 1e-9);
  });

  it('holds on a flat 24-hour profile driven purely by peak shaving', () => {
    const intervals = makeFlatDay({ loadKw: 200, loadKva: 200, gridAvailable: true });
    intervals[40] = { ...intervals[40], loadKw: 500, loadKva: 500 };

    const { attribution } = runIntervalDispatch(
      intervals, makeSystem(), makeTariff(), makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(), ['peak_shaving'], 15
    );

    expect(attribution.peakShavingKwh).toBeGreaterThan(0);
    expect(attribution.arbitrageDischargeKwh).toBe(0);
    expect(attribution.dgDisplacedKwh).toBe(0);
    expect(attributionViolations(attribution)).toEqual([]);
  });
});

describe('attributionViolations', () => {
  it('reports an unbalanced discharge attribution', () => {
    const attribution: DispatchAttribution = { ...emptyAttribution(), totalDischargedKwh: 100, arbitrageDischargeKwh: 40 };
    const violations = attributionViolations(attribution);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Discharge attribution does not balance');
  });

  it('reports arbitrage charging that exceeds total grid charging', () => {
    const attribution: DispatchAttribution = {
      ...emptyAttribution(),
      totalChargedKwh: 50,
      gridChargedKwh: 50,
      arbitrageChargedKwh: 80
    };
    expect(attributionViolations(attribution).join(' ')).toContain('exceeds total grid charging');
  });

  it('accepts a balanced attribution', () => {
    const attribution: DispatchAttribution = {
      ...emptyAttribution(),
      totalDischargedKwh: 100,
      dgDisplacedKwh: 30,
      peakShavingKwh: 50,
      arbitrageDischargeKwh: 20,
      totalChargedKwh: 60,
      solarStoredKwh: 40,
      gridChargedKwh: 20,
      arbitrageChargedKwh: 20
    };
    expect(attributionViolations(attribution)).toEqual([]);
  });
});
