import { describe, it, expect } from 'vitest';
import { calculateTaxesAndDuties, applyRounding } from '../taxesAndDuties';
import { TaxDutyDefinition, RoundingRule } from '../types';

describe('percentage taxes', () => {
  it('applies a percentage tax to its configured base', () => {
    const taxes: TaxDutyDefinition[] = [{ id: 'duty', name: 'Electricity Duty', type: 'percentage', rate: 9, base: 'energy_charge' }];
    const result = calculateTaxesAndDuties(taxes, { energyCharge: 1000, demandCharge: 500 }, { mode: 'none', decimals: 2 });
    expect(result.totalAmount).toBeCloseTo(90, 5);
  });

  it('applies a percentage tax on energy_plus_demand base', () => {
    const taxes: TaxDutyDefinition[] = [{ id: 'gst', name: 'GST', type: 'percentage', rate: 18, base: 'energy_plus_demand' }];
    const result = calculateTaxesAndDuties(taxes, { energyCharge: 1000, demandCharge: 500 }, { mode: 'none', decimals: 2 });
    expect(result.totalAmount).toBeCloseTo(1500 * 0.18, 5);
  });
});

describe('fixed charges', () => {
  it('applies a fixed amount regardless of base', () => {
    const taxes: TaxDutyDefinition[] = [{ id: 'meter', name: 'Meter Charge', type: 'fixed', fixedAmount: 250, base: 'subtotal' }];
    const result = calculateTaxesAndDuties(taxes, { energyCharge: 1000, demandCharge: 500 }, { mode: 'none', decimals: 2 });
    expect(result.totalAmount).toBe(250);
  });
});

describe('multiple charges and breakdown', () => {
  it('sums multiple tax lines and returns a clear breakdown', () => {
    const taxes: TaxDutyDefinition[] = [
      { id: 'duty', name: 'Electricity Duty', type: 'percentage', rate: 9, base: 'energy_charge' },
      { id: 'meter', name: 'Meter Charge', type: 'fixed', fixedAmount: 250, base: 'subtotal' }
    ];
    const result = calculateTaxesAndDuties(taxes, { energyCharge: 1000, demandCharge: 500 }, { mode: 'none', decimals: 2 });
    expect(result.breakdown.length).toBe(2);
    expect(result.totalAmount).toBeCloseTo(90 + 250, 5);
  });
});

describe('rounding rules', () => {
  it('rounds to the nearest configured decimal place', () => {
    const rule: RoundingRule = { mode: 'nearest', decimals: 0 };
    expect(applyRounding(123.456, rule)).toBe(123);
    expect(applyRounding(123.567, rule)).toBe(124);
  });

  it('rounds up when mode is "up"', () => {
    const rule: RoundingRule = { mode: 'up', decimals: 0 };
    expect(applyRounding(123.01, rule)).toBe(124);
  });

  it('rounds down when mode is "down"', () => {
    const rule: RoundingRule = { mode: 'down', decimals: 0 };
    expect(applyRounding(123.99, rule)).toBe(123);
  });

  it('leaves the value unchanged when mode is "none"', () => {
    const rule: RoundingRule = { mode: 'none', decimals: 0 };
    expect(applyRounding(123.456, rule)).toBeCloseTo(123.456, 5);
  });
});
