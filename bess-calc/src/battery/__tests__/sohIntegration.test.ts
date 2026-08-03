import { describe, it, expect } from 'vitest';
import {
  toBatteryModelConfig,
  socTraceFromIntervals,
  halfCyclesFromIntervals,
  averageCRateFromIntervals,
  forecastSoh,
  usableEnergyKwhAtSoh,
  cycleLifeAtDod,
  cycleLifeConsumption,
  extractHalfCycles
} from '../index';
import { runIntervalDispatch } from '../../engine/dispatchEngine';
import { runMultiYearSimulation } from '../../engine/multiYearSimulation';
import {
  makeSystem,
  makeTariff,
  makeDiesel,
  makeSolar,
  makeFinancial,
  makeInterval,
  makeFlatDay
} from '../../engine/__tests__/fixtures';
import { makeBatteryConfig } from './fixtures';

const ALL_PRIORITIES = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'] as const;

/**
 * A day with a short, sharp evening peak. Kept short deliberately: a healthy 261 kWh
 * battery can fully shave it, while a degraded one runs out of stored energy partway
 * through — which is exactly the behavioural difference these tests need to observe.
 */
function peakyDay() {
  const intervals = makeFlatDay({ loadKw: 120, loadKva: 120, gridAvailable: true });
  for (let i = 76; i < 78; i++) {
    intervals[i] = { ...intervals[i], loadKw: 400, loadKva: 400 };
  }
  return intervals;
}

/** Unity power factor and a contract demand well above the peak, so demand savings are not masked by the contract cap or the minimum-billing floor. */
function demandTariff() {
  return makeTariff({ powerFactor: 1, contractDemandKva: 1000, minimumBillingDemandPct: 0 });
}

describe('BessSystemInput -> BatteryModelConfig adapter', () => {
  it('maps nameplate energy, power, chemistry, DoD and cycle life from the scenario input', () => {
    const system = makeSystem({ ratedEnergyKwh: 261, ratedPowerKw: 125, cycleLife: 6000, usableDodPct: 90, batteryChemistry: 'LFP' });
    const config = toBatteryModelConfig(system);

    expect(config.capacityKwh).toBe(261);
    expect(config.powerKw).toBe(125);
    expect(config.maxCycles).toBe(6000);
    expect(config.usableDodPct).toBe(90);
    expect(config.chemistry).toBe('LFP');
    expect(config.initialSohPct).toBe(100);
  });

  it('combines the two one-way efficiencies into a single round-trip efficiency', () => {
    const config = toBatteryModelConfig(makeSystem({ chargeEfficiencyPct: 95, dischargeEfficiencyPct: 95 }));
    expect(config.roundTripEfficiencyPct).toBeCloseTo(90.25, 6);
  });

  it('does not carry annualDegradationPct across, so Level 1 flat fade is never applied twice', () => {
    const config = toBatteryModelConfig(makeSystem({ annualDegradationPct: 2.5 }));
    expect(JSON.stringify(config)).not.toContain('annualDegradation');
  });

  it('lets datasheet overrides supply what BessSystemInput cannot express', () => {
    const config = toBatteryModelConfig(makeSystem(), {
      calendarLifeYears: 15,
      warrantyYears: 10,
      endOfLifeSohPct: 70,
      averageAmbientTemperatureC: 35
    });
    expect(config.calendarLifeYears).toBe(15);
    expect(config.warrantyYears).toBe(10);
    expect(config.endOfLifeSohPct).toBe(70);
    expect(config.averageAmbientTemperatureC).toBe(35);
  });
});

describe('SOC-trace bridge', () => {
  it('turns a simulated dispatch trace into the plain number[] extractHalfCycles consumes', () => {
    const { simulatedIntervals } = runIntervalDispatch(
      peakyDay(), makeSystem(), makeTariff(), makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15
    );

    const trace = socTraceFromIntervals(simulatedIntervals);
    expect(trace).toHaveLength(simulatedIntervals.length);
    expect(trace.every(soc => typeof soc === 'number' && Number.isFinite(soc))).toBe(true);
    expect(halfCyclesFromIntervals(simulatedIntervals)).toEqual(extractHalfCycles(trace));
  });

  it('extracts real half-cycles from a dispatch run that both charges and discharges', () => {
    const tariff = makeTariff({
      enableTou: true,
      touPeriods: [
        { id: 'off', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 5 },
        { id: 'peak', name: 'Peak Surge', startTime: '18:00', endTime: '22:00', importRatePerKwh: 15 }
      ]
    });
    const intervals = [
      makeInterval({ intervalIndex: 0, timeLabel: '02:00', loadKw: 20, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 1, timeLabel: '02:15', loadKw: 20, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 2, timeLabel: '19:00', loadKw: 90, gridAvailable: true, tariffPeriod: 'Peak Surge', tariffImportRate: 15 }),
      makeInterval({ intervalIndex: 3, timeLabel: '19:15', loadKw: 90, gridAvailable: true, tariffPeriod: 'Peak Surge', tariffImportRate: 15 })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, makeSystem({ initialSocPct: 50 }), tariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(), ['tou_arbitrage'], 15
    );

    const halfCycles = halfCyclesFromIntervals(simulatedIntervals);
    expect(halfCycles.length).toBeGreaterThan(0);
    expect(halfCycles.every(hc => hc.depthOfDischargePct >= 0)).toBe(true);
  });

  it('reports average C-rate only over intervals where the battery actually moved', () => {
    const intervals = [
      makeInterval({ intervalIndex: 0, bessPowerKw: 0 }),
      makeInterval({ intervalIndex: 1, bessPowerKw: 50 }),
      makeInterval({ intervalIndex: 2, bessPowerKw: -50 }),
      makeInterval({ intervalIndex: 3, bessPowerKw: 0 })
    ];
    // Mean absolute power over the two active intervals is 50 kW; at 100 kWh that is 0.5C.
    expect(averageCRateFromIntervals(intervals, 100)).toBeCloseTo(0.5, 9);
  });

  it('returns undefined C-rate when the battery never moved, rather than 0', () => {
    const idle = [makeInterval({ bessPowerKw: 0 }), makeInterval({ intervalIndex: 1, bessPowerKw: 0 })];
    expect(averageCRateFromIntervals(idle, 100)).toBeUndefined();
  });
});

describe('DoD-vs-cycle-life curve', () => {
  // Deliberately convex, i.e. NOT the curve C(D) = 100 x maxCycles / D that a DoD-linear
  // model implies. A curve that happens to satisfy that identity gives numerically
  // identical results to the linear approximation and would prove nothing.
  const curve = [
    { depthOfDischargePct: 20, cycles: 30000 },
    { depthOfDischargePct: 50, cycles: 10000 },
    { depthOfDischargePct: 100, cycles: 3000 }
  ];

  it('interpolates linearly between supplied points', () => {
    expect(cycleLifeAtDod(curve, 35)).toBeCloseTo(20000, 6);
    expect(cycleLifeAtDod(curve, 75)).toBeCloseTo(6500, 6);
  });

  it('clamps outside the measured range instead of extrapolating', () => {
    expect(cycleLifeAtDod(curve, 5)).toBe(30000);
    expect(cycleLifeAtDod(curve, 100)).toBe(3000);
    expect(cycleLifeAtDod(curve, 130)).toBe(3000);
  });

  it('charges shallow cycles far less life than a DoD-linear model would', () => {
    // Ten 20%-deep half-cycles. Curve: 10 x 0.5/30000 = 1.667e-4 of rated life.
    // DoD-linear against maxCycles=3000: (10 x 0.2 / 2) / 3000 = 3.33e-4 - twice as much.
    const shallow = Array.from({ length: 10 }, () => ({ fromSocPct: 80, toSocPct: 60, depthOfDischargePct: 20 }));
    const curveConsumption = cycleLifeConsumption(shallow, curve);
    expect(curveConsumption).toBeCloseTo(1.6666666e-4, 10);
    expect(curveConsumption).toBeLessThan((10 * 0.2 / 2) / 3000);
  });

  it('is used by the degradation model when present, and reported as such', () => {
    const halfCycles = Array.from({ length: 200 }, () => ({ fromSocPct: 90, toSocPct: 40, depthOfDischargePct: 50 }));
    const withCurve = forecastSoh(
      makeBatteryConfig({ dodCycleLifeCurve: curve, capacityKwh: 100 }),
      { halfCycles, throughputKwh: 1000, repetitionsPerYear: 1 },
      1
    );
    const withoutCurve = forecastSoh(
      makeBatteryConfig({ capacityKwh: 100 }),
      { halfCycles, throughputKwh: 1000, repetitionsPerYear: 1 },
      1
    );

    expect(withCurve.usedDodCycleLifeCurve).toBe(true);
    expect(withoutCurve.usedDodCycleLifeCurve).toBe(false);
    expect(withCurve.years[0].sohPct).not.toBeCloseTo(withoutCurve.years[0].sohPct, 6);
  });
});

describe('forecastSoh', () => {
  const duty = {
    halfCycles: Array.from({ length: 4 }, () => ({ fromSocPct: 90, toSocPct: 30, depthOfDischargePct: 60 })),
    throughputKwh: 200,
    repetitionsPerYear: 365
  };

  it('chains each year SOH into the next and is monotonically non-increasing', () => {
    const forecast = forecastSoh(makeBatteryConfig(), duty, 10);

    expect(forecast.years).toHaveLength(10);
    expect(forecast.years[0].sohPctStartOfYear).toBe(100);
    for (let i = 1; i < forecast.years.length; i++) {
      expect(forecast.years[i].sohPctStartOfYear).toBeCloseTo(forecast.years[i - 1].sohPct, 9);
      expect(forecast.years[i].sohPct).toBeLessThanOrEqual(forecast.years[i - 1].sohPct);
    }
  });

  it('returns usable kWh alongside SOH, following the documented convention', () => {
    const forecast = forecastSoh(makeBatteryConfig({ capacityKwh: 200, usableDodPct: 90 }), duty, 3);

    for (const year of forecast.years) {
      expect(year.capacityKwh).toBeCloseTo(200 * (year.sohPct / 100), 9);
      expect(year.usableEnergyKwh).toBeCloseTo(year.capacityKwh * 0.9, 9);
      expect(year.usableEnergyKwh).toBeCloseTo(usableEnergyKwhAtSoh(200, year.sohPct, 90), 9);
    }
  });

  it('applies SOH and usable DoD exactly once each: at 100% SOH usable energy equals the pre-SOH figure', () => {
    const forecast = forecastSoh(makeBatteryConfig({ capacityKwh: 261, usableDodPct: 90 }), { ...duty, halfCycles: [], throughputKwh: 0, repetitionsPerYear: 0 }, 1);
    // No cycling, but a full year of calendar ageing still applies, so compare the
    // convention itself rather than expecting exactly 100% SOH.
    expect(usableEnergyKwhAtSoh(261, 100, 90)).toBeCloseTo(261 * 0.9, 9);
    expect(forecast.years[0].usableEnergyKwh).toBeCloseTo(261 * (forecast.years[0].sohPct / 100) * 0.9, 9);
  });

  it('reports the first year that falls below the end-of-life SOH threshold', () => {
    const heavyDuty = { ...duty, halfCycles: Array.from({ length: 40 }, () => ({ fromSocPct: 100, toSocPct: 0, depthOfDischargePct: 100 })) };
    const forecast = forecastSoh(makeBatteryConfig({ maxCycles: 4000, endOfLifeSohPct: 80 }), heavyDuty, 10);

    expect(forecast.endOfLifeYear).not.toBeNull();
    const eolYear = forecast.years.find(y => y.year === forecast.endOfLifeYear)!;
    expect(eolYear.sohPct).toBeLessThan(80);
    expect(forecast.years.find(y => y.year === forecast.endOfLifeYear! - 1)?.sohPct ?? 100).toBeGreaterThanOrEqual(80);
  });

  it('flags when end of life falls inside the warranty term, and not when it falls after', () => {
    const moderateDuty = {
      halfCycles: [{ fromSocPct: 90, toSocPct: 30, depthOfDischargePct: 60 }, { fromSocPct: 30, toSocPct: 90, depthOfDischargePct: 60 }],
      throughputKwh: 120,
      repetitionsPerYear: 365
    };
    const forecast = forecastSoh(makeBatteryConfig({ maxCycles: 4000, warrantyYears: 10 }), moderateDuty, 12);
    expect(forecast.endOfLifeYear).not.toBeNull();

    const eolYear = forecast.endOfLifeYear!;
    const withinWarranty = forecastSoh(makeBatteryConfig({ maxCycles: 4000, warrantyYears: eolYear }), moderateDuty, 12);
    const beyondWarranty = forecastSoh(makeBatteryConfig({ maxCycles: 4000, warrantyYears: eolYear - 1 }), moderateDuty, 12);

    expect(withinWarranty.reachesEndOfLifeWithinWarranty).toBe(true);
    expect(beyondWarranty.reachesEndOfLifeWithinWarranty).toBe(false);
  });

  it('never reports a negative SOH even under duty that would consume more than the rated life', () => {
    const absurdDuty = {
      halfCycles: Array.from({ length: 500 }, () => ({ fromSocPct: 100, toSocPct: 0, depthOfDischargePct: 100 })),
      throughputKwh: 100000,
      repetitionsPerYear: 365
    };
    const forecast = forecastSoh(makeBatteryConfig(), absurdDuty, 5);
    expect(forecast.years.every(y => y.sohPct >= 0)).toBe(true);
    expect(forecast.years[forecast.years.length - 1].sohPct).toBe(0);
  });

  it('rejects a non-positive year count rather than silently returning nothing', () => {
    expect(() => forecastSoh(makeBatteryConfig(), duty, 0)).toThrow(/years must be a positive integer/);
  });
});

describe('SOH constrains real dispatch, not just the reported capacity', () => {
  it('a degraded battery discharges strictly less energy over the same profile', () => {
    const system = makeSystem({ ratedEnergyKwh: 261, ratedPowerKw: 125 });
    const run = (options: { batterySohPct?: number } = {}) => runIntervalDispatch(
      peakyDay(), system, demandTariff(), makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(), ['peak_shaving'], 15, options
    );

    const healthy = run();
    const degraded = run({ batterySohPct: 20 });

    expect(healthy.attribution.totalDischargedKwh).toBeGreaterThan(0);
    expect(degraded.attribution.totalDischargedKwh).toBeLessThan(healthy.attribution.totalDischargedKwh);
  });

  it('a degraded battery shaves less peak, so the demand saving falls', () => {
    const system = makeSystem({ ratedEnergyKwh: 261, ratedPowerKw: 125 });
    const run = (options: { batterySohPct?: number } = {}) => runIntervalDispatch(
      peakyDay(), system, demandTariff(), makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(), ['peak_shaving'], 15, options
    );

    const healthy = run();
    const degraded = run({ batterySohPct: 20 });

    expect(healthy.savings.demandChargeSaving).toBeGreaterThan(0);
    expect(degraded.technical.peakAfterKw).toBeGreaterThan(healthy.technical.peakAfterKw);
    expect(degraded.savings.demandChargeSaving).toBeLessThan(healthy.savings.demandChargeSaving);
  });

  it('a fully consumed battery (0% SOH) dispatches nothing and reports no NaN', () => {
    const { savings, technical, simulatedIntervals } = runIntervalDispatch(
      peakyDay(), makeSystem(), demandTariff(), makeDiesel(), makeSolar(), makeFinancial(),
      [...ALL_PRIORITIES], 15, { batterySohPct: 0 }
    );

    expect(technical.energyDischargedKwh).toBe(0);
    expect(technical.deliverableCapacityKwh).toBe(0);
    expect(Number.isNaN(savings.netOperatingSaving)).toBe(false);
    expect(simulatedIntervals.every(i => Number.isFinite(i.bessSocPct))).toBe(true);
  });

  it('rejects an out-of-range SOH instead of silently producing nonsense', () => {
    const call = (sohPct: number) => runIntervalDispatch(
      peakyDay(), makeSystem(), demandTariff(), makeDiesel(), makeSolar(), makeFinancial(),
      [...ALL_PRIORITIES], 15, { batterySohPct: sohPct }
    );
    expect(() => call(-1)).toThrow(/batterySohPct must be in \[0, 100\]/);
    expect(() => call(101)).toThrow(/batterySohPct must be in \[0, 100\]/);
  });

  it('SOH derates the reported deliverable capacity by exactly SOH x usable DoD', () => {
    const system = makeSystem({ ratedEnergyKwh: 200, usableDodPct: 90 });
    const { technical } = runIntervalDispatch(
      peakyDay(), system, makeTariff(), makeDiesel(), makeSolar(), makeFinancial(), [...ALL_PRIORITIES], 15,
      { batterySohPct: 80 }
    );
    expect(technical.deliverableCapacityKwh).toBeCloseTo(200 * 0.8 * 0.9, 9);
  });
});

describe('runMultiYearSimulation', () => {
  const baseInput = () => ({
    intervals: peakyDay(),
    system: makeSystem({ projectLifeYears: 10 }),
    tariff: makeTariff(),
    diesel: makeDiesel(),
    solar: makeSolar(),
    financial: makeFinancial(),
    priorities: [...ALL_PRIORITIES],
    intervalMinutes: 15
  });

  it('year 1 is byte-identical to a single beginning-of-life dispatch run', () => {
    const input = baseInput();
    const single = runIntervalDispatch(
      input.intervals, input.system, input.tariff, input.diesel, input.solar, input.financial,
      input.priorities, input.intervalMinutes
    );
    const multi = runMultiYearSimulation(input);

    expect(multi.years[0].savings).toEqual(single.savings);
    expect(multi.years[0].technical).toEqual(single.technical);
    expect(multi.yearOneIntervals).toEqual(single.simulatedIntervals);
  });

  it('produces one simulated year per project year with a non-increasing SOH trajectory', () => {
    const result = runMultiYearSimulation(baseInput());

    expect(result.years).toHaveLength(10);
    expect(result.years[0].sohPctStartOfYear).toBe(100);
    for (let i = 1; i < result.years.length; i++) {
      expect(result.years[i].sohPctStartOfYear).toBeLessThanOrEqual(result.years[i - 1].sohPctStartOfYear);
    }
    expect(result.sohForecast.years).toHaveLength(10);
  });

  it('later years discharge no more than year 1, because capacity actually shrank', () => {
    const result = runMultiYearSimulation({ ...baseInput(), batteryOverrides: { calendarLifeYears: 6 } });
    const yearOne = result.years[0].technical.energyDischargedKwh;
    const lastYear = result.years[result.years.length - 1];

    expect(lastYear.sohPctStartOfYear).toBeLessThan(100);
    expect(lastYear.technical.energyDischargedKwh).toBeLessThanOrEqual(yearOne);
  });
});
