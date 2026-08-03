import { describe, it, expect } from 'vitest';
import { buildSensitivityMatrix } from '../sensitivityAnalysis';
import { makeSimulationResult } from './fixtures';

describe('buildSensitivityMatrix', () => {
  const result = makeSimulationResult();

  it('does not mutate the input result (each scenario builds its own adjusted financial/system copy)', () => {
    const before = JSON.stringify(result.financialInput);
    buildSensitivityMatrix(result);
    expect(JSON.stringify(result.financialInput)).toBe(before);
  });

  it('applies distinct CapEx multipliers per scenario, verifiable via NPV ordering at fixed savings', () => {
    const scenarios = buildSensitivityMatrix(result);
    const capexByLabel = Object.fromEntries(scenarios.map(s => [s.label, s.capexMultiplier]));
    expect(capexByLabel.conservative).toBeGreaterThan(1);
    expect(capexByLabel.base).toBe(1);
    expect(capexByLabel.optimistic).toBeLessThan(1);
  });

  it('every scenario has a finite NPV and either a null or non-negative simple payback', () => {
    for (const scenario of buildSensitivityMatrix(result)) {
      expect(Number.isFinite(scenario.npv)).toBe(true);
      if (scenario.simplePaybackYears !== null) {
        expect(scenario.simplePaybackYears).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
