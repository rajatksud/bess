import { describe, it, expect } from 'vitest';
import { calculateDemandCharges } from '../demandCharges';
import { makeFlatIntervals } from './fixtures';
import { DemandChargeDefinition } from '../types';

const ctx = { timezone: 'Asia/Kolkata' };

describe('measured maximum demand', () => {
  it('bills the highest observed import across intervals', () => {
    const intervals = [
      ...makeFlatIntervals(2, 100),
      ...makeFlatIntervals(1, 250, '2024-06-15T01:00:00.000Z'),
      ...makeFlatIntervals(2, 80, '2024-06-15T02:00:00.000Z')
    ];
    const demand: DemandChargeDefinition = { basis: 'measured_maximum', ratePerKw: 300 };
    const result = calculateDemandCharges(intervals, demand, ctx);
    expect(result.billedDemandKw).toBeCloseTo(250, 5);
    expect(result.totalAmount).toBeCloseTo(250 * 300, 5);
  });
});

describe('contract demand basis with minimum billing demand floor', () => {
  it('floors billed demand at minimumBillingDemandPct of contract demand', () => {
    const intervals = makeFlatIntervals(4, 50); // well below contract demand
    const demand: DemandChargeDefinition = {
      basis: 'contract_demand',
      ratePerKw: 400,
      contractDemandKw: 300,
      minimumBillingDemandPct: 75
    };
    const result = calculateDemandCharges(intervals, demand, ctx);
    expect(result.billedDemandKw).toBeCloseTo(225, 5); // 75% of 300
    expect(result.totalAmount).toBeCloseTo(225 * 400, 5);
  });

  it('bills the actual measured demand when it exceeds the minimum floor', () => {
    const intervals = makeFlatIntervals(4, 280);
    const demand: DemandChargeDefinition = {
      basis: 'contract_demand',
      ratePerKw: 400,
      contractDemandKw: 300,
      minimumBillingDemandPct: 75
    };
    const result = calculateDemandCharges(intervals, demand, ctx);
    expect(result.billedDemandKw).toBeCloseTo(280, 5);
  });
});

describe('ratchet demand', () => {
  it('floors billed demand at ratchetPct of the lookback peak', () => {
    const intervals = makeFlatIntervals(4, 50);
    const demand: DemandChargeDefinition = {
      basis: 'ratchet',
      ratePerKw: 350,
      ratchet: { ratchetPct: 80, lookbackMonths: 11 }
    };
    const result = calculateDemandCharges(intervals, demand, { ...ctx, ratchetLookbackPeakKw: 300 });
    expect(result.billedDemandKw).toBeCloseTo(240, 5); // 80% of 300
  });
});

describe('month-to-date peak basis', () => {
  it('bills the higher of the existing month-to-date peak and the newly measured peak', () => {
    const intervals = makeFlatIntervals(4, 100);
    const demand: DemandChargeDefinition = { basis: 'month_to_date_peak', ratePerKw: 300 };
    const result = calculateDemandCharges(intervals, demand, { ...ctx, existingMonthToDatePeakKw: 220 });
    expect(result.billedDemandKw).toBeCloseTo(220, 5);
  });

  it('bills the new peak when it exceeds the existing month-to-date peak', () => {
    const intervals = makeFlatIntervals(4, 260);
    const demand: DemandChargeDefinition = { basis: 'month_to_date_peak', ratePerKw: 300 };
    const result = calculateDemandCharges(intervals, demand, { ...ctx, existingMonthToDatePeakKw: 220 });
    expect(result.billedDemandKw).toBeCloseTo(260, 5);
    expect(result.warnings.some(w => w.code === 'DEMAND_SCOPE_MONTH_TO_DATE')).toBe(true);
  });
});

describe('TOD demand charges', () => {
  it('bills a separate maximum demand per TOD demand window', () => {
    const demand: DemandChargeDefinition = {
      basis: 'measured_maximum',
      todDemandCharges: [
        { id: 'peak', name: 'Peak Demand', startTime: '18:00', endTime: '22:00', ratePerKw: 500 },
        { id: 'normal', name: 'Normal Demand', startTime: '06:00', endTime: '18:00', ratePerKw: 250 }
      ]
    };
    const intervals = [
      { timestamp: '2024-06-15T14:30:00.000Z', durationHours: 1, baselineGridImportKw: 200, postBessGridImportKw: 200 }, // 20:00 IST peak window
      { timestamp: '2024-06-15T04:30:00.000Z', durationHours: 1, baselineGridImportKw: 150, postBessGridImportKw: 150 }  // 10:00 IST normal window
    ];
    const result = calculateDemandCharges(intervals, demand, ctx);
    expect(result.totalAmount).toBeCloseTo(200 * 500 + 150 * 250, 5);
    expect(result.breakdown.length).toBe(2);
  });
});

describe('kVA billing', () => {
  it('bills using kVA quantity and rate when ratePerKva is configured', () => {
    const intervals = makeFlatIntervals(2, 100, undefined, undefined, { baselineGridImportKva: 111.1, postBessGridImportKva: 111.1 });
    const demand: DemandChargeDefinition = { basis: 'measured_maximum', ratePerKva: 450 };
    const result = calculateDemandCharges(intervals, demand, ctx);
    expect(result.billedDemandKva).toBeCloseTo(111.1, 3);
    expect(result.totalAmount).toBeCloseTo(111.1 * 450, 3);
  });
});
