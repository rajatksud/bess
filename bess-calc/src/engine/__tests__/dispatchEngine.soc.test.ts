import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

describe('battery SOC + efficiency', () => {
  it('never discharges below minSocPct + reserveSocPct', () => {
    const system = makeSystem({ initialSocPct: 12, minSocPct: 10, reserveSocPct: 5, ratedEnergyKwh: 100, ratedPowerKw: 100 });
    // Heavy load during an outage forces maximum discharge for many consecutive intervals.
    const intervals = Array.from({ length: 20 }, (_, i) =>
      makeInterval({ intervalIndex: i, loadKw: 500, gridAvailable: false, dgRequiredKw: 500 })
    );

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'],
      15
    );

    const minAllowedSocPct = system.minSocPct + system.reserveSocPct;
    for (const inv of simulatedIntervals) {
      expect(inv.bessSocPct).toBeGreaterThanOrEqual(minAllowedSocPct - 0.01);
    }
  });

  it('never charges above maxSocPct', () => {
    const system = makeSystem({ initialSocPct: 95, maxSocPct: 100, ratedEnergyKwh: 100, ratedPowerKw: 100 });
    // Large surplus solar for many consecutive intervals forces maximum charging.
    const intervals = Array.from({ length: 20 }, (_, i) =>
      makeInterval({ intervalIndex: i, loadKw: 10, solarKw: 500, gridAvailable: true })
    );

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }), makeSolar(), makeFinancial(),
      ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'],
      15
    );

    for (const inv of simulatedIntervals) {
      expect(inv.bessSocPct).toBeLessThanOrEqual(system.maxSocPct + 0.01);
    }
  });

  it('applies discharge efficiency: grid-visible discharge is less than the SOC energy consumed', () => {
    // 100% DoD/SOC window and 80% discharge efficiency isolates the loss term.
    const system = makeSystem({
      ratedEnergyKwh: 100, ratedPowerKw: 100, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100,
      dischargeEfficiencyPct: 80, chargeEfficiencyPct: 80
    });
    const intervals = [makeInterval({ loadKw: 100, gridAvailable: false, dgRequiredKw: 100 })];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve'],
      15
    );

    // 100 kW discharged for 15 min = 25 kWh delivered to load.
    // Energy drawn from the battery store = 25 / 0.8 = 31.25 kWh -> SOC drops by 31.25%.
    expect(simulatedIntervals[0].bessPowerKw).toBeCloseTo(100, 5);
    expect(simulatedIntervals[0].bessSocPct).toBeCloseTo(100 - 31.25, 5);
  });

  it('applies charge efficiency: stored energy is less than the grid/solar energy consumed', () => {
    const system = makeSystem({
      ratedEnergyKwh: 100, ratedPowerKw: 100, initialSocPct: 0, minSocPct: 0, reserveSocPct: 0, maxSocPct: 100,
      dischargeEfficiencyPct: 90, chargeEfficiencyPct: 90
    });
    const intervals = [makeInterval({ loadKw: 0, solarKw: 100, gridAvailable: true })];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }), makeSolar(), makeFinancial(),
      ['solar_self_consumption'],
      15
    );

    // 100 kW solar surplus charged for 15 min = 25 kWh drawn from solar.
    // Stored energy = 25 * 0.9 = 22.5 kWh -> SOC rises by 22.5%.
    expect(simulatedIntervals[0].bessPowerKw).toBeCloseTo(-100, 5);
    expect(simulatedIntervals[0].bessSocPct).toBeCloseTo(22.5, 5);
  });

  it('clamps discharge power to the rated power limit even when load and SOC allow more', () => {
    const system = makeSystem({ ratedEnergyKwh: 1000, ratedPowerKw: 50, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const intervals = [makeInterval({ loadKw: 500, gridAvailable: false, dgRequiredKw: 500 })];

    const { simulatedIntervals } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve'],
      15
    );

    expect(simulatedIntervals[0].bessPowerKw).toBeLessThanOrEqual(system.ratedPowerKw + 1e-9);
  });
});
