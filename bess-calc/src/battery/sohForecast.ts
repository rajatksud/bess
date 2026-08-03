import { BatteryModelConfig, DEFAULT_END_OF_LIFE_SOH_PCT, validateBatteryModelConfig } from './batteryModel';
import { HalfCycle } from './cycleCounting';
import { estimateDegradation } from './degradationModel';

/**
 * Multi-year state-of-health forecasting.
 *
 * estimateDegradation is single-period: it answers "how much health did this one period
 * of duty consume?" and returns a percentage with no energy figure. This module chains it
 * across project years and defines the sohPct -> kWh convention that the dispatch and
 * financial engines need.
 *
 * =====================================================================================
 * THE sohPct -> USABLE kWh CONVENTION (authoritative definition)
 * =====================================================================================
 *
 *   physicalCapacityKwh(y) = nameplateEnergyKwh x sohPct(y) / 100
 *   usableEnergyKwh(y)     = physicalCapacityKwh(y) x usableDodPct / 100
 *
 * SOH and usableDodPct are ORTHOGONAL and each applied EXACTLY ONCE:
 *
 *   - SOH derates the PHYSICAL capacity of the cells. This is the quantity that state of
 *     charge is a percentage OF, which is why injecting SOH at dispatchEngine's
 *     currentStoredKwh/minStoredKwh/maxStoredKwh (rather than at its reported
 *     effectiveCapacityKwh) is what makes it constrain real dispatch.
 *   - usableDodPct is a contractual/reporting derate on top: how much of the physical
 *     capacity the operator is willing to cycle.
 *
 * At sohPct = 100 this reduces exactly to the engine's pre-existing
 * `ratedEnergyKwh x usableDodPct / 100`, so a beginning-of-life forecast changes nothing.
 *
 * Note the pre-existing modelling wrinkle this does NOT silently paper over: the dispatch
 * engine bounds SOC with minSocPct/maxSocPct/reserveSocPct, while usableDodPct only ever
 * fed the reported deliverable-capacity figure. Those are two different expressions of
 * "usable range" and they are not reconciled here — doing so would change existing
 * dispatch results. SOH is applied to the physical capacity underlying BOTH, which is
 * correct regardless of which of the two is treated as authoritative.
 */

/** Duty imposed on the battery by one representative simulated horizon, plus how often that horizon repeats in a year. */
export interface AnnualDutyCycle {
  /** Half-cycles extracted from one horizon's SOC trace (see systemAdapter.halfCyclesFromIntervals). */
  halfCycles: HalfCycle[];
  /** Charge + discharge throughput over that same single horizon, in kWh. */
  throughputKwh: number;
  /** How many times the horizon repeats per year (365 for a representative day, 1 for a full-year dataset). */
  repetitionsPerYear: number;
  /** Average C-rate exhibited during the horizon. Omit to use the model's 0.5C reference. */
  averageCRate?: number;
  /** Average ambient/cell temperature. Omit to use the config's value, then the 25 deg C reference. */
  averageTemperatureC?: number;
}

export interface SohYear {
  year: number;
  /** SOH at the START of this year — this is the figure dispatch should be run at (see runMultiYearSimulation). */
  sohPctStartOfYear: number;
  /** SOH at the END of this year, after a full year of the supplied duty. */
  sohPct: number;
  /** Physical capacity at end of year: nameplate x sohPct / 100. */
  capacityKwh: number;
  /** Usable energy at end of year: capacityKwh x usableDodPct / 100. */
  usableEnergyKwh: number;
  cycleAgeingPct: number;
  calendarAgeingPct: number;
  /** Cumulative DoD-weighted equivalent full cycles through the end of this year. */
  cumulativeEquivalentFullCycles: number;
}

export interface SohForecast {
  years: SohYear[];
  nameplateEnergyKwh: number;
  usableDodPct: number;
  endOfLifeSohPct: number;
  /** First project year whose END-of-year SOH falls below endOfLifeSohPct, or null if it never does within the horizon. */
  endOfLifeYear: number | null;
  warrantyYears?: number;
  /** True when end of life is reached at or before the warranty term expires — a warranty-claim signal, not a guarantee. */
  reachesEndOfLifeWithinWarranty: boolean;
  usedDodCycleLifeCurve: boolean;
  /** Human-readable statement of the convention above, carried into the report so a reader never has to guess. */
  convention: string;
}

export const SOH_CAPACITY_CONVENTION =
  'State of health derates physical battery capacity (physicalCapacityKwh = nameplate x SOH/100); ' +
  'usable depth of discharge is then applied on top (usableEnergyKwh = physicalCapacityKwh x usableDoD/100). ' +
  'The two are orthogonal and each applied exactly once.';

/**
 * Projects state of health year by year, chaining year N's end-of-year SOH into year N+1's
 * starting SOH. Chaining (rather than computing cumulative ageing in one shot) is what
 * lets each year be reported independently and lets a caller re-run dispatch at each
 * year's actual capacity.
 *
 * Ageing per year is computed from the SAME annual duty for every year. That is a
 * deliberate, documented simplification: modelling how a degraded battery's own reduced
 * capacity changes next year's duty requires re-running dispatch, which is exactly what
 * runMultiYearSimulation does — this function is the pure ageing kernel it calls.
 */
export function forecastSoh(config: BatteryModelConfig, duty: AnnualDutyCycle, years: number): SohForecast {
  validateBatteryModelConfig(config);
  if (!Number.isInteger(years) || years < 1) throw new Error('years must be a positive integer');

  const forecastYears: SohYear[] = [];
  let sohPctStartOfYear = config.initialSohPct;
  let cumulativeEquivalentFullCycles = 0;

  for (let year = 1; year <= years; year++) {
    const yearResult = degradeYear(config, sohPctStartOfYear, duty, year);
    cumulativeEquivalentFullCycles += yearResult.cumulativeEquivalentFullCycles;
    forecastYears.push({ ...yearResult, cumulativeEquivalentFullCycles });
    sohPctStartOfYear = yearResult.sohPct;
  }

  return summariseForecast(config, forecastYears, config.dodCycleLifeCurve !== undefined);
}

/**
 * Ages the battery through ONE year of the supplied duty, starting from an explicit state
 * of health.
 *
 * `startingSohPct` is a STATE, not a config field, and is deliberately not routed through
 * validateBatteryModelConfig: a chained forecast can legitimately arrive at 0% SOH (a
 * fully consumed asset), which is a valid state but not a valid specification for a new
 * battery. Conflating the two is what made an earlier draft of this module throw
 * "initialSohPct must be in (0, 100]" partway through a long forecast.
 *
 * A battery already at or below 0% SOH ages no further — there is nothing left to consume.
 */
export function degradeYear(
  config: BatteryModelConfig,
  startingSohPct: number,
  duty: AnnualDutyCycle,
  year: number
): SohYear {
  if (duty.repetitionsPerYear < 0) throw new Error('repetitionsPerYear must be non-negative');
  if (duty.throughputKwh < 0) throw new Error('throughputKwh must be non-negative');

  const usableDodPct = config.usableDodPct ?? 100;

  if (startingSohPct <= 0) {
    return {
      year,
      sohPctStartOfYear: 0,
      sohPct: 0,
      capacityKwh: 0,
      usableEnergyKwh: 0,
      cycleAgeingPct: 0,
      calendarAgeingPct: 0,
      cumulativeEquivalentFullCycles: 0
    };
  }

  const degradation = estimateDegradation({
    config: { ...config, initialSohPct: startingSohPct },
    halfCycles: duty.halfCycles,
    halfCycleRepetitions: duty.repetitionsPerYear,
    throughputKwh: duty.throughputKwh * duty.repetitionsPerYear,
    elapsedYears: 1,
    averageCRate: duty.averageCRate,
    averageTemperatureC: duty.averageTemperatureC
  });

  const capacityKwh = config.capacityKwh * (degradation.sohPct / 100);

  return {
    year,
    sohPctStartOfYear: startingSohPct,
    sohPct: degradation.sohPct,
    capacityKwh,
    usableEnergyKwh: capacityKwh * (usableDodPct / 100),
    cycleAgeingPct: degradation.cycleAgeingPct,
    calendarAgeingPct: degradation.calendarAgeingPct,
    cumulativeEquivalentFullCycles: degradation.equivalentFullCycles
  };
}

/**
 * Wraps a completed per-year SOH series into a SohForecast, deriving the end-of-life and
 * warranty signals. Shared with runMultiYearSimulation, which produces its years by
 * re-running dispatch at each year's capacity rather than by repeating a fixed duty, so
 * that the two paths cannot drift in how they define end of life.
 */
export function summariseForecast(
  config: BatteryModelConfig,
  years: SohYear[],
  usedDodCycleLifeCurve: boolean
): SohForecast {
  const endOfLifeSohPct = config.endOfLifeSohPct ?? DEFAULT_END_OF_LIFE_SOH_PCT;
  const endOfLife = years.find(y => y.sohPct < endOfLifeSohPct);
  const endOfLifeYear = endOfLife ? endOfLife.year : null;

  return {
    years,
    nameplateEnergyKwh: config.capacityKwh,
    usableDodPct: config.usableDodPct ?? 100,
    endOfLifeSohPct,
    endOfLifeYear,
    warrantyYears: config.warrantyYears,
    reachesEndOfLifeWithinWarranty:
      endOfLifeYear !== null && config.warrantyYears !== undefined && endOfLifeYear <= config.warrantyYears,
    usedDodCycleLifeCurve,
    convention: SOH_CAPACITY_CONVENTION
  };
}

/** Usable energy at a given state of health, per the convention documented above. */
export function usableEnergyKwhAtSoh(nameplateEnergyKwh: number, sohPct: number, usableDodPct: number): number {
  return nameplateEnergyKwh * (sohPct / 100) * (usableDodPct / 100);
}
