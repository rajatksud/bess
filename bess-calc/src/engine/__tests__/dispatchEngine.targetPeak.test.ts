import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// Regression coverage for the targetPeakKw fix: when the battery's rated power is
// greater than or equal to the profile's peak load, peak_shaving must not fire on
// every interval with nonzero load (which would starve lower-priority uses like
// solar self-consumption and arbitrage of any opportunity to claim the battery).
describe('peak_shaving does not fire on ordinary load when the battery already covers the whole peak', () => {
  it('lets solar_self_consumption claim intervals even when peak_shaving is listed first', () => {
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 20, minSocPct: 10, reserveSocPct: 0, maxSocPct: 100 });
    const tariff = makeTariff({ enableTou: false });
    const diesel = makeDiesel({ enableDieselDisplacement: false });
    const solar = makeSolar({ exportCreditPerKwh: 3, exportAllowed: true });
    const financial = makeFinancial();
    // Peak load across the profile (50 kW) is far below rated power (100 kW).
    const intervals = Array.from({ length: 8 }, (_, i) =>
      makeInterval({ intervalIndex: i, loadKw: 50, solarKw: 150, gridAvailable: true })
    );

    const { simulatedIntervals, technical } = runIntervalDispatch(
      intervals, system, tariff, diesel, solar, financial,
      ['peak_shaving', 'solar_self_consumption'],
      15
    );

    const chargingIntervals = simulatedIntervals.filter(inv => inv.bessAction === 'Solar Surplus Charging');
    expect(chargingIntervals.length).toBeGreaterThan(0);
    expect(technical.solarEnergyStoredKwh).toBeGreaterThan(0);
  });

  it('still shaves a genuine peak when the battery is smaller than the profile peak', () => {
    const system = makeSystem({ ratedPowerKw: 50, ratedEnergyKwh: 500, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ enableTou: false, powerFactor: 1 });
    const diesel = makeDiesel({ enableDieselDisplacement: false });
    const solar = makeSolar({ enableSolarIntegration: false });
    const financial = makeFinancial();
    const intervals = [
      makeInterval({ intervalIndex: 0, loadKw: 200, loadKva: 200, gridAvailable: true }),
      makeInterval({ intervalIndex: 1, loadKw: 50, loadKva: 50, gridAvailable: true })
    ];

    const { technical } = runIntervalDispatch(
      intervals, system, tariff, diesel, solar, financial,
      ['peak_shaving'],
      15
    );

    expect(technical.peakBeforeKw).toBe(200);
    expect(technical.peakAfterKw).toBeCloseTo(200 - system.ratedPowerKw, 5);
  });
});
