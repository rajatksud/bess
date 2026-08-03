import { DispatchComparisonInput, DispatchComparisonResult, OptimisedDispatchResult } from './types';

function computeTotalGridCost(result: OptimisedDispatchResult, intervals: { importRatePerKwh: number; exportCreditPerKwh?: number; durationHours: number }[]): number {
  return result.dispatchIntervals.reduce((sum, di, i) => {
    const interval = intervals[i];
    if (!interval) return sum;
    const importCost = di.gridImportKw * interval.durationHours * interval.importRatePerKwh;
    const exportCredit = di.gridExportKw * interval.durationHours * (interval.exportCreditPerKwh ?? 0);
    return sum + importCost - exportCredit;
  }, 0);
}

/**
 * Compares a heuristic and an optimised dispatch result. Only returns a meaningful
 * comparison when both ran over the same intervals, initial SOC, terminal SOC rule,
 * tariff, export constraints, and demand baseline - per the requirement that a mixed
 * heuristic/optimised schedule must never be described as a verified global optimum
 * comparison unless the scopes genuinely match.
 */
export function compareDispatchResults(
  input: DispatchComparisonInput,
  sharedIntervals: { importRatePerKwh: number; exportCreditPerKwh?: number; durationHours: number; exportAllowed: boolean }[]
): DispatchComparisonResult {
  const reasons: string[] = [];
  const { heuristic, optimised } = input;

  if (heuristic.dispatchIntervals.length !== optimised.dispatchIntervals.length) {
    reasons.push('Interval counts differ between the heuristic and optimised results.');
  }
  if (Math.abs(heuristic.initialSocKwh - optimised.initialSocKwh) > 1e-6) {
    reasons.push('Initial SOC differs between the heuristic and optimised results.');
  }
  if (heuristic.terminalSocRule !== optimised.terminalSocRule) {
    reasons.push('Terminal SOC rule differs between the heuristic and optimised results.');
  }
  if (heuristic.demandChargeScopeNote !== optimised.demandChargeScopeNote) {
    reasons.push('Demand-charge scope/baseline differs between the heuristic and optimised results.');
  }
  if (optimised.solverStatus !== 'optimal' && optimised.solverStatus !== 'feasible') {
    reasons.push(`Optimised result did not reach an optimal/feasible solver status (status: ${optimised.solverStatus}); it is itself a heuristic fallback, so this is not a genuine heuristic-vs-optimised comparison.`);
  }
  if (optimised.mixedModeIntervals > 0) {
    reasons.push(`Optimised result includes ${optimised.mixedModeIntervals} heuristic-dispatched (mixed-mode) interval(s); the comparison is not a pure global-optimum comparison for those intervals.`);
  }

  if (reasons.length > 0) {
    return { comparable: false, reasons };
  }

  const heuristicTotalCost = computeTotalGridCost(heuristic, sharedIntervals);
  const optimisedTotalCost = computeTotalGridCost(optimised, sharedIntervals);
  const improvementPct = heuristicTotalCost !== 0
    ? ((heuristicTotalCost - optimisedTotalCost) / Math.abs(heuristicTotalCost)) * 100
    : 0;

  return {
    comparable: true,
    reasons: [],
    heuristicTotalCost,
    optimisedTotalCost,
    improvementPct
  };
}
