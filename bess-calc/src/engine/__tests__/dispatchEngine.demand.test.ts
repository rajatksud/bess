import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

describe('demand charge saving', () => {
  it('reduces annual demand saving by kVA-shaved x rate x 12, honoring site power factor', () => {
    const pf = 0.9;
    const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 500, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ powerFactor: pf, demandChargePerKvaMonth: 400, contractDemandKva: 1000, minimumBillingDemandPct: 0 });
    // Single peak interval at 300 kW; battery (100 kW) should shave it to 200 kW.
    const intervals = [
      makeInterval({ loadKw: 300, loadKva: 300 / pf, gridAvailable: true }),
      ...Array.from({ length: 95 }, (_, i) => makeInterval({ intervalIndex: i + 1, loadKw: 50, loadKva: 50 / pf, gridAvailable: true }))
    ];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['peak_shaving'],
      15
    );

    // Peak before = 300/0.9 kVA, peak after = 200/0.9 kVA (100 kW shaved by full rated power).
    expect(technical.peakBeforeKva).toBeCloseTo(300 / pf, 5);
    expect(technical.peakAfterKva).toBeCloseTo(200 / pf, 5);

    const expectedKvaReduced = (300 - 200) / pf;
    const expectedAnnualDemandSaving = expectedKvaReduced * tariff.demandChargePerKvaMonth * 12;
    expect(savings.demandChargeSaving).toBeCloseTo(expectedAnnualDemandSaving, 2);
  });

  it('floors billed demand after BESS at the minimum billing demand percentage of contract kVA', () => {
    const pf = 1.0;
    // Battery is smaller than the peak (280 kW rated vs 300 kW peak) so peak_shaving
    // genuinely engages (there is a real peak above targetPeakKw to shave), but the
    // resulting post-BESS peak (20 kW) falls below the 75%-of-contract-kVA floor.
    const system = makeSystem({ ratedPowerKw: 280, ratedEnergyKwh: 5000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ powerFactor: pf, demandChargePerKvaMonth: 400, contractDemandKva: 300, minimumBillingDemandPct: 75 });
    const intervals = [makeInterval({ loadKw: 300, loadKva: 300, gridAvailable: true })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['peak_shaving'],
      15
    );

    // Confirm shaving actually occurred (peak dropped from 300 to 20 kW) before
    // asserting the floor - otherwise this test would pass vacuously at zero saving.
    expect(technical.peakAfterKw).toBeCloseTo(20, 5);

    const billedKvaBefore = 300; // min(contract 300, peak 300)
    const billedKvaAfter = Math.max(20, tariff.contractDemandKva * 0.75); // floor applies since peak-after (20) is below it
    const expectedKvaReduced = billedKvaBefore - billedKvaAfter;
    const expectedSaving = expectedKvaReduced * tariff.demandChargePerKvaMonth * 12;
    expect(savings.demandChargeSaving).toBeCloseTo(expectedSaving, 2);
  });
});

describe('diesel displacement saving', () => {
  it('computes fuel saving as displaced kWh x specific fuel consumption x price per litre', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const diesel = makeDiesel({ specificFuelConsumptionLitrePerKwh: 0.3, dieselPricePerLitre: 100 });
    // One 15-min outage interval per simulated day, fully covered by the battery.
    const intervals = [makeInterval({ loadKw: 100, gridAvailable: false, dgRequiredKw: 100 })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, makeTariff(), diesel, makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['backup_reserve'],
      15
    );

    const dailyDgDisplacedKwh = 100 * 0.25; // 100 kW for 15 min
    const annualDgDisplacedKwh = dailyDgDisplacedKwh * 365;
    expect(technical.dgEnergyDisplacedKwh).toBeCloseTo(annualDgDisplacedKwh, 5);

    const expectedFuelSaving = annualDgDisplacedKwh * diesel.specificFuelConsumptionLitrePerKwh * diesel.dieselPricePerLitre;
    expect(savings.dieselFuelSaving).toBeCloseTo(expectedFuelSaving, 2);
  });

  it('produces zero diesel saving when the grid is available (no DG requirement)', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    const intervals = [makeInterval({ loadKw: 100, gridAvailable: true, dgRequiredKw: 0 })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel(), makeSolar({ enableSolarIntegration: false }), makeFinancial(),
      ['diesel_displacement'],
      15
    );

    expect(technical.dgEnergyDisplacedKwh).toBe(0);
    expect(savings.dieselFuelSaving).toBe(0);
  });
});

describe('solar self-consumption saving', () => {
  it('values stored solar at (import tariff - export credit) per kWh when export is permitted', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 0, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ energyChargePerKwh: 10 });
    // Export permitted: storing the kWh forgoes an export credit it could have earned.
    const solar = makeSolar({ exportCreditPerKwh: 4, exportAllowed: true });
    const intervals = [makeInterval({ loadKw: 0, solarKw: 100, gridAvailable: true })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), solar, makeFinancial(),
      ['solar_self_consumption'],
      15
    );

    const dailySolarStoredKwh = 100 * 0.25;
    const annualSolarStoredKwh = dailySolarStoredKwh * 365;
    expect(technical.solarEnergyStoredKwh).toBeCloseTo(annualSolarStoredKwh, 5);

    const expectedSaving = annualSolarStoredKwh * (tariff.energyChargePerKwh - solar.exportCreditPerKwh);
    expect(savings.solarSelfConsumptionSaving).toBeCloseTo(expectedSaving, 2);
  });

  it('values stored solar at the FULL import tariff when export is prohibited', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 0, minSocPct: 0, reserveSocPct: 0 });
    const tariff = makeTariff({ energyChargePerKwh: 10 });
    // Zero-export site: the alternative to storing the kWh is curtailing it, which
    // recovers nothing. Netting off an export credit the site cannot earn would
    // understate the battery's benefit - the capacity is paid for either way.
    const solar = makeSolar({ exportCreditPerKwh: 4, exportAllowed: false });
    const intervals = [makeInterval({ loadKw: 0, solarKw: 100, gridAvailable: true })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, tariff, makeDiesel({ enableDieselDisplacement: false }), solar, makeFinancial(),
      ['solar_self_consumption'],
      15
    );

    const annualSolarStoredKwh = 100 * 0.25 * 365;
    expect(technical.solarEnergyStoredKwh).toBeCloseTo(annualSolarStoredKwh, 5);
    expect(savings.solarSelfConsumptionSaving).toBeCloseTo(annualSolarStoredKwh * tariff.energyChargePerKwh, 2);
  });

  it('produces zero solar saving when solar integration is disabled in dispatch priorities', () => {
    const system = makeSystem({ ratedPowerKw: 200, ratedEnergyKwh: 1000, initialSocPct: 0, minSocPct: 0, reserveSocPct: 0 });
    const intervals = [makeInterval({ loadKw: 0, solarKw: 100, gridAvailable: true })];

    const { savings, technical } = runIntervalDispatch(
      intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }), makeSolar(), makeFinancial(),
      ['backup_reserve', 'peak_shaving', 'diesel_displacement', 'tou_arbitrage'], // solar_self_consumption omitted
      15
    );

    expect(technical.solarEnergyStoredKwh).toBe(0);
    expect(savings.solarSelfConsumptionSaving).toBe(0);
  });
});
