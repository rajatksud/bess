import { describe, it, expect } from 'vitest';
import { isTariffEffective, validateTariffApplicability } from '../validation';
import { makeFlatTariff } from './fixtures';

describe('effective-date validation', () => {
  it('is effective on and after effectiveFrom with no effectiveTo', () => {
    const tariff = makeFlatTariff({ effectiveFrom: '2024-01-01' });
    expect(isTariffEffective(tariff, '2024-01-01')).toBe(true);
    expect(isTariffEffective(tariff, '2025-01-01')).toBe(true);
  });

  it('is not effective before effectiveFrom', () => {
    const tariff = makeFlatTariff({ effectiveFrom: '2024-06-01' });
    expect(isTariffEffective(tariff, '2024-01-01')).toBe(false);
  });

  it('is not effective after effectiveTo', () => {
    const tariff = makeFlatTariff({ effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' });
    expect(isTariffEffective(tariff, '2025-01-01')).toBe(false);
  });
});

describe('applicability warnings', () => {
  it('raises an error when the tariff is not effective as-of the given date', () => {
    const tariff = makeFlatTariff({ effectiveFrom: '2025-01-01' });
    const warnings = validateTariffApplicability(tariff, '2024-06-15');
    expect(warnings.some(w => w.code === 'TARIFF_NOT_EFFECTIVE' && w.level === 'error')).toBe(true);
  });

  it('raises a warning for each unsatisfied applicability condition', () => {
    const tariff = makeFlatTariff({
      applicabilityConditions: [
        { description: 'Contract demand under 500 kVA', satisfied: false },
        { description: 'HT connection', satisfied: true }
      ]
    });
    const warnings = validateTariffApplicability(tariff, '2024-06-15');
    const applicabilityWarnings = warnings.filter(w => w.code === 'APPLICABILITY_CONDITION_NOT_MET');
    expect(applicabilityWarnings.length).toBe(1);
  });

  it('raises no warnings when the tariff is effective and all conditions are satisfied', () => {
    const tariff = makeFlatTariff({
      effectiveFrom: '2024-01-01',
      applicabilityConditions: [{ description: 'HT connection', satisfied: true }]
    });
    const warnings = validateTariffApplicability(tariff, '2024-06-15');
    expect(warnings.length).toBe(0);
  });
});
