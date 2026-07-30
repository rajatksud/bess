import { describe, it, expect } from 'vitest';
import { calculateEnergyCharges, resolveTodPeriod } from '../energyCharges';
import { makeFlatIntervals } from './fixtures';
import { EnergyChargeDefinition } from '../types';

describe('flat energy charges', () => {
  it('computes total = sum(kW * durationHours) * flatRate', () => {
    const intervals = makeFlatIntervals(4, 100); // 4 x 0.25h @ 100kW = 100 kWh
    const result = calculateEnergyCharges(intervals, { type: 'flat', flatRatePerKwh: 10 }, 'Asia/Kolkata');
    expect(result.totalKwh).toBeCloseTo(100, 5);
    expect(result.totalAmount).toBeCloseTo(1000, 5);
  });
});

describe('TOD energy charges', () => {
  const tod: EnergyChargeDefinition = {
    type: 'tod',
    todPeriods: [
      { id: 'peak', name: 'Peak', startTime: '18:00', endTime: '22:00', ratePerKwh: 12 },
      { id: 'off-peak', name: 'Off-Peak', startTime: '22:00', endTime: '06:00', ratePerKwh: 5 },
      { id: 'normal', name: 'Normal', startTime: '06:00', endTime: '18:00', ratePerKwh: 8 }
    ]
  };

  it('resolves the correct period for a timestamp within the tariff timezone', () => {
    // 2024-06-15T14:30:00 IST = 09:00 UTC -> should match 'normal' (06:00-18:00 IST)
    const period = resolveTodPeriod('2024-06-15T09:00:00.000Z', 'Asia/Kolkata', tod);
    expect(period?.id).toBe('normal');
  });

  it('resolves the peak period correctly, including a wrap across midnight for off-peak', () => {
    // 2024-06-15T23:00:00 IST = 17:30 UTC -> off-peak (22:00-06:00, wraps midnight)
    const period = resolveTodPeriod('2024-06-15T17:30:00.000Z', 'Asia/Kolkata', tod);
    expect(period?.id).toBe('off-peak');
  });

  it('bills each period at its own rate and sums correctly', () => {
    // One interval at 20:00 IST (peak) and one at 10:00 IST (normal), both 100 kW, 1h.
    const intervals = [
      { timestamp: '2024-06-15T14:30:00.000Z', durationHours: 1, baselineGridImportKw: 100, postBessGridImportKw: 100 }, // 20:00 IST peak
      { timestamp: '2024-06-15T04:30:00.000Z', durationHours: 1, baselineGridImportKw: 100, postBessGridImportKw: 100 }  // 10:00 IST normal
    ];
    const result = calculateEnergyCharges(intervals, tod, 'Asia/Kolkata');
    expect(result.totalKwh).toBeCloseTo(200, 5);
    expect(result.totalAmount).toBeCloseTo(100 * 12 + 100 * 8, 5);
  });
});

describe('weekday/weekend schedules', () => {
  it('only applies a period on its scheduled days', () => {
    const tod: EnergyChargeDefinition = {
      type: 'tod',
      todPeriods: [
        { id: 'weekend-discount', name: 'Weekend Discount', startTime: '00:00', endTime: '23:59', ratePerKwh: 4, schedule: { applicableDays: [0, 6] } },
        { id: 'weekday-standard', name: 'Weekday Standard', startTime: '00:00', endTime: '23:59', ratePerKwh: 9, schedule: { applicableDays: [1, 2, 3, 4, 5] } }
      ]
    };
    // 2024-06-15 is a Saturday in IST.
    const saturdayInterval = { timestamp: '2024-06-15T06:00:00.000Z', durationHours: 1, baselineGridImportKw: 50, postBessGridImportKw: 50 };
    const period = resolveTodPeriod(saturdayInterval.timestamp, 'Asia/Kolkata', tod);
    expect(period?.id).toBe('weekend-discount');
  });
});

describe('seasonal periods', () => {
  it('only applies a period within its defined season months', () => {
    const tod: EnergyChargeDefinition = {
      type: 'tod',
      seasons: [{ id: 'summer', name: 'Summer', startMonth: 4, endMonth: 6 }],
      todPeriods: [
        { id: 'summer-peak', name: 'Summer Peak', startTime: '00:00', endTime: '23:59', ratePerKwh: 15, seasonId: 'summer' },
        { id: 'other', name: 'Other Season', startTime: '00:00', endTime: '23:59', ratePerKwh: 8 }
      ]
    };
    // June (month 6) is within the summer season.
    const juneInterval = resolveTodPeriod('2024-06-15T06:00:00.000Z', 'Asia/Kolkata', tod);
    expect(juneInterval?.id).toBe('summer-peak');

    // December (month 12) is outside the summer season -> falls through to 'other'.
    const decInterval = resolveTodPeriod('2024-12-15T06:00:00.000Z', 'Asia/Kolkata', tod);
    expect(decInterval?.id).toBe('other');
  });
});
