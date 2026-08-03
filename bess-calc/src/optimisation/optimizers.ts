import { runIntervalDispatch, resolveReactivePowerBasis } from '../engine/dispatchEngine';
import { aggregateSavings } from '../engine/savingsAggregator';
import { DispatchOptimizer, DispatchOptimizerInput, DispatchResult } from './optimizer';
import { runOptimisedDispatch } from './optimisedDispatch';
import { toOptimisationIntervals, toOptimisationBatteryConfig, mergeDispatchIntoIntervals } from './adapters';
import { attributeLpDispatch } from './lpAttribution';

/**
 * Layer 1 — rule-based dispatch, behind the shared interface.
 *
 * A thin adapter over runIntervalDispatch, which is unchanged. It is deliberately NOT a
 * reimplementation: the rule-based engine is the reference implementation that every
 * existing test pins, and wrapping rather than rewriting it is what keeps those tests
 * meaningful.
 */
export const heuristicOptimizer: DispatchOptimizer = {
  name: 'rule-based-priority-dispatch',
  layer: 'rule_based',

  optimise(input: DispatchOptimizerInput): DispatchResult {
    const run = runIntervalDispatch(
      input.intervals,
      input.system,
      input.tariff,
      input.diesel,
      input.solar,
      input.financial,
      input.priorities,
      input.intervalMinutes,
      input.dispatchOptions ?? {}
    );

    return {
      simulatedIntervals: run.simulatedIntervals,
      savings: run.savings,
      technical: run.technical,
      attribution: run.attribution,
      reactivePowerBasis: run.reactivePowerBasis,
      assumptions: run.assumptions,
      layer: 'rule_based',
      diagnostics: { warnings: [] }
    };
  }
};

/**
 * Layer 2/3 — LP/MILP dispatch, behind the shared interface, connected for the first time
 * to the financial pipeline.
 *
 * Sequence: adapt gross IntervalRecords to the optimiser's net-load view -> solve ->
 * attribute the resulting energy to avoided-cost categories via the documented cascade
 * (lpAttribution.ts) -> merge the schedule back into full IntervalRecords -> aggregate
 * through the SAME savingsAggregator the rule-based path uses.
 *
 * Because both paths end at one aggregator fed by one DispatchAttribution shape, Rule 2
 * is enforced identically on both, and neither can drift into its own savings formulas.
 */
export const lpOptimizer: DispatchOptimizer = {
  name: 'lp-milp-dispatch',
  layer: 'linear_programming',

  optimise(input: DispatchOptimizerInput): DispatchResult {
    const batterySohPct = input.dispatchOptions?.batterySohPct;
    if (batterySohPct !== undefined && (batterySohPct < 0 || batterySohPct > 100)) {
      throw new Error('batterySohPct must be in [0, 100]');
    }

    const optimisationIntervals = toOptimisationIntervals(input.intervals, {
      intervalMinutes: input.intervalMinutes,
      solar: input.solar,
      horizonStartIso: input.horizonStartIso
    });
    const battery = toOptimisationBatteryConfig(input.system, input.financial, batterySohPct);

    const solved = runOptimisedDispatch(optimisationIntervals, battery, {
      terminalSocRule: input.solver?.terminalSocRule ?? 'unconstrained',
      minimumTerminalReserveSocPct: input.solver?.minimumTerminalReserveSocPct,
      demandCharge: input.solver?.demandCharge,
      solverTimeoutMs: input.solver?.solverTimeoutMs
    });

    const attributed = attributeLpDispatch({
      originals: input.intervals,
      dispatch: solved.dispatchIntervals,
      intervalMinutes: input.intervalMinutes
    });

    const reactivePowerBasis = resolveReactivePowerBasis(undefined, undefined, input.tariff.powerFactor);
    const powerFactor = reactivePowerBasis !== 'unavailable' ? input.tariff.powerFactor : undefined;

    const simulatedIntervals = mergeDispatchIntoIntervals(input.intervals, solved.dispatchIntervals, {
      intervalMinutes: input.intervalMinutes,
      ratedEnergyKwh: battery.ratedEnergyKwh,
      powerFactor,
      actionTags: attributed.actionTags
    });

    // Pre-BESS peak is a property of the load profile, not of the dispatch, so it is
    // computed the same way for every layer.
    let peakBeforeKw = 0;
    for (const interval of simulatedIntervals) {
      if (interval.preBessGridImportKw > peakBeforeKw) peakBeforeKw = interval.preBessGridImportKw;
    }
    const peakBeforeKva = powerFactor ? peakBeforeKw / powerFactor : 0;

    const minUsableSocPct = Math.max(input.system.minSocPct, input.system.minSocPct + input.system.reserveSocPct);
    const { savings, technical } = aggregateSavings(
      {
        simulatedIntervals,
        attribution: attributed.attribution,
        peakBeforeKw,
        peakBeforeKva,
        powerFactor,
        minimumSocPct: minUsableSocPct,
        maximumSocPct: input.system.maxSocPct,
        deliverableCapacityKwh: battery.ratedEnergyKwh * (input.system.usableDodPct / 100)
      },
      input.system,
      input.tariff,
      input.diesel,
      input.solar,
      input.financial
    );

    const assumptions: string[] = [
      'Energy discharged by the optimiser is attributed to avoided-cost categories ex post, ' +
      'by the documented marginal-value cascade (diesel/backup, then peak shaving capped by ' +
      'the achieved billing peak, then arbitrage). See docs/architecture/LP_ENERGY_ATTRIBUTION.md. ' +
      'The optimiser itself has no categorical intent; this decomposition is what makes its ' +
      'output expressible as a savings breakdown without double counting.'
    ];
    if (attributed.mixedAttributionIntervals > 0) {
      assumptions.push(
        `${attributed.mixedAttributionIntervals} interval(s) split across more than one ` +
        'avoided-cost category. Their bessAction tag names the largest contributor and is ' +
        'suffixed "(mixed)"; the authoritative split is in the attribution record.'
      );
    }
    if (reactivePowerBasis === 'configured_pf') {
      assumptions.push(
        'kVA billing quantities are derived from the configured site power factor ' +
        `(${input.tariff.powerFactor}), not measured per-interval kVA or PF.`
      );
    }

    return {
      simulatedIntervals,
      savings,
      technical,
      attribution: attributed.attribution,
      reactivePowerBasis,
      assumptions,
      layer: 'linear_programming',
      diagnostics: {
        solverStatus: solved.solverStatus,
        solveDurationMs: solved.solveDurationMs,
        objectiveValue: solved.objectiveValue,
        mixedModeIntervals: solved.mixedModeIntervals,
        optimisationScope: solved.optimisationScope,
        demandChargeScopeNote: solved.demandChargeScopeNote,
        warnings: solved.warnings
      }
    };
  }
};

/**
 * Registry of available dispatch layers. MILP, MPC and AI (layers 3-5 of
 * docs/architecture/OPTIMISATION_ENGINE_DESIGN.md) are deliberately absent rather than
 * stubbed: an entry here is a claim that the layer works, and a stub would be a false one.
 */
export const DISPATCH_OPTIMIZERS: Record<string, DispatchOptimizer> = {
  [heuristicOptimizer.name]: heuristicOptimizer,
  [lpOptimizer.name]: lpOptimizer
};

export function getDispatchOptimizer(name: string): DispatchOptimizer {
  const optimizer = DISPATCH_OPTIMIZERS[name];
  if (!optimizer) {
    throw new Error(`Unknown dispatch optimizer "${name}". Available: ${Object.keys(DISPATCH_OPTIMIZERS).join(', ')}`);
  }
  return optimizer;
}
