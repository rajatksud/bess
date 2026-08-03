import { describe, it, expect } from 'vitest';
import { calculateExportCredit } from '../exportRules';
import { ExportRuleDefinition } from '../types';

const intervals = [
  { timestamp: '2024-06-15T06:00:00.000Z', durationHours: 1, baselineGridImportKw: 0, postBessGridImportKw: 0, postBessGridExportKw: 50 },
  { timestamp: '2024-06-15T07:00:00.000Z', durationHours: 1, baselineGridImportKw: 0, postBessGridImportKw: 0, postBessGridExportKw: 30 }
];

describe('export prohibited', () => {
  it('applies zero credit and warns if export is present anyway', () => {
    const rules: ExportRuleDefinition = { policy: 'prohibited' };
    const result = calculateExportCredit(intervals, rules);
    expect(result.totalCredit).toBe(0);
    expect(result.totalExportKwh).toBe(0);
    expect(result.warnings.some(w => w.code === 'EXPORT_PROHIBITED_BUT_PRESENT')).toBe(true);
  });
});

describe('zero-value export', () => {
  it('records exported energy but applies no credit', () => {
    const rules: ExportRuleDefinition = { policy: 'zero_value' };
    const result = calculateExportCredit(intervals, rules);
    expect(result.totalExportKwh).toBeCloseTo(80, 5);
    expect(result.totalCredit).toBe(0);
  });
});

describe('fixed export credit', () => {
  it('credits all exported energy at the fixed rate', () => {
    const rules: ExportRuleDefinition = { policy: 'fixed_credit', creditPerKwh: 3.5 };
    const result = calculateExportCredit(intervals, rules);
    expect(result.totalCredit).toBeCloseTo(80 * 3.5, 5);
  });
});

describe('net metering', () => {
  it('credits exported energy at the net metering rate', () => {
    const rules: ExportRuleDefinition = { policy: 'net_metering', creditPerKwh: 4 };
    const result = calculateExportCredit(intervals, rules);
    expect(result.totalCredit).toBeCloseTo(80 * 4, 5);
  });
});

describe('banking', () => {
  it('credits exported energy and warns that settlement timing is not modelled', () => {
    const rules: ExportRuleDefinition = { policy: 'banking', creditPerKwh: 2.5, bankingSettlementMonths: 12 };
    const result = calculateExportCredit(intervals, rules);
    expect(result.totalCredit).toBeCloseTo(80 * 2.5, 5);
    expect(result.warnings.some(w => w.code === 'BANKING_SETTLEMENT_NOT_MODELLED')).toBe(true);
  });
});

describe('curtailed export', () => {
  it('credits only exported energy up to the curtailment limit and warns about the rest', () => {
    const rules: ExportRuleDefinition = { policy: 'curtailed', creditPerKwh: 3, curtailmentLimitKw: 40 };
    const result = calculateExportCredit(intervals, rules);
    // Interval 1: 50kW capped to 40kW -> 40kWh; interval 2: 30kW allowed fully -> 30kWh.
    expect(result.totalExportKwh).toBeCloseTo(70, 5);
    expect(result.totalCredit).toBeCloseTo(70 * 3, 5);
    expect(result.warnings.some(w => w.code === 'EXPORT_CURTAILED')).toBe(true);
  });
});
