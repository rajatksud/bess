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
import { DispatchAttribution, emptyAttribution, aggregateSavings } from './savingsAggregator';

/**
 * Optional, additive dispatch settings. Introduced as an options object rather than a
 * ninth positional parameter because three call sites already pass eight positional
 * arguments (src/App.tsx, server/routes/simulation.ts, server/routes/simulations.ts).
 *
 * Every field is optional and every omitted field takes a branch that reproduces the
 * pre-existing behaviour EXACTLY - not "multiplied by 1.0", but literally the same
 * expression - so a call with no options is byte-identical to a call from before this
 * type existed.
 */
export interface DispatchOptions {
  /**
   * Battery state of health for this run, as a percentage of nameplate energy
   * (e.g. 87.4 after several years of ageing). When supplied, it derates the PHYSICAL
   * energy the battery can store, which is what SOC percentages are measured against -
   * so it constrains real dispatch, not just the reported capacity figure.
   *
   * Omit for a beginning-of-life (100% SOH) run. See src/battery/sohForecast.ts for the
   * sohPct -> usable kWh convention and how it composes with usableDodPct.
   */
  batterySohPct?: number;
}

/**
 * Resolves the kW -> kVA billing basis per the deterministic reactive-power policy
 * (Objective A): measured kVA > measured PF > configured site PF > unavailable.
 * The MVP only ever has a configured site PF (tariff.powerFactor) or nothing;
 * measured-kVA/measured-PF inputs are accepted here so a future CSV import that
 * supplies per-interval PF/kVA can be wired through without changing this contract.
 */
export function resolveReactivePowerBasis(
  measuredKva: number | undefined,
  measuredPf: number | undefined,
  configuredPf: number | undefined
): ReactivePowerBasis {
  if (measuredKva !== undefined && measuredKva >= 0) return 'measured_kva';
  if (measuredPf !== undefined && measuredPf > 0 && measuredPf <= 1) return 'measured_pf';
  if (configuredPf !== undefined && configuredPf > 0 && configuredPf <= 1) return 'configured_pf';
  return 'unavailable';
}

export function runIntervalDispatch(
  intervals: IntervalRecord[],
  system: BessSystemInput,
  tariff: TariffInput,
  diesel: DieselInput,
  solar: SolarInput,
  financial: FinancialInput,
  priorities: DispatchPriorityType[] = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'],
  intervalMinutes = 15,
  options: DispatchOptions = {}
): {
  simulatedIntervals: IntervalRecord[];
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  attribution: DispatchAttribution;
  reactivePowerBasis: ReactivePowerBasis;
  assumptions: string[];
} {
  const dtHours = intervalMinutes / 60;
  const etaCharge = system.chargeEfficiencyPct / 100;
  const etaDischarge = system.dischargeEfficiencyPct / 100;

  // State of health derates the PHYSICAL storable energy. Everything downstream that
  // reads a SOC percentage is measuring against this number, so this single substitution
  // is what makes SOH constrain real dispatch rather than only the reported capacity.
  //
  // The `undefined` branch returns system.ratedEnergyKwh itself (not a multiplication by
  // 1.0), so a run without SOH is structurally identical to the pre-SOH engine.
  const healthAdjustedEnergyKwh = options.batterySohPct === undefined
    ? system.ratedEnergyKwh
    : system.ratedEnergyKwh * (options.batterySohPct / 100);

  // Reported deliverable capacity: usable depth-of-discharge applied on top of the
  // health-adjusted physical capacity. SOH and usableDodPct are orthogonal and each
  // applied exactly once - see docs/architecture/BATTERY_MODEL_ARCHITECTURE.md.
  const effectiveCapacityKwh = healthAdjustedEnergyKwh * (system.usableDodPct / 100);

  let currentSocPct = system.initialSocPct;
  const minUsableSocPct = Math.max(system.minSocPct, system.minSocPct + system.reserveSocPct);
  const maxUsableSocPct = system.maxSocPct;

  let totalChargedKwh = 0;
  let totalDischargedKwh = 0;
  let totalSolarStoredKwh = 0;
  let totalDgDisplacedKwh = 0;
  let totalUnservedBackupKwh = 0;
  let totalCurtailedSolarKwh = 0;
  let totalGridChargedKwh = 0;

  // Rule 2 (no double counting): each kWh discharged is attributed to exactly ONE
  // avoided-cost category based on the bessAction tag assigned in the priority loop
  // below. These per-category accumulators are the ONLY inputs the savings
  // calculation may use for peak-shaving/arbitrage energy. Do not derive per-category
  // savings from the aggregate totalDischargedKwh/totalChargedKwh above — those two
  // remain valid ONLY for physical/degradation purposes (SOC, cycle counting),
  // because they intentionally mix energy from every avoided-cost category.
  let totalArbitrageDischargedKwh = 0;
  let totalArbitrageChargedKwh = 0;
  // Peak-shaving discharge is monetised through the billed-peak delta, not per kWh, so
  // this accumulator feeds no formula. It exists so the Rule 2 balance
  // (dg + peakShaving + arbitrage === totalDischarged) is checkable on this path too -
  // see savingsAggregator.attributionViolations.
  let totalPeakShavingDischargedKwh = 0;

  // Reactive-power (kW -> kVA) billing basis, resolved once for the whole profile per
  // the deterministic policy: measured kVA > measured PF > configured site PF >
  // unavailable. The MVP only ever supplies tariff.powerFactor (configured), so solar
  // and BESS inverters are assumed unity PF unless a future measured basis is wired
  // through generateIntervals/CSV import. This assumption is surfaced explicitly in
  // `assumptions` and, when no basis at all is available, in `warnings`-worthy output.
  const reactivePowerBasis = resolveReactivePowerBasis(undefined, undefined, tariff.powerFactor);
  const pf = reactivePowerBasis !== 'unavailable' ? tariff.powerFactor : undefined;
  const assumptions: string[] = [];
  if (reactivePowerBasis === 'configured_pf') {
    assumptions.push(
      'kVA billing quantities are derived from the configured site power factor ' +
      `(${tariff.powerFactor}), not measured per-interval kVA or PF. Solar and BESS ` +
      'inverters are assumed to operate at unity power factor.'
    );
  } else if (reactivePowerBasis === 'unavailable') {
    assumptions.push(
      'No power-factor or kVA basis is available (configured site PF is missing or ' +
      'invalid). kVA-based billing quantities cannot be calculated; kW-only figures ' +
      'are reported instead.'
    );
  }

  // Pre-BESS meter-side grid import, per interval: max(grossLoad - solarServingLoad, 0).
  // This is the physically correct peak-shaving target — NOT gross site load — because
  // solar already reduces what the grid meter would see before any battery acts.
  const preBessGridImportSeries: number[] = intervals.map(inv => {
    const solarServingLoad = Math.min(Math.max(inv.solarKw, 0), Math.max(inv.loadKw, 0));
    return Math.max(inv.loadKw - solarServingLoad, 0);
  });

  // Find Peak Before BESS across the profile, based on meter-side (net-of-solar) import,
  // not gross site load. peakBeforeKva is derived from the same net kW peak via the
  // resolved reactive-power basis (undefined PF => kVA figures stay at 0 / unavailable).
  let peakBeforeKw = 0;
  intervals.forEach((inv, i) => {
    if (preBessGridImportSeries[i] > peakBeforeKw) peakBeforeKw = preBessGridImportSeries[i];
  });
  const peakBeforeKva = pf ? peakBeforeKw / pf : 0;

  // Calculate target grid demand for peak shaving (bounded by battery rated kW).
  //
  // Bug fixed here: max(0, peakBeforeKw - ratedPowerKw) collapses to 0 whenever the
  // battery is rated at or above the profile's peak load (a battery "big enough to
  // shave the whole peak"). With target = 0, the peak_shaving priority below would
  // then match EVERY interval with any net import at all, discharging the battery
  // against ordinary base load that was never actually a demand-charge problem -
  // starving every lower-priority use (solar charging, arbitrage) of any opportunity
  // to claim the battery, and typically flattening SOC to its floor well before
  // intervals that genuinely need it (e.g. an evening outage or TOU-peak window later
  // the same day).
  //
  // Fix: shave down toward the NEXT-highest distinct net-import level actually observed
  // in the profile, not toward zero. This correctly distinguishes a genuine, rare peak
  // spike (a profile with one dominant maximum - shave it down as far as the battery
  // allows, per the original single-peak intent) from a profile with several recurring
  // load levels through the day (e.g. a low midday base load and a higher evening
  // load) - ordinary recurring load levels are never treated as "the peak" needing to
  // be shaved toward zero. Target is now computed against NET (meter-side) import so
  // that solar's own load-serving contribution isn't double-counted as "peak shaved by
  // the battery" - the general net-load fix beyond the earlier
  // battery-larger-than-peak special case.
  // When the profile has no second distinct net-import level (a flat/uniform profile,
  // or too few intervals to observe one) AND the battery is rated at or above the
  // whole peak, there is no "ordinary recurring load level" to fall back to below the
  // single observed level - pin the target at peakBeforeKw itself (i.e. "this level is
  // the baseline, not a peak to shave toward zero"). When the battery is genuinely
  // smaller than the peak, fall back to 0 so `peakBeforeKw - ratedPowerKw` (a strictly
  // positive, real shave amount) still applies instead of being masked by the pin.
  const distinctNetImportLevelsDesc = Array.from(new Set(preBessGridImportSeries)).sort((a, b) => b - a);
  const batteryCoversWholePeak = system.ratedPowerKw >= peakBeforeKw;
  const singleLevelFallbackKw = batteryCoversWholePeak ? peakBeforeKw : 0;
  const nextHighestNetImportLevelKw = distinctNetImportLevelsDesc.length > 1 ? distinctNetImportLevelsDesc[1] : singleLevelFallbackKw;
  const targetPeakKw = Math.max(nextHighestNetImportLevelKw, peakBeforeKw - system.ratedPowerKw);

  const simulatedIntervals: IntervalRecord[] = [];

  intervals.forEach((inv, intervalIdx) => {
    let loadKw = inv.loadKw;
    let solarKw = inv.solarKw;
    const gridAvailable = inv.gridAvailable;
    const preBessGridImportKw = preBessGridImportSeries[intervalIdx];
    const solarGenerationServingLoadKw = Math.min(Math.max(solarKw, 0), Math.max(loadKw, 0));

    let bessPowerKw = 0; // Positive = discharging, Negative = charging
    let bessAction = 'Idle';
    let solarCurtailedKw = 0;

    // Remaining capacity in battery for this interval, measured against the
    // health-adjusted physical capacity (see healthAdjustedEnergyKwh above). THIS is the
    // real energy bound on dispatch.
    const currentStoredKwh = (currentSocPct / 100) * healthAdjustedEnergyKwh;
    const minStoredKwh = (minUsableSocPct / 100) * healthAdjustedEnergyKwh;
    const maxStoredKwh = (maxUsableSocPct / 100) * healthAdjustedEnergyKwh;

    const availableDischargeKwh = Math.max(0, currentStoredKwh - minStoredKwh);
    const maxDischargeKwPossible = Math.min(system.ratedPowerKw, availableDischargeKwh / dtHours);

    const availableChargeKwh = Math.max(0, maxStoredKwh - currentStoredKwh);
    const maxChargeKwPossible = Math.min(system.ratedPowerKw, availableChargeKwh / dtHours);

    let remainingDischargeKw = maxDischargeKwPossible;
    let remainingChargeKw = maxChargeKwPossible;

    // Process priorities
    for (const priority of priorities) {
      if (bessPowerKw !== 0) continue; // Battery occupied in this interval

      if (priority === 'backup_reserve' && !gridAvailable && loadKw > 0) {
        // Discharging during grid outage to supply load & displace DG
        const dischargeKw = Math.min(loadKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw; // discharging
          bessAction = 'Backup / DG Displacement';
          totalDgDisplacedKwh += dischargeKw * dtHours;
        }
      }

      else if (priority === 'peak_shaving' && gridAvailable && preBessGridImportKw > targetPeakKw) {
        const requiredShaveKw = preBessGridImportKw - targetPeakKw;
        const dischargeKw = Math.min(requiredShaveKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw;
          bessAction = 'Peak Shaving';
          totalPeakShavingDischargedKwh += dischargeKw * dtHours;
        }
      }

      else if (priority === 'solar_self_consumption' && gridAvailable && solarKw > loadKw) {
        const excessSolarKw = solarKw - loadKw;
        const chargeKw = Math.min(excessSolarKw, remainingChargeKw);
        if (chargeKw > 0) {
          bessPowerKw = -chargeKw; // negative = charging
          bessAction = 'Solar Surplus Charging';
          totalSolarStoredKwh += chargeKw * dtHours;
        }
      }

      else if (priority === 'diesel_displacement' && inv.dgRequiredKw > 0 && bessPowerKw === 0) {
        const dischargeKw = Math.min(inv.dgRequiredKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw;
          bessAction = 'Diesel Displacement';
          totalDgDisplacedKwh += dischargeKw * dtHours;
        }
      }

      else if (priority === 'tou_arbitrage' && gridAvailable && bessPowerKw === 0) {
        // Charge off-peak (if rate < standard or during night), Discharge peak
        if (inv.tariffPeriod === 'Peak Surge' || inv.tariffImportRate > tariff.energyChargePerKwh * 1.2) {
          const dischargeKw = Math.min(loadKw, remainingDischargeKw);
          if (dischargeKw > 0) {
            bessPowerKw = dischargeKw;
            bessAction = 'TOU Arbitrage Discharge';
            totalArbitrageDischargedKwh += dischargeKw * dtHours;
          }
        } else if (inv.tariffPeriod === 'Off-Peak Discount' || inv.tariffImportRate < tariff.energyChargePerKwh * 0.8) {
          const chargeKw = remainingChargeKw;
          if (chargeKw > 0) {
            bessPowerKw = -chargeKw;
            bessAction = 'TOU Off-Peak Charge';
            totalGridChargedKwh += chargeKw * dtHours;
            totalArbitrageChargedKwh += chargeKw * dtHours;
          }
        }
      }
    }

    // Update state of charge
    let netEnergyKwhChange = 0;
    if (bessPowerKw > 0) {
      // Discharging
      const dischargedEnergyKwh = bessPowerKw * dtHours;
      netEnergyKwhChange = -(dischargedEnergyKwh / etaDischarge);
      totalDischargedKwh += dischargedEnergyKwh;
    } else if (bessPowerKw < 0) {
      // Charging
      const chargedEnergyKwh = Math.abs(bessPowerKw) * dtHours;
      netEnergyKwhChange = chargedEnergyKwh * etaCharge;
      totalChargedKwh += chargedEnergyKwh;
    }

    const nextStoredKwh = Math.min(maxStoredKwh, Math.max(minStoredKwh, currentStoredKwh + netEnergyKwhChange));
    currentSocPct = (nextStoredKwh / healthAdjustedEnergyKwh) * 100;

    const batteryDischargeKw = bessPowerKw > 0 ? bessPowerKw : 0;
    const batteryChargeKw = bessPowerKw < 0 ? Math.abs(bessPowerKw) : 0;
    // Charging is attributed to solar first (bessAction === 'Solar Surplus Charging'
    // is the only priority branch that charges from surplus solar; every other
    // charge branch, e.g. TOU off-peak, draws from the grid). This keeps
    // gridBatteryChargeKw consistent with the totalGridChargedKwh/totalSolarStoredKwh
    // accumulators already tracked per-category above (Rule 2: no double counting).
    const solarSourcedChargeKw = bessAction === 'Solar Surplus Charging' ? batteryChargeKw : 0;
    const gridBatteryChargeKw = batteryChargeKw - solarSourcedChargeKw;

    // Post-BESS meter-side grid import: max(grossLoad - solarServingLoad - batteryDischarge + gridBatteryCharge, 0).
    const postBessGridImportKw = Math.max(
      loadKw - solarGenerationServingLoadKw - batteryDischargeKw + gridBatteryChargeKw,
      0
    );
    // postBessLoadKw is retained for backward compatibility with existing UI/tests as
    // the net demand on load after battery discharge only (pre-existing field shape);
    // meter-side billing must use postBessGridImportKw instead.
    const postBessLoadKw = Math.max(0, loadKw - batteryDischargeKw);
    const postBessLoadKva = pf ? postBessGridImportKw / pf : 0;

    let postBessDgKw = 0;
    if (!gridAvailable) {
      postBessDgKw = Math.max(0, loadKw - batteryDischargeKw);
      if (postBessDgKw > 0) {
        totalUnservedBackupKwh += postBessDgKw * dtHours;
      }
    }

    // Excess unabsorbed solar: generation beyond what load consumes directly and what
    // the battery absorbs into charge from solar.
    const solarAbsorbedKw = solarGenerationServingLoadKw + solarSourcedChargeKw;
    if (solarKw > solarAbsorbedKw) {
      solarCurtailedKw = solarKw - solarAbsorbedKw;
      totalCurtailedSolarKwh += solarCurtailedKw * dtHours;
    }

    // Export only when the grid is available and generation, net of what load and the
    // battery consumed, still exceeds zero. Export is deliberately NOT netted against
    // postBessGridImportKw - the two are physically mutually exclusive within an
    // interval (a meter cannot import and export simultaneously), so at most one of
    // them is nonzero given the solar/battery accounting above.
    const gridImportKw = gridAvailable ? postBessGridImportKw : 0;
    const gridExportKw = gridAvailable ? Math.max(0, solarKw - solarAbsorbedKw - postBessGridImportKw) : 0;

    simulatedIntervals.push({
      ...inv,
      bessPowerKw,
      bessSocPct: currentSocPct,
      bessEnergyKwh: nextStoredKwh,
      postBessLoadKw,
      postBessLoadKva,
      postBessDgKw,
      gridImportKw,
      gridExportKw,
      solarCurtailedKw,
      bessAction,
      grossSiteLoadKw: loadKw,
      solarGenerationKw: solarKw,
      solarGenerationServingLoadKw,
      preBessGridImportKw,
      postBessGridImportKw,
      batteryChargeKw,
      batteryDischargeKw,
      gridBatteryChargeKw,
      preBessGridImportKva: pf ? preBessGridImportKw / pf : undefined,
      postBessGridImportKva: pf ? postBessGridImportKw / pf : undefined
    });
  });
  const attribution: DispatchAttribution = {
    ...emptyAttribution(),
    dgDisplacedKwh: totalDgDisplacedKwh,
    peakShavingKwh: totalPeakShavingDischargedKwh,
    arbitrageDischargeKwh: totalArbitrageDischargedKwh,
    solarStoredKwh: totalSolarStoredKwh,
    gridChargedKwh: totalGridChargedKwh,
    arbitrageChargedKwh: totalArbitrageChargedKwh,
    totalChargedKwh,
    totalDischargedKwh,
    unservedBackupKwh: totalUnservedBackupKwh,
    curtailedSolarKwh: totalCurtailedSolarKwh
  };

  const { savings, technical } = aggregateSavings(
    {
      simulatedIntervals,
      attribution,
      peakBeforeKw,
      peakBeforeKva,
      powerFactor: pf,
      minimumSocPct: minUsableSocPct,
      maximumSocPct: maxUsableSocPct,
      deliverableCapacityKwh: effectiveCapacityKwh
    },
    system,
    tariff,
    diesel,
    solar,
    financial
  );

  return {
    simulatedIntervals,
    savings,
    technical,
    attribution,
    reactivePowerBasis,
    assumptions
  };
}
