// Engineering degradation model (Level 2) - see batteryModel.ts's module header for
// the scope/accuracy caveat. Combines three independent stress mechanisms into a
// single SOH estimate; each is a standard simplified engineering formula, not a
// fitted/validated model for any specific cell chemistry.
import { BatteryModelConfig } from './batteryModel';
import { HalfCycle, equivalentFullCycles, cycleLifeConsumption } from './cycleCounting';

export interface DegradationInputs {
  config: BatteryModelConfig;
  /** Half-cycles observed over the period being assessed (see cycleCounting.ts). */
  halfCycles: HalfCycle[];
  /**
   * How many times the supplied `halfCycles` set repeats over the assessed period.
   * Lets a representative-day SOC trace stand in for a whole year (repetitions = 365)
   * without materialising 365 copies of the array. Defaults to 1 (the half-cycles ARE
   * the whole period), which is the pre-existing behaviour.
   */
  halfCycleRepetitions?: number;
  /** Total charge+discharge throughput over the period, in kWh. */
  throughputKwh: number;
  /** Elapsed time being assessed, in years (fractional allowed, e.g. 0.25 for a quarter). */
  elapsedYears: number;
  /**
   * Average C-rate (charge/discharge power relative to capacity, e.g. 0.5C) over the
   * period. Higher C-rate accelerates cycle ageing beyond what DoD alone predicts.
   * Optional - defaults to a benign 0.5C reference if not supplied.
   */
  averageCRate?: number;
  /**
   * Average ambient/cell temperature in deg C over the period. Optional placeholder -
   * defaults to a benign 25 deg C reference (no calendar-ageing penalty/bonus) if not
   * supplied. A real thermal model is explicitly out of scope (Level 3).
   */
  averageTemperatureC?: number;
}

export interface DegradationResult {
  throughputAgeingPct: number;
  cycleAgeingPct: number;
  calendarAgeingPct: number;
  totalAgeingPct: number;
  sohPct: number;
  /**
   * DoD-weighted equivalent full cycles consumed over the assessed period, derived from
   * the SOC trace. NOTE the deliberate naming collision with
   * TechnicalResult.equivalentFullCycles, which is a DIFFERENT quantity (annual
   * throughput ÷ nameplate energy — a utilisation ratio, not an ageing measure). This
   * one is canonical for ageing; see docs/architecture/BATTERY_MODEL_ARCHITECTURE.md.
   */
  equivalentFullCycles: number;
  /** True when a manufacturer DoD-vs-cycle-life curve drove cycle ageing instead of the flat maxCycles approximation. */
  usedDodCycleLifeCurve: boolean;
}

const REFERENCE_C_RATE = 0.5;
const REFERENCE_TEMPERATURE_C = 25;
/** Standard simplified assumption: C-rate ageing stress scales with the square root of C-rate ratio (mild penalty for fast cycling, mild bonus for slow cycling), a common first-order approximation absent a manufacturer-supplied C-rate-vs-life curve. */
const C_RATE_AGEING_EXPONENT = 0.5;
/** Standard simplified assumption: every 10 deg C above the 25 deg C reference roughly doubles calendar fade rate (Arrhenius-style rule of thumb), and every 10 deg C below roughly halves it, floored to avoid an unphysical near-zero fade rate. */
const ARRHENIUS_DOUBLING_INTERVAL_C = 10;
const MIN_CALENDAR_AGEING_FACTOR = 0.25;

function calendarAgeingFactor(averageTemperatureC: number): number {
  const deltaC = averageTemperatureC - REFERENCE_TEMPERATURE_C;
  const factor = Math.pow(2, deltaC / ARRHENIUS_DOUBLING_INTERVAL_C);
  return Math.max(MIN_CALENDAR_AGEING_FACTOR, factor);
}

/**
 * Estimates state-of-health loss over the assessed period from three combined stress
 * mechanisms:
 *   - Cycle ageing: equivalent full cycles / rated maxCycles, at 100% ageing budget
 *     for the full rated life, scaled by a C-rate stress factor.
 *   - Calendar ageing: elapsed time / rated calendarLifeYears, scaled by a
 *     temperature stress factor.
 *   - Throughput ageing: informational cross-check only (equivalentFullCycles already
 *     captures DoD-weighted throughput more precisely) - reported separately so a
 *     caller can sanity-check cycle counting against raw kWh throughput.
 * Cycle and calendar ageing are combined additively (both mechanisms degrade the
 * same underlying cell chemistry and are treated as independent, summable stress
 * contributions - the standard simplified engineering combination absent a
 * validated interaction model).
 */
export function estimateDegradation(inputs: DegradationInputs): DegradationResult {
  const { config, halfCycles, throughputKwh, elapsedYears } = inputs;
  const repetitions = inputs.halfCycleRepetitions ?? 1;
  const averageCRate = inputs.averageCRate ?? REFERENCE_C_RATE;
  const averageTemperatureC = inputs.averageTemperatureC ?? config.averageAmbientTemperatureC ?? REFERENCE_TEMPERATURE_C;

  if (elapsedYears < 0) throw new Error('elapsedYears must be non-negative');
  if (throughputKwh < 0) throw new Error('throughputKwh must be non-negative');
  if (averageCRate <= 0) throw new Error('averageCRate must be positive');
  if (repetitions < 0) throw new Error('halfCycleRepetitions must be non-negative');

  const cycles = equivalentFullCycles(halfCycles) * repetitions;
  const cRateStressFactor = Math.pow(averageCRate / REFERENCE_C_RATE, C_RATE_AGEING_EXPONENT);

  // Cycle ageing: honour a manufacturer DoD-vs-cycle-life curve when one is supplied,
  // otherwise fall back to the DoD-linear equivalent-full-cycle approximation against a
  // single maxCycles rating. Both express "fraction of rated cycle life consumed".
  const usedDodCycleLifeCurve = config.dodCycleLifeCurve !== undefined && config.dodCycleLifeCurve.length > 0;
  const cycleLifeFraction = usedDodCycleLifeCurve
    ? cycleLifeConsumption(halfCycles, config.dodCycleLifeCurve!) * repetitions
    : cycles / config.maxCycles;
  const cycleAgeingPct = cycleLifeFraction * 100 * cRateStressFactor;

  const calendarFactor = calendarAgeingFactor(averageTemperatureC);
  const calendarAgeingPct = (elapsedYears / config.calendarLifeYears) * 100 * calendarFactor;

  const referenceCycleThroughputKwh = config.capacityKwh * config.maxCycles * 2; // charge + discharge per cycle
  const throughputAgeingPct = referenceCycleThroughputKwh > 0
    ? (throughputKwh / referenceCycleThroughputKwh) * 100
    : 0;

  const totalAgeingPct = cycleAgeingPct + calendarAgeingPct;
  const sohPct = Math.max(0, Math.min(config.initialSohPct, config.initialSohPct - totalAgeingPct));

  return {
    throughputAgeingPct,
    cycleAgeingPct,
    calendarAgeingPct,
    totalAgeingPct,
    sohPct,
    equivalentFullCycles: cycles,
    usedDodCycleLifeCurve
  };
}
