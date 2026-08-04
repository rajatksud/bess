import { describe, it, expect } from 'vitest';
import {
  isWithinTouPeriod,
  resolveTouRate,
  classifyTouRate,
  peakImportRate,
  offPeakImportRate,
  isArbitrageEconomic
} from '../touPeriods';
import { makeTariff } from './fixtures';
import { TouPeriod } from '../../types/bess';

const period = (overrides: Partial<TouPeriod> = {}): TouPeriod => ({
  id: 'p',
  name: 'Period',
  startTime: '00:00',
  endTime: '06:00',
  importRatePerKwh: 9.5,
  ...overrides
});

const at = (hh: number, mm = 0) => hh * 60 + mm;

describe('TOU period matching', () => {
  it('matches a normal within-day window on a half-open interval', () => {
    const p = period({ startTime: '06:00', endTime: '09:00' });

    expect(isWithinTouPeriod(at(5, 59), p)).toBe(false);
    expect(isWithinTouPeriod(at(6, 0), p)).toBe(true);   // inclusive start
    expect(isWithinTouPeriod(at(8, 59), p)).toBe(true);
    expect(isWithinTouPeriod(at(9, 0), p)).toBe(false);  // exclusive end
  });

  it('matches a window that wraps past midnight', () => {
    // The shape of a night rebate slab, and the case the previous inline matchers
    // silently matched nothing for.
    const night = period({ startTime: '22:00', endTime: '06:00' });

    expect(isWithinTouPeriod(at(22, 0), night)).toBe(true);
    expect(isWithinTouPeriod(at(23, 59), night)).toBe(true);
    expect(isWithinTouPeriod(at(0, 0), night)).toBe(true);
    expect(isWithinTouPeriod(at(5, 59), night)).toBe(true);
    expect(isWithinTouPeriod(at(6, 0), night)).toBe(false);
    expect(isWithinTouPeriod(at(12, 0), night)).toBe(false);
  });

  it('treats an equal start and end as covering the whole day', () => {
    expect(isWithinTouPeriod(at(3), period({ startTime: '00:00', endTime: '00:00' }))).toBe(true);
    expect(isWithinTouPeriod(at(17), period({ startTime: '00:00', endTime: '00:00' }))).toBe(true);
  });

  it('does not match an unparseable window', () => {
    expect(isWithinTouPeriod(at(3), period({ startTime: 'nonsense', endTime: '06:00' }))).toBe(false);
  });
});

describe('TOU rate classification', () => {
  it('classifies by rate against the base energy charge when no kind is declared', () => {
    expect(classifyTouRate(10.5, 9.5)).toBe('peak');
    expect(classifyTouRate(8.5, 9.5)).toBe('off_peak');
    expect(classifyTouRate(9.5, 9.5)).toBe('standard');
  });

  it('acts on a modest per-kWh delta that the old +/-20% threshold ignored', () => {
    // Rs 1 on a Rs 9.5 base is only -/+10.5%, well inside the old 0.8x/1.2x deadband.
    expect(classifyTouRate(9.5 + 1, 9.5)).toBe('peak');
    expect(classifyTouRate(9.5 - 1, 9.5)).toBe('off_peak');
  });

  it('lets an explicitly declared kind override the rate comparison', () => {
    expect(classifyTouRate(9.5, 9.5, 'peak')).toBe('peak');
    expect(classifyTouRate(20, 9.5, 'off_peak')).toBe('off_peak');
  });
});

describe('resolveTouRate', () => {
  const touTariff = makeTariff({
    enableTou: true,
    energyChargePerKwh: 9.5,
    touPeriods: [
      { id: 'night', name: 'Night Rebate', startTime: '22:00', endTime: '06:00', importRatePerKwh: 8.5, kind: 'off_peak' },
      { id: 'am', name: 'Morning Peak', startTime: '06:00', endTime: '09:00', importRatePerKwh: 10.5, kind: 'peak' },
      { id: 'std', name: 'Standard', startTime: '09:00', endTime: '18:00', importRatePerKwh: 9.5, kind: 'standard' },
      { id: 'pm', name: 'Evening Peak', startTime: '18:00', endTime: '22:00', importRatePerKwh: 10.5, kind: 'peak' }
    ]
  });

  it('resolves each slab of a full day including the midnight-spanning night rebate', () => {
    expect(resolveTouRate(at(2), touTariff)).toMatchObject({ periodName: 'Night Rebate', importRatePerKwh: 8.5, kind: 'off_peak' });
    expect(resolveTouRate(at(7), touTariff)).toMatchObject({ periodName: 'Morning Peak', importRatePerKwh: 10.5, kind: 'peak' });
    expect(resolveTouRate(at(13), touTariff)).toMatchObject({ periodName: 'Standard', importRatePerKwh: 9.5, kind: 'standard' });
    expect(resolveTouRate(at(20), touTariff)).toMatchObject({ periodName: 'Evening Peak', importRatePerKwh: 10.5, kind: 'peak' });
    expect(resolveTouRate(at(23), touTariff)).toMatchObject({ periodName: 'Night Rebate', importRatePerKwh: 8.5, kind: 'off_peak' });
  });

  it('falls back to the flat energy charge when TOU is disabled', () => {
    const flat = makeTariff({ enableTou: false, energyChargePerKwh: 9.5 });
    expect(resolveTouRate(at(20), flat)).toMatchObject({ periodName: 'Standard', importRatePerKwh: 9.5, kind: 'standard' });
  });

  it('falls back to the flat energy charge for a time no period covers', () => {
    const gappy = makeTariff({
      enableTou: true,
      energyChargePerKwh: 9.5,
      touPeriods: [{ id: 'am', name: 'Morning Peak', startTime: '06:00', endTime: '09:00', importRatePerKwh: 10.5 }]
    });
    expect(resolveTouRate(at(15), gappy)).toMatchObject({ periodName: 'Standard', kind: 'standard' });
  });
});

describe('tariff rate extremes', () => {
  it('includes the base energy charge alongside the configured periods', () => {
    const tariff = makeTariff({
      enableTou: true,
      energyChargePerKwh: 9.5,
      touPeriods: [{ id: 'am', name: 'Morning Peak', startTime: '06:00', endTime: '09:00', importRatePerKwh: 10.5 }]
    });

    expect(peakImportRate(tariff)).toBe(10.5);
    // No period is cheaper than base, so base itself is the floor.
    expect(offPeakImportRate(tariff)).toBe(9.5);
  });

  it('collapses to the flat rate when TOU is disabled', () => {
    const flat = makeTariff({ enableTou: false, energyChargePerKwh: 9.5 });
    expect(peakImportRate(flat)).toBe(9.5);
    expect(offPeakImportRate(flat)).toBe(9.5);
  });
});

describe('arbitrage economic viability', () => {
  it('accepts a spread that clears round-trip losses', () => {
    // Rs 1 rebate / Rs 1 surcharge on a Rs 9.5 base at 95%/95%: a kWh bought at 8.5
    // costs 9.42 delivered, against a 10.5 peak rate.
    expect(isArbitrageEconomic(10.5, 8.5, 0.95, 0.95)).toBe(true);
  });

  it('rejects a spread too narrow to cover round-trip losses', () => {
    // 9.3 delivered costs 9.3/0.9025 = 10.30, above the 10.0 peak rate.
    expect(isArbitrageEconomic(10.0, 9.3, 0.95, 0.95)).toBe(false);
  });

  it('rejects a flat tariff outright', () => {
    expect(isArbitrageEconomic(9.5, 9.5, 0.95, 0.95)).toBe(false);
  });

  it('rejects when efficiency is zero rather than dividing by zero', () => {
    expect(isArbitrageEconomic(100, 1, 0, 0.95)).toBe(false);
  });
});
