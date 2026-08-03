import solver from 'javascript-lp-solver';
import {
  OptimisationInterval,
  OptimisationBatteryConfig,
  OptimisationOptions,
  OptimisedDispatchResult,
  DispatchInterval,
  SolverStatus
} from './types';
import { buildDispatchLpModel } from './lpModel';
import { runHeuristicDispatch } from './heuristicDispatch';

interface SolverRawResult {
  feasible: boolean;
  result: number | null;
  bounded: boolean;
  [variable: string]: unknown;
}

function buildDemandChargeScopeNote(options: OptimisationOptions): string {
  if (!options.demandCharge) return 'No demand charge was included in this optimisation.';
  if (options.demandCharge.horizonCoversFullBillingPeriod) {
    return 'Optimisation horizon covers the full remaining billing period; demand-charge savings reflect the full period.';
  }
  return 'Optimisation horizon is SHORTER than the full billing period. Demand-charge savings reflect only the incremental peak above the existing month-to-date peak within this horizon and must NOT be presented as a guaranteed full-month saving.';
}

/**
 * Runs LP/MILP-assisted dispatch over grid-connected (non-outage) intervals, falling
 * back to the heuristic engine for outage intervals (always) and for the entire
 * horizon if the solver fails, times out, or returns an infeasible/unbounded model.
 * The fallback is always structurally reported (solverStatus + mixedModeIntervals) -
 * never silently substituted and presented as "optimised".
 */
export function runOptimisedDispatch(
  intervals: OptimisationInterval[],
  battery: OptimisationBatteryConfig,
  options: OptimisationOptions
): OptimisedDispatchResult {
  const warnings: string[] = [];
  const initialSocKwh = (battery.initialSocPct / 100) * battery.ratedEnergyKwh;
  const outageCount = intervals.filter(i => i.isOutage).length;
  if (outageCount > 0) {
    warnings.push(`${outageCount} outage interval(s) are dispatched by the heuristic engine, not the LP/MILP optimiser; the result is a mixed-mode schedule, not a global optimum.`);
  }

  const startedAt = Date.now();
  let model: ReturnType<typeof buildDispatchLpModel>;
  try {
    model = buildDispatchLpModel(intervals, battery, options);
  } catch (err) {
    return buildErrorFallback(intervals, battery, options, warnings, Date.now() - startedAt, `Failed to build the optimisation model: ${err instanceof Error ? err.message : String(err)}`);
  }

  let raw: SolverRawResult;
  try {
    raw = solver.Solve(model.model as never) as unknown as SolverRawResult;
  } catch (err) {
    return buildErrorFallback(intervals, battery, options, warnings, Date.now() - startedAt, `Solver threw an error: ${err instanceof Error ? err.message : String(err)}`);
  }
  const solveDurationMs = Date.now() - startedAt;

  if (options.solverTimeoutMs !== undefined && solveDurationMs > options.solverTimeoutMs) {
    warnings.push(`Solver exceeded the configured timeout (${options.solverTimeoutMs}ms actual: ${solveDurationMs}ms); falling back to the heuristic engine.`);
    return buildFallbackResult(intervals, battery, options, warnings, solveDurationMs, 'timeout');
  }

  if (!raw.feasible) {
    warnings.push('Optimisation model is infeasible under the given constraints; falling back to the heuristic engine.');
    return buildFallbackResult(intervals, battery, options, warnings, solveDurationMs, 'infeasible');
  }
  if (!raw.bounded) {
    warnings.push('Optimisation model is unbounded (no finite optimum found); falling back to the heuristic engine.');
    return buildFallbackResult(intervals, battery, options, warnings, solveDurationMs, 'error');
  }

  // Build heuristic intervals for outage slots (always) - reuse the heuristic engine
  // scoped to just those intervals so its own SOC bookkeeping stays self-consistent;
  // the two schedules are then stitched together in original interval order below.
  const heuristicAll = runHeuristicDispatch(intervals, battery);

  const dispatchIntervals: DispatchInterval[] = intervals.map((interval, i) => {
    if (interval.isOutage) {
      return { ...heuristicAll[i], mode: 'heuristic' as const };
    }
    const chargeVar = model.varNames.charge[i];
    const dischargeVar = model.varNames.discharge[i];
    const socVar = model.varNames.soc[i];
    const exportVar = model.varNames.gridExport[i];
    const gridImportVar = model.varNames.gridImport[i];

    const chargeKw = Number(raw[chargeVar] ?? 0);
    const dischargeKw = Number(raw[dischargeVar] ?? 0);
    const socKwh = Number(raw[socVar] ?? initialSocKwh);
    const gridExportKw = interval.exportAllowed ? Number(raw[exportVar] ?? 0) : 0;
    const gridImportKw = Number(raw[gridImportVar] ?? 0);

    return {
      timestamp: interval.timestamp,
      chargeKw,
      dischargeKw,
      gridImportKw,
      gridExportKw,
      socKwh,
      socPct: (socKwh / battery.ratedEnergyKwh) * 100,
      mode: 'optimised' as const
    };
  });

  const terminalSocKwh = dispatchIntervals.length > 0 ? dispatchIntervals[dispatchIntervals.length - 1].socKwh : initialSocKwh;

  return {
    dispatchIntervals,
    solverStatus: 'optimal',
    solveDurationMs,
    objectiveValue: raw.result ?? undefined,
    optimisationScope: `${model.optimisableIndices.length} of ${intervals.length} intervals optimised (grid-connected, non-outage); ${outageCount} outage interval(s) handled by the heuristic engine.`,
    mixedModeIntervals: outageCount,
    initialSocKwh,
    terminalSocKwh,
    terminalSocRule: options.terminalSocRule,
    demandChargeScopeNote: buildDemandChargeScopeNote(options),
    warnings
  };
}

function buildFallbackResult(
  intervals: OptimisationInterval[],
  battery: OptimisationBatteryConfig,
  options: OptimisationOptions,
  warnings: string[],
  solveDurationMs: number,
  status: SolverStatus
): OptimisedDispatchResult {
  const heuristicIntervals = runHeuristicDispatch(intervals, battery);
  const initialSocKwh = (battery.initialSocPct / 100) * battery.ratedEnergyKwh;
  const terminalSocKwh = heuristicIntervals.length > 0 ? heuristicIntervals[heuristicIntervals.length - 1].socKwh : initialSocKwh;

  return {
    dispatchIntervals: heuristicIntervals,
    solverStatus: status,
    solveDurationMs,
    optimisationScope: `Solver did not produce an optimal solution (status: ${status}); the ENTIRE horizon fell back to the heuristic engine. This is NOT an optimised result.`,
    mixedModeIntervals: intervals.length,
    initialSocKwh,
    terminalSocKwh,
    terminalSocRule: options.terminalSocRule,
    demandChargeScopeNote: buildDemandChargeScopeNote(options),
    warnings
  };
}

function buildErrorFallback(
  intervals: OptimisationInterval[],
  battery: OptimisationBatteryConfig,
  options: OptimisationOptions,
  warnings: string[],
  solveDurationMs: number,
  errorMessage: string
): OptimisedDispatchResult {
  warnings.push(errorMessage);
  warnings.push('Falling back to the heuristic engine due to a solver error.');
  return buildFallbackResult(intervals, battery, options, warnings, solveDurationMs, 'error');
}
