import { calculateFinancialMetrics } from '../engine/financialEngine';
import { SimulationResult, FinancialInput, BessSystemInput } from '../types/bess';
import { SensitivityScenario } from './types';

interface SensitivityScenarioDefinition {
  label: SensitivityScenario['label'];
  capexMultiplier: number;
  tariffEscalationDeltaPct: number;
  degradationMultiplier: number;
}

// Same three-point outlook the UI previously hardcoded as a flat 0.75x/1.25x multiplier
// on the final net-saving number. Replaced here with real re-computation: each scenario
// perturbs the actual financial inputs (CapEx, tariff escalation, degradation rate) and
// re-runs calculateFinancialMetrics - the genuine engine function - rather than scaling
// an already-computed result.
const SCENARIO_DEFINITIONS: SensitivityScenarioDefinition[] = [
  { label: 'conservative', capexMultiplier: 1.15, tariffEscalationDeltaPct: -1.5, degradationMultiplier: 1.5 },
  { label: 'base', capexMultiplier: 1.0, tariffEscalationDeltaPct: 0, degradationMultiplier: 1.0 },
  { label: 'optimistic', capexMultiplier: 0.9, tariffEscalationDeltaPct: 1.5, degradationMultiplier: 0.7 }
];

/**
 * Builds a three-point (conservative/base/optimistic) sensitivity matrix by re-running
 * the real financial engine against the same dispatch output (savings/technical) as the
 * base case, with perturbed CapEx/tariff-escalation/degradation inputs.
 *
 * Dispatch (runIntervalDispatch) is NOT re-run here: none of CapEx, tariff escalation, or
 * degradation rate feed into the physical dispatch decision under the current engine (see
 * dispatchEngine.ts) - they only affect the financial projection - so re-running dispatch
 * for these three axes would reproduce identical savings/technical and waste the work.
 * A sensitivity axis that DID change dispatch (e.g. a different battery size) would need
 * to re-run runIntervalDispatch too; that's out of scope for this three-point outlook.
 */
export function buildSensitivityMatrix(result: SimulationResult): SensitivityScenario[] {
  return SCENARIO_DEFINITIONS.map(def => {
    const adjustedFinancial: FinancialInput = {
      ...result.financialInput,
      initialCapex: result.financialInput.initialCapex * def.capexMultiplier,
      tariffEscalationPct: Math.max(0, result.financialInput.tariffEscalationPct + def.tariffEscalationDeltaPct)
    };
    const adjustedSystem: BessSystemInput = {
      ...result.system,
      annualDegradationPct: result.system.annualDegradationPct * def.degradationMultiplier
    };

    const financialResult = calculateFinancialMetrics(result.savings, result.technical, adjustedFinancial, adjustedSystem);

    return {
      label: def.label,
      capexMultiplier: def.capexMultiplier,
      tariffEscalationDeltaPct: def.tariffEscalationDeltaPct,
      degradationMultiplier: def.degradationMultiplier,
      npv: financialResult.npv,
      roiPct: financialResult.roiPct,
      simplePaybackYears: financialResult.simplePaybackYears
    };
  });
}
