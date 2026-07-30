import { describe, it, expect } from 'vitest';
import { calculateTariffBill } from '../tariffEngine';
import { toBillingIntervals } from '../dispatchAdapter';
import { makeFlatTariff, makeFlatIntervals } from './fixtures';
import { SAMPLE_GENERIC_INDIA_CI_HT_TARIFF } from '../fixtures/sampleTariffs';
import { IntervalRecord } from '../../types/bess';

describe('end-to-end avoided-cost calculation', () => {
  it('computes a positive net avoided cost when post-BESS import is lower than baseline', () => {
    const tariff = makeFlatTariff({ demandCharges: { basis: 'measured_maximum', ratePerKw: 300 } });
    const intervals = [
      { timestamp: '2024-06-15T00:00:00.000Z', durationHours: 0.25, baselineGridImportKw: 300, postBessGridImportKw: 200 },
      { timestamp: '2024-06-15T00:15:00.000Z', durationHours: 0.25, baselineGridImportKw: 300, postBessGridImportKw: 200 }
    ];
    const result = calculateTariffBill(tariff, { intervals, asOfDate: '2024-06-15', sourceCadenceMinutes: 15 });

    expect(result.baselineBill.totalBill).toBeGreaterThan(result.postBessBill.totalBill);
    expect(result.netAvoidedCost).toBeGreaterThan(0);
    expect(result.baselineBill.billedDemandKw).toBeCloseTo(300, 5);
    expect(result.postBessBill.billedDemandKw).toBeCloseTo(200, 5);
  });

  it('produces zero avoided cost when the BESS makes no difference', () => {
    const tariff = makeFlatTariff();
    const intervals = makeFlatIntervals(4, 150);
    const result = calculateTariffBill(tariff, { intervals, asOfDate: '2024-06-15', sourceCadenceMinutes: 15 });
    expect(result.netAvoidedCost).toBeCloseTo(0, 5);
  });

  it('flags applicability/effective-date issues in the warnings list', () => {
    const tariff = makeFlatTariff({ effectiveFrom: '2030-01-01' });
    const intervals = makeFlatIntervals(4, 100);
    const result = calculateTariffBill(tariff, { intervals, asOfDate: '2024-06-15', sourceCadenceMinutes: 15 });
    expect(result.warnings.some(w => w.code === 'TARIFF_NOT_EFFECTIVE')).toBe(true);
  });

  it('runs end-to-end against the SAMPLE illustrative Indian C&I HT tariff via the dispatch adapter', () => {
    const dispatchIntervals: IntervalRecord[] = Array.from({ length: 4 }, (_, i) => ({
      intervalIndex: i,
      timeLabel: `${String(i * 6).padStart(2, '0')}:00`,
      loadKw: 200,
      loadKva: 220,
      solarKw: 0,
      gridAvailable: true,
      dgRequiredKw: 0,
      tariffImportRate: 8.5,
      bessPowerKw: i === 0 ? 50 : 0,
      bessSocPct: 80,
      bessEnergyKwh: 200,
      postBessLoadKw: i === 0 ? 150 : 200,
      postBessLoadKva: i === 0 ? 165 : 220,
      postBessDgKw: 0,
      gridImportKw: i === 0 ? 150 : 200,
      gridExportKw: 0,
      solarCurtailedKw: 0,
      bessAction: i === 0 ? 'Peak Shaving' : 'Idle',
      grossSiteLoadKw: 200,
      solarGenerationKw: 0,
      solarGenerationServingLoadKw: 0,
      preBessGridImportKw: 200,
      postBessGridImportKw: i === 0 ? 150 : 200,
      batteryChargeKw: 0,
      batteryDischargeKw: i === 0 ? 50 : 0,
      gridBatteryChargeKw: 0,
      preBessGridImportKva: 200 / 0.9,
      postBessGridImportKva: (i === 0 ? 150 : 200) / 0.9
    }));

    const billingIntervals = toBillingIntervals(dispatchIntervals, '2024-06-15T00:00:00.000Z', 360);
    const result = calculateTariffBill(SAMPLE_GENERIC_INDIA_CI_HT_TARIFF, {
      intervals: billingIntervals,
      asOfDate: '2024-06-15',
      sourceCadenceMinutes: 360
    });

    expect(result.postBessBill.totalBill).toBeLessThan(result.baselineBill.totalBill);
    expect(result.netAvoidedCost).toBeGreaterThan(0);
    // Sample tariff is billed in kVA; cadence (360 min) is coarser than its 30-min
    // demand integration window, so the engine must flag this as non-engineering-grade.
    expect(result.warnings.some(w => w.code === 'CADENCE_COARSER_THAN_WINDOW')).toBe(true);
  });
});
