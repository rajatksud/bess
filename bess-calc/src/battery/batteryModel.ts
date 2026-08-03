// Battery Model Engine - Level 2 (Engineering) foundation.
//
// Per docs/architecture/BATTERY_MODEL_ARCHITECTURE.md's Level 1/2/3 progression:
// Level 1 (commercial: flat annual % degradation) is what src/engine/dispatchEngine.ts
// and src/optimisation/lpModel.ts already use via a single degradationCostPerKwh
// coefficient - unchanged by this module. Level 3 (physics/digital-twin, e.g. PyBaMM/
// BattMo) is out of scope. This module is Level 2: cycle ageing (DoD/cycle-count/
// C-rate), calendar ageing (elapsed time + a temperature-factor placeholder), and
// throughput ageing, combined into an SOH-over-time estimate.
//
// This is an ENGINEERING approximation, not a physics-accurate model - it uses
// published, standard simplified formulas (DoD-stress weighting, linear calendar
// fade), not a validated electrochemical simulation. Treat outputs as directional
// (useful for comparing scenarios/warranty sanity-checks), not as a warranty
// guarantee or investment-grade physics prediction.
import { BatteryChemistry } from '../types/bess';

/**
 * A manufacturer-supplied depth-of-discharge vs. cycle-life curve — the "degradation
 * curve" named in BATTERY_MODEL_ARCHITECTURE.md's Level 2 parameter list. Each point
 * says: at this depth of discharge, the cell is rated for this many full cycles to
 * end of life.
 *
 * Supplying a curve replaces the single-`maxCycles` approximation with per-cycle life
 * consumption (see cycleCounting.cycleLifeConsumption), which is materially more
 * accurate for shallow cycling — real cells deliver disproportionately MORE shallow
 * cycles than a DoD-linear model predicts.
 */
export interface DodCycleLifePoint {
  depthOfDischargePct: number;
  cycles: number;
}

export interface BatteryModelConfig {
  manufacturer: string;
  model: string;
  capacityKwh: number;
  powerKw: number;
  roundTripEfficiencyPct: number; // e.g. 90 (charge x discharge combined)
  initialSohPct: number; // e.g. 100
  maxCycles: number; // rated cycle life at reference DoD (typically 80% DoD to 80% SOH)
  calendarLifeYears: number; // rated calendar life to end-of-life SOH under reference conditions

  // --- Optional Level 2 attributes -----------------------------------------------
  // All optional so every pre-existing config literal, preset and test remains valid.
  // Each has a documented default applied at the point of use, never silently here.

  /** Cell chemistry. Mirrors BessSystemInput.batteryChemistry when adapted from a scenario. */
  chemistry?: BatteryChemistry;
  /**
   * Usable depth of discharge as a percentage of physical capacity (e.g. 90).
   * Orthogonal to SOH: SOH derates the physical capacity, this derates how much of that
   * physical capacity is contractually usable. Each is applied exactly once — see
   * sohForecast.usableEnergyKwh. Defaults to 100 (all physical capacity usable).
   */
  usableDodPct?: number;
  /**
   * SOH at which the asset is considered to have reached end of life, typically 80.
   * Used to report an end-of-life year, never to floor or clamp the SOH itself.
   */
  endOfLifeSohPct?: number;
  /** Manufacturer performance-warranty term in years, if any. Reporting only. */
  warrantyYears?: number;
  /**
   * Expected average ambient/cell temperature in deg C. Promotes what was previously a
   * per-call runtime input (DegradationInputs.averageTemperatureC) to a property of the
   * modelled asset, so a forecast does not have to re-supply it every year. A per-call
   * value still wins when supplied. Defaults to the 25 deg C reference.
   */
  averageAmbientTemperatureC?: number;
  /**
   * Depth-of-discharge vs. cycle-life curve. When present it supersedes `maxCycles`
   * for cycle-ageing purposes; `maxCycles` remains the fallback and the documented
   * headline rating.
   */
  dodCycleLifeCurve?: DodCycleLifePoint[];
}

export const DEFAULT_END_OF_LIFE_SOH_PCT = 80;

export function validateBatteryModelConfig(config: BatteryModelConfig): void {
  if (config.capacityKwh <= 0) throw new Error('capacityKwh must be positive');
  if (config.powerKw <= 0) throw new Error('powerKw must be positive');
  if (config.roundTripEfficiencyPct <= 0 || config.roundTripEfficiencyPct > 100) {
    throw new Error('roundTripEfficiencyPct must be in (0, 100]');
  }
  if (config.initialSohPct <= 0 || config.initialSohPct > 100) {
    throw new Error('initialSohPct must be in (0, 100]');
  }
  if (config.maxCycles <= 0) throw new Error('maxCycles must be positive');
  if (config.calendarLifeYears <= 0) throw new Error('calendarLifeYears must be positive');

  if (config.usableDodPct !== undefined && (config.usableDodPct <= 0 || config.usableDodPct > 100)) {
    throw new Error('usableDodPct must be in (0, 100]');
  }
  if (config.endOfLifeSohPct !== undefined && (config.endOfLifeSohPct <= 0 || config.endOfLifeSohPct >= 100)) {
    throw new Error('endOfLifeSohPct must be in (0, 100)');
  }
  if (config.warrantyYears !== undefined && config.warrantyYears <= 0) {
    throw new Error('warrantyYears must be positive');
  }
  if (config.dodCycleLifeCurve !== undefined) {
    if (config.dodCycleLifeCurve.length < 2) {
      throw new Error('dodCycleLifeCurve must contain at least two points to interpolate between');
    }
    for (const point of config.dodCycleLifeCurve) {
      if (point.depthOfDischargePct <= 0 || point.depthOfDischargePct > 100) {
        throw new Error('dodCycleLifeCurve depthOfDischargePct must be in (0, 100]');
      }
      if (point.cycles <= 0) throw new Error('dodCycleLifeCurve cycles must be positive');
    }
  }
}
