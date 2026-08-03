import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord,
  DispatchPriorityType,
  SavingsBreakdown,
  TechnicalResult
} from '../types/bess';
import { runIntervalDispatch } from './dispatchEngine';
import { DispatchAttribution } from './savingsAggregator';
import {
  BatteryModelConfig,
  BatteryModelOverrides,
  toBatteryModelConfig,
  halfCyclesFromIntervals,
  averageCRateFromIntervals,
  degradeYear,
  summariseForecast,
  validateBatteryModelConfig,
  SohForecast,
  SohYear
} from '../battery';

/**
 * Multi-year simulation: re-runs the real dispatch engine once per project year at that
 * year's actual state of health, so degradation constrains physics rather than being a
 * scalar applied to a first-year answer afterwards.
 *
 * Why this exists. The Level 1 commercial model multiplies year 1's savings by
 * (1 - annualDegradation x (y-1)). That is fine for a proposal calculator but it cannot
 * answer engineering questions — a battery at 82% SOH does not simply earn 82% of the
 * money, because a smaller battery shaves a different peak, misses different arbitrage
 * windows, and rides through a shorter outage. Re-running dispatch captures that.
 *
 * IMPORTANT PROPERTY: year 1 runs at `config.initialSohPct` (100 for a new asset), and a
 * dispatch call at 100% SOH takes the same branch as a call with no SOH at all. So
 * year 1 of a multi-year run is byte-identical to the existing single-run engine output.
 * Every test asserting current behaviour therefore also pins year 1 of this path.
 */

export interface MultiYearSimulationInput {
  intervals: IntervalRecord[];
  system: BessSystemInput;
  tariff: TariffInput;
  diesel: DieselInput;
  solar: SolarInput;
  financial: FinancialInput;
  priorities: DispatchPriorityType[];
  intervalMinutes: number;
  /** Project years to simulate. Defaults to system.projectLifeYears. */
  years?: number;
  /** How many times the supplied interval horizon repeats per year (365 for a representative day). */
  daysPerYear?: number;
  /** Datasheet values BessSystemInput cannot express (real calendar life, warranty, DoD curve, ambient temperature). */
  batteryOverrides?: BatteryModelOverrides;
}

export interface SimulatedYear {
  year: number;
  /** SOH the dispatch engine was actually run at for this year. */
  sohPctStartOfYear: number;
  /** SOH after this year's duty. */
  sohPctEndOfYear: number;
  /** Usable energy at start of year, per the sohForecast convention. */
  usableEnergyKwh: number;
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  attribution: DispatchAttribution;
}

export interface MultiYearSimulationResult {
  years: SimulatedYear[];
  sohForecast: SohForecast;
  batteryConfig: BatteryModelConfig;
  /** Year 1's full dispatch trace, identical to what a single-run call would produce. */
  yearOneIntervals: IntervalRecord[];
}

const DEFAULT_DAYS_PER_YEAR = 365;

export function runMultiYearSimulation(input: MultiYearSimulationInput): MultiYearSimulationResult {
  const daysPerYear = input.daysPerYear ?? DEFAULT_DAYS_PER_YEAR;
  const years = input.years ?? input.system.projectLifeYears ?? 10;
  if (!Number.isInteger(years) || years < 1) throw new Error('years must be a positive integer');

  const batteryConfig = toBatteryModelConfig(input.system, input.batteryOverrides);
  validateBatteryModelConfig(batteryConfig);
  const usableDodPct = batteryConfig.usableDodPct ?? 100;

  const simulatedYears: SimulatedYear[] = [];
  const sohYears: SohYear[] = [];
  let sohPctStartOfYear = batteryConfig.initialSohPct;
  let cumulativeEquivalentFullCycles = 0;
  let usedDodCycleLifeCurve = false;
  let yearOneIntervals: IntervalRecord[] = [];

  for (let year = 1; year <= years; year++) {
    // Year 1 at 100% SOH deliberately passes `undefined` rather than 100, so it takes the
    // identical code path to a pre-SOH call. Later years pass the real figure.
    const sohOption = sohPctStartOfYear === 100 ? undefined : sohPctStartOfYear;

    const run = runIntervalDispatch(
      input.intervals,
      input.system,
      input.tariff,
      input.diesel,
      input.solar,
      input.financial,
      input.priorities,
      input.intervalMinutes,
      sohOption === undefined ? {} : { batterySohPct: sohOption }
    );

    if (year === 1) yearOneIntervals = run.simulatedIntervals;

    // Age the battery using THIS year's actual duty, derived from THIS year's trace.
    const duty = {
      halfCycles: halfCyclesFromIntervals(run.simulatedIntervals),
      throughputKwh: run.attribution.totalChargedKwh + run.attribution.totalDischargedKwh,
      repetitionsPerYear: daysPerYear,
      averageCRate: averageCRateFromIntervals(run.simulatedIntervals, batteryConfig.capacityKwh)
    };

    const singleYear = degradeYear(batteryConfig, sohPctStartOfYear, duty, year);
    usedDodCycleLifeCurve = usedDodCycleLifeCurve || batteryConfig.dodCycleLifeCurve !== undefined;
    cumulativeEquivalentFullCycles += singleYear.cumulativeEquivalentFullCycles;

    sohYears.push({ ...singleYear, cumulativeEquivalentFullCycles });

    simulatedYears.push({
      year,
      sohPctStartOfYear,
      sohPctEndOfYear: singleYear.sohPct,
      usableEnergyKwh: batteryConfig.capacityKwh * (sohPctStartOfYear / 100) * (usableDodPct / 100),
      savings: run.savings,
      technical: run.technical,
      attribution: run.attribution
    });

    sohPctStartOfYear = singleYear.sohPct;
  }

  return {
    years: simulatedYears,
    sohForecast: summariseForecast(batteryConfig, sohYears, usedDodCycleLifeCurve),
    batteryConfig,
    yearOneIntervals
  };
}
