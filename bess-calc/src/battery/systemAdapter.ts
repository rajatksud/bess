import { BessSystemInput, IntervalRecord } from '../types/bess';
import { BatteryModelConfig } from './batteryModel';
import { HalfCycle, extractHalfCycles } from './cycleCounting';

/**
 * Adapter between the scenario's battery inputs and the Level 2 engineering battery model.
 *
 * CANONICAL DIRECTION: BessSystemInput -> BatteryModelConfig, one way only.
 *
 * Rationale. `BessSystemInput` is the system of record: it is what the UI edits, what
 * Zod validates at the API boundary, and what Prisma persists in Scenario.batteryConfig.
 * `BatteryModelConfig` is a DERIVED engineering view of the same physical asset, used by
 * the ageing model. The reverse direction is deliberately not provided because it cannot
 * be total — BatteryModelConfig carries no SOC window, no auxiliary load, no project life
 * and no availability, so reconstructing a BessSystemInput from one would require
 * inventing values, which is exactly the kind of silent assumption this codebase forbids.
 *
 * Round-trip safety therefore is not a goal; single-direction fidelity is.
 */

/** Fields a caller may layer on top of what BessSystemInput can express (datasheet values, warranty terms, a measured DoD curve). */
export type BatteryModelOverrides = Partial<Omit<BatteryModelConfig, 'capacityKwh' | 'powerKw'>>;

/**
 * Derives a BatteryModelConfig from a scenario's BessSystemInput.
 *
 * Field mapping, with the reason for each:
 *   capacityKwh            <- ratedEnergyKwh          nameplate energy, beginning of life
 *   powerKw                <- ratedPowerKw
 *   roundTripEfficiencyPct <- chargeEff x dischargeEff  (BessSystemInput stores the two
 *                                                        halves; the battery model stores
 *                                                        the combined round trip)
 *   maxCycles              <- cycleLife
 *   calendarLifeYears      <- projectLifeYears         BessSystemInput has no separate
 *                                                      calendar-life field. Using project
 *                                                      life is a DOCUMENTED ASSUMPTION,
 *                                                      not a datasheet value: it says
 *                                                      "the asset is expected to last the
 *                                                      project". Override with the real
 *                                                      datasheet figure when known.
 *   usableDodPct           <- usableDodPct
 *   chemistry              <- batteryChemistry
 *   initialSohPct          = 100                       a scenario describes a new asset
 *
 * `annualDegradationPct` is intentionally NOT mapped. It is the Level 1 commercial
 * flat-fade coefficient; this model computes fade from duty instead. Feeding it in would
 * apply the same physical effect twice.
 */
export function toBatteryModelConfig(
  system: BessSystemInput,
  overrides: BatteryModelOverrides = {}
): BatteryModelConfig {
  return {
    manufacturer: 'Unspecified',
    model: `${system.batteryChemistry}-${system.ratedEnergyKwh}`,
    capacityKwh: system.ratedEnergyKwh,
    powerKw: system.ratedPowerKw,
    roundTripEfficiencyPct: (system.chargeEfficiencyPct / 100) * (system.dischargeEfficiencyPct / 100) * 100,
    initialSohPct: 100,
    maxCycles: system.cycleLife,
    calendarLifeYears: system.projectLifeYears,
    chemistry: system.batteryChemistry,
    usableDodPct: system.usableDodPct,
    ...overrides
  };
}

/**
 * The missing SOC-trace bridge: turns a simulated dispatch trace into the plain number[]
 * that extractHalfCycles consumes. Nothing linked these two before — src/battery had no
 * production caller at all.
 */
export function socTraceFromIntervals(intervals: IntervalRecord[]): number[] {
  return intervals.map(interval => interval.bessSocPct);
}

/** Convenience: SOC trace -> half-cycles in one step. */
export function halfCyclesFromIntervals(intervals: IntervalRecord[]): HalfCycle[] {
  return extractHalfCycles(socTraceFromIntervals(intervals));
}

/**
 * Average C-rate actually exhibited by a dispatch trace: mean absolute battery power over
 * the intervals where the battery was active, relative to nameplate energy.
 *
 * Idle intervals are excluded deliberately. Including them would average a real 0.5C duty
 * down towards zero purely because the battery spent most of the day idle, understating
 * the C-rate STRESS that the ageing model is asking about — the question is "how hard was
 * it worked when it worked", not "how much of the day did it work".
 *
 * Returns undefined when the battery never moved, so the caller falls through to
 * estimateDegradation's documented 0.5C reference rather than dividing by zero.
 */
export function averageCRateFromIntervals(intervals: IntervalRecord[], nameplateEnergyKwh: number): number | undefined {
  if (nameplateEnergyKwh <= 0) return undefined;
  const active = intervals.filter(interval => Math.abs(interval.bessPowerKw) > 0);
  if (active.length === 0) return undefined;
  const meanAbsPowerKw = active.reduce((sum, interval) => sum + Math.abs(interval.bessPowerKw), 0) / active.length;
  const cRate = meanAbsPowerKw / nameplateEnergyKwh;
  return cRate > 0 ? cRate : undefined;
}
