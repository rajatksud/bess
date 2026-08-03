import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord,
  SavingsBreakdown,
  TechnicalResult,
  DispatchPriorityType,
  ReactivePowerBasis
} from '../types/bess';
import { DispatchOptions } from '../engine/dispatchEngine';
import { DispatchAttribution } from '../engine/savingsAggregator';
import { SolverStatus, TerminalSocRule, DemandChargeHorizonConfig } from './types';

/**
 * The unified dispatch-optimiser seam.
 *
 * docs/architecture/OPTIMISATION_ENGINE_DESIGN.md names five layers (rule-based, LP,
 * MILP, MPC, AI). Before this interface existed, layer 1 lived in
 * src/engine/dispatchEngine.ts and produced a full financial answer, while layers 2/3
 * lived in src/optimisation/ and produced only a kW schedule with no attribution, no
 * savings and no financial pipeline at all — runOptimisedDispatch was called from exactly
 * one route and connected to nothing.
 *
 * The hard part of unification was never the interface. It is that SavingsBreakdown
 * cannot be reconstructed from LP output: the rule-based engine attributes every
 * discharged kWh to exactly ONE avoided-cost category via its bessAction tag, and that
 * attribution IS what enforces Rule 2. LP output has no categorical attribution —
 * dischargeKw is just a number. See docs/architecture/LP_ENERGY_ATTRIBUTION.md for the
 * modelling rule that closes that gap, and src/optimisation/lpAttribution.ts for its
 * implementation.
 */

export type OptimisationLayer = 'rule_based' | 'linear_programming' | 'milp' | 'mpc' | 'ai';

/**
 * The common input. Deliberately expressed in the engine's own IntervalRecord shape
 * (GROSS load with a separate solar field) rather than the optimiser's narrower
 * OptimisationInterval (load already NET of solar, no solar field at all), because the
 * gross form is strictly more informative: net can always be derived from gross, but not
 * the reverse. Adapters convert at the boundary — see adapters.ts.
 */
export interface DispatchOptimizerInput {
  /** Gross site load, solar generation, DG requirement, grid availability and per-interval tariff rate. */
  intervals: IntervalRecord[];
  system: BessSystemInput;
  tariff: TariffInput;
  diesel: DieselInput;
  solar: SolarInput;
  financial: FinancialInput;
  priorities: DispatchPriorityType[];
  intervalMinutes: number;
  /** Battery state of health for this run. See DispatchOptions. */
  dispatchOptions?: DispatchOptions;
  /**
   * ISO timestamp the horizon starts at. IntervalRecord carries only a time-of-day label
   * ("00:15") with no date, while OptimisationInterval requires a real ISO timestamp;
   * this supplies the missing date rather than inventing one silently. Defaults to
   * 1970-01-01T00:00:00Z, which is arbitrary but consistent and affects nothing in the
   * current model (no rate depends on absolute date — only on the per-interval
   * tariffImportRate already carried by each record).
   */
  horizonStartIso?: string;
  /** LP/MILP-only settings. Ignored by the rule-based optimiser. */
  solver?: {
    terminalSocRule?: TerminalSocRule;
    minimumTerminalReserveSocPct?: number;
    demandCharge?: DemandChargeHorizonConfig;
    solverTimeoutMs?: number;
  };
}

export interface DispatchDiagnostics {
  /** Solver status for LP/MILP layers; 'optimal' is reported by the rule-based layer only as a formality of the shared shape. */
  solverStatus?: SolverStatus;
  solveDurationMs?: number;
  objectiveValue?: number;
  /** Intervals that fell back to a different layer than requested (e.g. outages the LP cannot model). */
  mixedModeIntervals?: number;
  optimisationScope?: string;
  demandChargeScopeNote?: string;
  warnings: string[];
}

export interface DispatchResult {
  simulatedIntervals: IntervalRecord[];
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  /** Per-category energy attribution. Rule 2 is checkable on this for every layer. */
  attribution: DispatchAttribution;
  reactivePowerBasis: ReactivePowerBasis;
  assumptions: string[];
  layer: OptimisationLayer;
  diagnostics: DispatchDiagnostics;
}

export interface DispatchOptimizer {
  readonly name: string;
  readonly layer: OptimisationLayer;
  optimise(input: DispatchOptimizerInput): DispatchResult;
}

export const DEFAULT_HORIZON_START_ISO = '1970-01-01T00:00:00.000Z';
