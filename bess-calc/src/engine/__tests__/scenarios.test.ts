import { describe, it, expect } from 'vitest';
import { runIntervalDispatch } from '../dispatchEngine';
import { validateSimulationResult } from '../validationEngine';
import { calculateFinancialMetrics } from '../financialEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// Three reference scenarios from the nightly build task brief. Each builds a small,
// hand-authored interval profile (rather than the full presetProfiles.ts generators)
// so the expected physical/commercial behaviour is easy to state and verify directly.

describe('Scenario A: Industrial Peak Shaving (500 kW peak load, 250 kW / 500 kWh BESS)', () => {
  const system = makeSystem({ ratedPowerKw: 250, ratedEnergyKwh: 500, initialSocPct: 100, minSocPct: 10, reserveSocPct: 0, maxSocPct: 100 });
  const tariff = makeTariff({ powerFactor: 1, demandChargePerKvaMonth: 400, contractDemandKva: 600, minimumBillingDemandPct: 0, enableTou: false });
  const diesel = makeDiesel({ enableDieselDisplacement: false });
  const solar = makeSolar({ enableSolarIntegration: false });
  const financial = makeFinancial();

  // One sharp 500 kW peak, otherwise a flat 200 kW base load, all on-grid.
  const intervals = [
    ...Array.from({ length: 40 }, (_, i) => makeInterval({ intervalIndex: i, loadKw: 200, loadKva: 200, gridAvailable: true })),
    makeInterval({ intervalIndex: 40, loadKw: 500, loadKva: 500, gridAvailable: true }),
    ...Array.from({ length: 55 }, (_, i) => makeInterval({ intervalIndex: i + 41, loadKw: 200, loadKva: 200, gridAvailable: true }))
  ];

  const { simulatedIntervals, savings, technical } = runIntervalDispatch(
    intervals, system, tariff, diesel, solar, financial, ['peak_shaving'], 15
  );
  const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

  it('reduces the post-BESS peak by up to the rated power (500 kW -> 250 kW)', () => {
    expect(technical.peakBeforeKw).toBe(500);
    expect(technical.peakAfterKw).toBeCloseTo(500 - system.ratedPowerKw, 5);
  });

  it('maintains a valid single-battery energy balance (SOC never leaves configured bounds)', () => {
    for (const inv of simulatedIntervals) {
      expect(inv.bessSocPct).toBeGreaterThanOrEqual(system.minSocPct - 0.01);
      expect(inv.bessSocPct).toBeLessThanOrEqual(system.maxSocPct + 0.01);
    }
  });

  it('produces a positive, physically-grounded demand charge saving with no validation errors', () => {
    expect(savings.demandChargeSaving).toBeGreaterThan(0);
    const warnings = validateSimulationResult(simulatedIntervals, system, diesel, solar, savings, technical, financialResult, 15);
    expect(warnings.filter(w => w.level === 'error')).toEqual([]);
  });
});

describe('Scenario B: Solar + BESS (excess solar charging, reduced export, evening discharge)', () => {
  const system = makeSystem({ ratedPowerKw: 100, ratedEnergyKwh: 400, initialSocPct: 20, minSocPct: 10, reserveSocPct: 0, maxSocPct: 100 });
  const tariff = makeTariff({ enableTou: false, energyChargePerKwh: 10 });
  const diesel = makeDiesel({ enableDieselDisplacement: false });
  const solar = makeSolar({ exportCreditPerKwh: 3, exportAllowed: true });
  const financial = makeFinancial();

  // Midday: solar (150 kW) exceeds load (50 kW) -> 100 kW surplus should charge the
  // battery instead of being exported. Evening: no solar, higher load -> battery
  // should discharge to serve load instead of importing from the grid.
  const middayIntervals = Array.from({ length: 16 }, (_, i) => // 10:00-14:00
    makeInterval({ intervalIndex: i, timeLabel: `${10 + Math.floor(i / 4)}:00`, loadKw: 50, solarKw: 150, gridAvailable: true })
  );
  const eveningIntervals = Array.from({ length: 16 }, (_, i) => // 18:00-22:00
    makeInterval({ intervalIndex: i + 16, timeLabel: `${18 + Math.floor(i / 4)}:00`, loadKw: 80, solarKw: 0, gridAvailable: true })
  );
  const intervals = [...middayIntervals, ...eveningIntervals];

  const { simulatedIntervals, savings, technical } = runIntervalDispatch(
    intervals, system, tariff, diesel, solar, financial,
    ['peak_shaving', 'solar_self_consumption'],
    15
  );
  const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

  it('charges the battery from excess midday solar rather than exporting all of it', () => {
    const middayResults = simulatedIntervals.slice(0, 16);
    const chargingIntervals = middayResults.filter(inv => inv.bessAction === 'Solar Surplus Charging');
    expect(chargingIntervals.length).toBeGreaterThan(0);
    expect(technical.solarEnergyStoredKwh).toBeGreaterThan(0);
  });

  it('reduces grid export relative to raw uncharged surplus solar (100 kW x 4h = 400 kWh/day)', () => {
    const middayResults = simulatedIntervals.slice(0, 16);
    const totalExportedKwh = middayResults.reduce((sum, inv) => sum + inv.gridExportKw * 0.25, 0);
    const rawSurplusKwh = 16 * (150 - 50) * 0.25; // 400 kWh if none of it were absorbed
    expect(totalExportedKwh).toBeLessThan(rawSurplusKwh);
  });

  it('discharges the stored solar energy to serve evening load instead of importing 1:1', () => {
    const eveningResults = simulatedIntervals.slice(16);
    const dischargingIntervals = eveningResults.filter(inv => inv.bessPowerKw > 0);
    expect(dischargingIntervals.length).toBeGreaterThan(0);

    const totalEveningImportKwh = eveningResults.reduce((sum, inv) => sum + inv.gridImportKw * 0.25, 0);
    const rawEveningLoadKwh = 16 * 80 * 0.25; // if the battery contributed nothing
    expect(totalEveningImportKwh).toBeLessThan(rawEveningLoadKwh);
  });

  it('produces no validation errors for the full day', () => {
    const warnings = validateSimulationResult(simulatedIntervals, system, diesel, solar, savings, technical, financialResult, 15);
    expect(warnings.filter(w => w.level === 'error')).toEqual([]);
  });
});

describe('Scenario C: DG Replacement (grid outage window, DG energy displaced, fuel saved)', () => {
  const system = makeSystem({ ratedPowerKw: 150, ratedEnergyKwh: 600, initialSocPct: 100, minSocPct: 10, reserveSocPct: 10, maxSocPct: 100 });
  const tariff = makeTariff();
  const diesel = makeDiesel({ specificFuelConsumptionLitrePerKwh: 0.28, dieselPricePerLitre: 92 });
  const solar = makeSolar({ enableSolarIntegration: false });
  const financial = makeFinancial();

  // 4-hour outage window (16 x 15-min intervals) at 100 kW load, fully within battery's
  // rated power and available capacity; rest of the day is grid-available with no DG need.
  const outageIntervals = Array.from({ length: 16 }, (_, i) =>
    makeInterval({ intervalIndex: i, timeLabel: `18:${i}`, loadKw: 100, gridAvailable: false, dgRequiredKw: 100 })
  );
  const gridIntervals = Array.from({ length: 80 }, (_, i) =>
    makeInterval({ intervalIndex: i + 16, loadKw: 60, gridAvailable: true, dgRequiredKw: 0 })
  );
  const intervals = [...outageIntervals, ...gridIntervals];

  const { simulatedIntervals, savings, technical } = runIntervalDispatch(
    intervals, system, tariff, diesel, solar, financial, ['backup_reserve'], 15
  );
  const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

  it('fully covers the outage-period load from the battery with no unserved backup energy', () => {
    const outageResults = simulatedIntervals.slice(0, 16);
    for (const inv of outageResults) {
      expect(inv.postBessDgKw).toBeCloseTo(0, 5);
    }
    expect(technical.unservedBackupEnergyKwh).toBeCloseTo(0, 2);
  });

  it('displaces exactly the outage-period DG energy requirement, annualised (no more, no less)', () => {
    const dailyDgRequiredKwh = 16 * 100 * 0.25; // 400 kWh/day
    const expectedAnnualDgDisplacedKwh = dailyDgRequiredKwh * 365;
    expect(technical.dgEnergyDisplacedKwh).toBeCloseTo(expectedAnnualDgDisplacedKwh, 2);
  });

  it('computes a positive diesel fuel saving consistent with fuel factor x price', () => {
    const expectedFuelSaving = technical.dgEnergyDisplacedKwh * diesel.specificFuelConsumptionLitrePerKwh * diesel.dieselPricePerLitre;
    expect(savings.dieselFuelSaving).toBeCloseTo(expectedFuelSaving, 2);
    expect(savings.dieselFuelSaving).toBeGreaterThan(0);
  });

  it('produces no validation errors for the outage + grid-available day', () => {
    const warnings = validateSimulationResult(simulatedIntervals, system, diesel, solar, savings, technical, financialResult, 15);
    expect(warnings.filter(w => w.level === 'error')).toEqual([]);
  });
});
