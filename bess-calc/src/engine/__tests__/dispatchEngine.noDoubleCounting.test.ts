import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// Regression coverage for the Rule 2 (no double counting) fix: the energy-arbitrage
// saving must be computed only from energy the dispatch loop tagged as TOU arbitrage,
// never from the aggregate of every discharge category (backup/DG + peak shaving +
// arbitrage combined).
describe('Rule 2: no double counting across savings categories', () => {
  it('does not credit arbitrage savings for energy already tagged as diesel/backup displacement', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ enableTou: false, energyChargePerKwh: 9.5 });
    // Only the backup_reserve priority is active - every discharged kWh here MUST be
    // attributed to diesel displacement, never to arbitrage.
    const intervals = [makeInterval({ loadKw: 100, gridAvailable: false, dgRequiredKw: 100 })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve'],
      15
    );

    expect(technical.dgEnergyDisplacedKwh).toBeGreaterThan(0);
    expect(savings.dieselFuelSaving).toBeGreaterThan(0);
    // The only discharge in this run was backup/DG displacement - arbitrage saving
    // must be exactly zero, not some fraction of the diesel-displaced energy.
    expect(savings.energyArbitrageSaving).toBe(0);
  });

  it('does not credit arbitrage savings for energy already tagged as peak shaving', () => {
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ enableTou: false, powerFactor: 1, minimumBillingDemandPct: 0 });
    const intervals = [
      makeInterval({ loadKw: 300, loadKva: 300, gridAvailable: true }),
      ...Array.from({ length: 95 }, (_, i) => makeInterval({ intervalIndex: i + 1, loadKw: 50, loadKva: 50, gridAvailable: true }))
    ];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['peak_shaving'],
      15
    );

    expect(technical.energyDischargedKwh).toBeGreaterThan(0);
    expect(savings.demandChargeSaving).toBeGreaterThan(0);
    expect(savings.energyArbitrageSaving).toBe(0);
  });

  it('credits arbitrage savings only for the TOU-tagged share when multiple priorities are active in the same run', () => {
    const system = makeSystem({ ratedPowerKw: 500, ratedEnergyKwh: 5000, initialSocPct: 50, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({
      enableTou: true,
      energyChargePerKwh: 9.5,
      touPeriods: [
        { id: 'off', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 5 },
        { id: 'peak', name: 'Peak Surge', startTime: '18:00', endTime: '22:00', importRatePerKwh: 15 }
      ]
    });

    // One outage interval (backup/DG), one off-peak charging interval (arbitrage charge),
    // one TOU-peak discharge interval (arbitrage discharge). Distinct, non-overlapping
    // dispatch reasons in the same simulation run.
    const intervals = [
      makeInterval({ intervalIndex: 0, timeLabel: '02:00', loadKw: 50, gridAvailable: false, dgRequiredKw: 50, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 1, timeLabel: '03:00', loadKw: 10, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 }),
      makeInterval({ intervalIndex: 2, timeLabel: '19:00', loadKw: 80, gridAvailable: true, tariffPeriod: 'Peak Surge', tariffImportRate: 15 })
    ];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve', 'tou_arbitrage'],
      15
    );

    // Diesel saving comes only from the outage interval's 50 kW * 0.25h.
    const expectedAnnualDgKwh = 50 * 0.25 * 365;
    expect(technical.dgEnergyDisplacedKwh).toBeCloseTo(expectedAnnualDgKwh, 5);

    // Arbitrage discharge comes only from the 19:00 interval's 80 kW * 0.25h, priced at
    // the peak TOU rate (15) - NOT at the combined total discharge across all intervals.
    const expectedAnnualArbitrageDischargeKwh = 80 * 0.25 * 365;
    const expectedArbitrageSaving = expectedAnnualArbitrageDischargeKwh * 15;
    expect(savings.energyArbitrageSaving).toBeCloseTo(expectedArbitrageSaving, 2);

    // Total discharge across the run is diesel-discharge + arbitrage-discharge; confirm
    // the arbitrage saving was NOT derived from this combined total (which would produce
    // a materially different, larger number).
    const wrongDoubleCountedSaving = technical.energyDischargedKwh * 0.2 * tariff.energyChargePerKwh;
    expect(savings.energyArbitrageSaving).not.toBeCloseTo(wrongDoubleCountedSaving, 0);
  });

  it('charging cost is priced at the actual off-peak TOU rate, not an approximated flat factor', () => {
    const system = makeSystem({ ratedPowerKw: 500, ratedEnergyKwh: 5000, initialSocPct: 0, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({
      enableTou: true,
      energyChargePerKwh: 9.5,
      touPeriods: [{ id: 'off', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 5 }]
    });
    const intervals = [makeInterval({ loadKw: 10, gridAvailable: true, tariffPeriod: 'Off-Peak Discount', tariffImportRate: 5 })];

    const { savings } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['tou_arbitrage'],
      15
    );

    // Full rated power (500 kW) charges for 15 min = 125 kWh/day -> 45625 kWh/yr, at the
    // actual off-peak rate of 5/kWh (not 0.8 * 9.5 = 7.6/kWh from the old approximation).
    const expectedAnnualChargedKwh = 500 * 0.25 * 365;
    const expectedChargingCost = expectedAnnualChargedKwh * 5;
    expect(savings.chargingEnergyCost).toBeCloseTo(expectedChargingCost, 2);
  });
});
