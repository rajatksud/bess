// LP/MILP-assisted grid-connected dispatch — core types.

export type DispatchMode = 'heuristic' | 'optimised';

export type TerminalSocRule = 'equal_to_initial' | 'minimum_terminal_reserve' | 'unconstrained';

export type SolverStatus = 'optimal' | 'feasible' | 'infeasible' | 'timeout' | 'error';

export interface OptimisationInterval {
  timestamp: string;
  durationHours: number;
  /** Gross site load net of solar already serving it (i.e. what the grid would see with no battery: preBessGridImportKw). */
  netLoadKw: number;
  /** Energy import rate applicable to this interval (currency/kWh). */
  importRatePerKwh: number;
  /** Export credit rate applicable to this interval, if export is allowed (currency/kWh). */
  exportCreditPerKwh?: number;
  exportAllowed: boolean;
  /** Maximum exportable power this interval (kW), if export is allowed and capped. */
  exportLimitKw?: number;
  /** True if this interval is a grid outage; such intervals are handled by the heuristic engine, not the LP, and are marked mixed-mode. */
  isOutage: boolean;
}

export interface OptimisationBatteryConfig {
  ratedPowerKw: number;
  ratedEnergyKwh: number;
  minSocPct: number;
  maxSocPct: number;
  initialSocPct: number;
  reserveSocPct: number;
  chargeEfficiencyPct: number;
  dischargeEfficiencyPct: number;
  /** Cost per kWh of throughput (charge + discharge), used as a degradation penalty in the objective. */
  degradationCostPerKwh: number;
}

export interface DemandChargeHorizonConfig {
  ratePerKw: number;
  /** Peak already recorded earlier in the current billing period, before this optimisation horizon. */
  existingMonthToDatePeakKw: number;
  /** True if the optimisation horizon covers the full remaining billing period (affects demandChargeScopeNote). */
  horizonCoversFullBillingPeriod: boolean;
}

export interface OptimisationOptions {
  terminalSocRule: TerminalSocRule;
  /** Required when terminalSocRule === 'minimum_terminal_reserve'. */
  minimumTerminalReserveSocPct?: number;
  demandCharge?: DemandChargeHorizonConfig;
  /** Per-interval unserved-load penalty (currency/kWh), applied only to non-outage intervals where the model chooses not to serve load — should normally be unreachable since grid import is otherwise unconstrained. */
  unservedLoadPenaltyPerKwh?: number;
  solverTimeoutMs?: number;
}

export interface DispatchInterval {
  timestamp: string;
  chargeKw: number;
  dischargeKw: number;
  gridImportKw: number;
  gridExportKw: number;
  socKwh: number;
  socPct: number;
  mode: DispatchMode;
}

export interface OptimisedDispatchResult {
  dispatchIntervals: DispatchInterval[];

  solverStatus: SolverStatus;
  solveDurationMs: number;
  objectiveValue?: number;

  optimisationScope: string;
  mixedModeIntervals: number;

  initialSocKwh: number;
  terminalSocKwh: number;
  terminalSocRule: TerminalSocRule;

  demandChargeScopeNote: string;
  warnings: string[];
}

export interface DispatchComparisonInput {
  heuristic: OptimisedDispatchResult;
  optimised: OptimisedDispatchResult;
}

export interface DispatchComparisonResult {
  comparable: boolean;
  reasons: string[];
  heuristicTotalCost?: number;
  optimisedTotalCost?: number;
  improvementPct?: number;
}
