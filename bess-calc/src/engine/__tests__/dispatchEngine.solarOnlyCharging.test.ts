import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { validateBessConfig } from '../validationEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// Coverage for the solar-only charging constraint (SolarInput.solarOnlyCharging):
// when enabled the battery may charge ONLY from surplus solar, so every grid-sourced
// charge path is suppressed and the daily charge tracks solar generation.
describe('solar-only charging constraint', () => {
  const touTariff = makeTariff({
    enableTou: true,
    energyChargePerKwh: 9.5,
    touPeriods: [
      { id: 'off', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 5 },
      { id: 'peak', name: 'Peak Surge', startTime: '18:00', endTime: '22:00', importRatePerKwh: 15 }
    ]
  });

  // An off-peak interval with no solar at all: the only charge path available is the
  // TOU off-peak grid charge.
  const offPeakGridChargeIntervals = [
    makeInterval({
      intervalIndex: 0,
      timeLabel: '02:00',
      loadKw: 10,
      solarKw: 0,
      gridAvailable: true,
      tariffPeriod: 'Off-Peak Discount',
      tariffImportRate: 5
    })
  ];

  it('charges from the grid off-peak when the constraint is off (baseline behaviour)', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 20, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });

    const { simulatedIntervals, technical, savings } = runIntervalDispatch(
      offPeakGridChargeIntervals,
      system,
      touTariff,
      makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false, solarOnlyCharging: false }),
      makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('TOU Off-Peak Charge');
    expect(simulatedIntervals[0].gridBatteryChargeKw).toBeGreaterThan(0);
    expect(technical.energyChargedKwh).toBeGreaterThan(0);
    expect(savings.chargingEnergyCost).toBeGreaterThan(0);
  });

  it('suppresses off-peak grid charging entirely when the constraint is on', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 20, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });

    const { simulatedIntervals, technical, savings } = runIntervalDispatch(
      offPeakGridChargeIntervals,
      system,
      touTariff,
      makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true, solarOnlyCharging: true }),
      makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('Idle');
    expect(simulatedIntervals[0].batteryChargeKw).toBe(0);
    expect(technical.energyChargedKwh).toBe(0);
    // No grid energy was bought to charge, so there is no charging cost to deduct.
    expect(savings.chargingEnergyCost).toBe(0);
  });

  it('still charges from surplus solar when the constraint is on', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 20, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    // Midday surplus: 250 kW generation against 100 kW load leaves 150 kW spare.
    const intervals = [
      makeInterval({ intervalIndex: 0, timeLabel: '12:00', loadKw: 100, solarKw: 250, gridAvailable: true })
    ];

    const { simulatedIntervals, technical } = runIntervalDispatch(
      intervals,
      system,
      makeTariff(),
      makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true, solarOnlyCharging: true }),
      makeFinancial(),
      ['solar_self_consumption', 'tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('Solar Surplus Charging');
    expect(simulatedIntervals[0].batteryChargeKw).toBeCloseTo(150, 6);
    // Solar-sourced, so none of it is attributed to the grid.
    expect(simulatedIntervals[0].gridBatteryChargeKw).toBe(0);
    expect(technical.solarEnergyStoredKwh).toBeGreaterThan(0);
  });

  it('holds the invariant that no interval draws grid energy into the battery', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    // A full mixed day: off-peak night, a solar-surplus midday, and a TOU peak evening.
    const intervals = [
      makeInterval({ intervalIndex: 0, timeLabel: '02:00', loadKw: 40, solarKw: 0, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 1, timeLabel: '04:00', loadKw: 40, solarKw: 0, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 2, timeLabel: '12:00', loadKw: 100, solarKw: 260, gridAvailable: true, tariffPeriod: 'Standard', tariffImportRate: 9.5 }),
      makeInterval({ intervalIndex: 3, timeLabel: '19:00', loadKw: 120, solarKw: 0, gridAvailable: true, tariffPeriod: 'Peak Surge', tariffImportRate: 15 })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals,
      system,
      touTariff,
      makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true, solarOnlyCharging: true }),
      makeFinancial(),
      ['peak_shaving', 'solar_self_consumption', 'tou_arbitrage'],
      15
    );

    // The invariant that must hold for ANY charge branch, present or future.
    simulatedIntervals.forEach(inv => {
      expect(inv.gridBatteryChargeKw).toBe(0);
    });
    // Charging only ever happened in the solar-surplus interval.
    const chargingIntervals = simulatedIntervals.filter(inv => inv.batteryChargeKw > 0);
    expect(chargingIntervals).toHaveLength(1);
    expect(chargingIntervals[0].timeLabel).toBe('12:00');
  });

  it('surfaces the constraint in the reported assumptions', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000 });

    const { assumptions } = runIntervalDispatch(
      offPeakGridChargeIntervals,
      system,
      touTariff,
      makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true, solarOnlyCharging: true }),
      makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(assumptions.some(a => a.includes('Solar-only charging is enabled'))).toBe(true);
  });

  it('flags a configuration where solar-only charging leaves no charging source at all', () => {
    const { warnings } = validateBessConfig(
      makeSystem(),
      makeTariff(),
      makeDiesel(),
      makeSolar({ enableSolarIntegration: false, solarOnlyCharging: true }),
      makeFinancial(),
      'interval'
    );

    expect(warnings.some(w => w.code === 'SOLAR_ONLY_CHARGING_WITHOUT_SOLAR')).toBe(true);
  });

  it('leaves grid charging untouched for scenarios that omit the flag entirely', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 20, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    // Legacy/persisted scenario JSON has no solarOnlyCharging key at all.
    const legacySolar = makeSolar({ enableSolarIntegration: false });
    delete legacySolar.solarOnlyCharging;

    const { simulatedIntervals } = runIntervalDispatch(
      offPeakGridChargeIntervals,
      system,
      touTariff,
      makeDiesel({ enableDieselDisplacement: false }),
      legacySolar,
      makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('TOU Off-Peak Charge');
  });
});
