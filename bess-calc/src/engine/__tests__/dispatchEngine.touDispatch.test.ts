import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// A TOU structure expressed as modest per-kWh deltas against the base energy charge -
// a Rs 1 night rebate and a Rs 1 surcharge on both the morning and evening peaks. The
// engine previously keyed dispatch off period NAMES or a +/-20% rate threshold, so a
// spread this narrow (-/+10.5%) drove no battery action at all unless the periods
// carried the exact magic names.
const BASE_RATE = 9.5;
const NIGHT_RATE = BASE_RATE - 1;  // 8.5
const PEAK_RATE = BASE_RATE + 1;   // 10.5

const deltaTariff = makeTariff({
  enableTou: true,
  energyChargePerKwh: BASE_RATE,
  powerFactor: 1,
  touPeriods: [
    { id: 'night', name: 'Night Rebate', startTime: '22:00', endTime: '06:00', importRatePerKwh: NIGHT_RATE, kind: 'off_peak' },
    { id: 'am', name: 'Morning Peak', startTime: '06:00', endTime: '09:00', importRatePerKwh: PEAK_RATE, kind: 'peak' },
    { id: 'std', name: 'Standard', startTime: '09:00', endTime: '18:00', importRatePerKwh: BASE_RATE, kind: 'standard' },
    { id: 'pm', name: 'Evening Peak', startTime: '18:00', endTime: '22:00', importRatePerKwh: PEAK_RATE, kind: 'peak' }
  ]
});

describe('TOU dispatch on per-kWh surcharge/rebate deltas', () => {
  it('charges on the night rebate and discharges on both peaks', () => {
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    const intervals = [
      makeInterval({ intervalIndex: 0, timeLabel: '02:00', loadKw: 80, tariffImportRate: NIGHT_RATE, tariffPeriod: 'Night Rebate', tariffPeriodKind: 'off_peak' }),
      makeInterval({ intervalIndex: 1, timeLabel: '07:00', loadKw: 80, tariffImportRate: PEAK_RATE, tariffPeriod: 'Morning Peak', tariffPeriodKind: 'peak' }),
      makeInterval({ intervalIndex: 2, timeLabel: '13:00', loadKw: 80, tariffImportRate: BASE_RATE, tariffPeriod: 'Standard', tariffPeriodKind: 'standard' }),
      makeInterval({ intervalIndex: 3, timeLabel: '20:00', loadKw: 80, tariffImportRate: PEAK_RATE, tariffPeriod: 'Evening Peak', tariffPeriodKind: 'peak' })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, deltaTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('TOU Off-Peak Charge');
    expect(simulatedIntervals[1].bessAction).toBe('TOU Arbitrage Discharge');
    expect(simulatedIntervals[2].bessAction).toBe('Idle');   // standard: neither
    expect(simulatedIntervals[3].bessAction).toBe('TOU Arbitrage Discharge');
  });

  it('classifies from the rate alone when the interval declares no period kind', () => {
    // CSV-imported intervals carry rates but not necessarily a classified period.
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 80, tariffImportRate: NIGHT_RATE, tariffPeriod: undefined }),
      makeInterval({ intervalIndex: 1, loadKw: 80, tariffImportRate: PEAK_RATE, tariffPeriod: undefined })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, deltaTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('TOU Off-Peak Charge');
    expect(simulatedIntervals[1].bessAction).toBe('TOU Arbitrage Discharge');
  });

  it('suppresses off-peak charging when the spread cannot cover round-trip losses', () => {
    // A 20 paise rebate: 9.3 / 0.9025 = 10.30 delivered, above the 9.7 peak rate.
    const narrowTariff = makeTariff({
      enableTou: true,
      energyChargePerKwh: BASE_RATE,
      powerFactor: 1,
      touPeriods: [
        { id: 'night', name: 'Night Rebate', startTime: '22:00', endTime: '06:00', importRatePerKwh: 9.3, kind: 'off_peak' },
        { id: 'pm', name: 'Evening Peak', startTime: '18:00', endTime: '22:00', importRatePerKwh: 9.7, kind: 'peak' }
      ]
    });
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 80, tariffImportRate: 9.3, tariffPeriodKind: 'off_peak' }),
      makeInterval({ intervalIndex: 1, loadKw: 80, tariffImportRate: 9.7, tariffPeriodKind: 'peak' })
    ];

    const { simulatedIntervals, savings, assumptions } = runIntervalDispatch(
      intervals, system, narrowTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('Idle');
    expect(savings.chargingEnergyCost).toBe(0);
    expect(assumptions.some(a => a.includes('Off-peak grid charging is suppressed'))).toBe(true);
    // Discharging stored energy on peak is still allowed - it buys nothing to do so.
    expect(simulatedIntervals[1].bessAction).toBe('TOU Arbitrage Discharge');
  });

  it('sizes peak discharge against meter-side import, not gross load', () => {
    // 200 kW gross load with 150 kW of solar already serving it leaves only 50 kW of
    // metered import to avoid; discharging the full 200 kW would push energy back
    // through the meter rather than avoid a peak-rate purchase.
    const system = makeSystem({ ratedPowerKw: 300, ratedEnergyKwh: 2000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 200, solarKw: 150, tariffImportRate: PEAK_RATE, tariffPeriodKind: 'peak' })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, deltaTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].batteryDischargeKw).toBeCloseTo(50, 6);
    expect(simulatedIntervals[0].postBessGridImportKw).toBeCloseTo(0, 6);
  });

  it('prices the arbitrage saving and charging cost at the observed peak and off-peak rates', () => {
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 80, tariffImportRate: NIGHT_RATE, tariffPeriodKind: 'off_peak' }),
      makeInterval({ intervalIndex: 1, loadKw: 80, tariffImportRate: PEAK_RATE, tariffPeriodKind: 'peak' })
    ];

    const { savings, simulatedIntervals } = runIntervalDispatch(
      intervals, system, deltaTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    const chargedKwh = simulatedIntervals[0].batteryChargeKw * 0.25 * 365;
    const dischargedKwh = simulatedIntervals[1].batteryDischargeKw * 0.25 * 365;

    expect(savings.energyArbitrageSaving).toBeCloseTo(dischargedKwh * PEAK_RATE, 2);
    expect(savings.chargingEnergyCost).toBeCloseTo(chargedKwh * NIGHT_RATE, 2);
    // The spread must actually be worth something after losses.
    expect(savings.energyArbitrageSaving).toBeGreaterThan(0);
  });

  it('honours solar-only charging by refusing the night rebate charge', () => {
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100 });
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 80, tariffImportRate: NIGHT_RATE, tariffPeriodKind: 'off_peak' })
    ];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, deltaTariff, makeDiesel({ enableDieselDisplacement: false }),
      makeSolar({ enableSolarIntegration: true, solarOnlyCharging: true }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    expect(simulatedIntervals[0].bessAction).toBe('Idle');
    expect(simulatedIntervals[0].gridBatteryChargeKw).toBe(0);
  });
});
