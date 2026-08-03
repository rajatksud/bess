import { IntervalRecord, SolarInput } from '../types/bess';
import { OptimisationInterval, OptimisationBatteryConfig, DispatchInterval } from './types';
import { BessSystemInput, FinancialInput } from '../types/bess';
import { DEFAULT_HORIZON_START_ISO } from './optimizer';

/**
 * Adapters between the engine's IntervalRecord and the optimiser's OptimisationInterval.
 *
 * THE MISMATCH, stated plainly because it is lossy in one direction:
 *
 *   IntervalRecord            OptimisationInterval
 *   ---------------------     -------------------------------------------
 *   loadKw (GROSS)            netLoadKw (already net of solar)
 *   solarKw                   (no equivalent — INFORMATION IS LOST)
 *   dgRequiredKw              (no equivalent — INFORMATION IS LOST)
 *   intervalIndex + timeLabel timestamp (ISO, needs a date the label lacks)
 *   (cadence is global)       durationHours (per interval)
 *   gridAvailable             isOutage (inverted)
 *   tariffImportRate          importRatePerKwh
 *
 * Because solar and DG cannot survive the trip, `fromDispatchIntervals` requires the
 * ORIGINAL IntervalRecord[] to reconstruct a full record. There is deliberately no
 * standalone OptimisationInterval -> IntervalRecord function: one would have to
 * fabricate the missing fields.
 */

export interface ToOptimisationIntervalsOptions {
  intervalMinutes: number;
  solar: SolarInput;
  horizonStartIso?: string;
}

export function toOptimisationIntervals(
  intervals: IntervalRecord[],
  options: ToOptimisationIntervalsOptions
): OptimisationInterval[] {
  const durationHours = options.intervalMinutes / 60;
  const startMs = Date.parse(options.horizonStartIso ?? DEFAULT_HORIZON_START_ISO);
  if (Number.isNaN(startMs)) throw new Error('horizonStartIso must be a valid ISO timestamp');

  return intervals.map((interval, index) => {
    // netLoadKw is exactly the engine's preBessGridImportKw definition: gross load less
    // the solar that actually serves it. Using gross load here would double-count solar,
    // since the LP would then be asked to displace load solar had already served.
    const solarServingLoadKw = Math.min(Math.max(interval.solarKw, 0), Math.max(interval.loadKw, 0));
    const netLoadKw = Math.max(interval.loadKw - solarServingLoadKw, 0);

    return {
      timestamp: new Date(startMs + index * options.intervalMinutes * 60_000).toISOString(),
      durationHours,
      netLoadKw,
      importRatePerKwh: interval.tariffImportRate,
      exportCreditPerKwh: options.solar.exportCreditPerKwh,
      exportAllowed: options.solar.exportAllowed,
      isOutage: !interval.gridAvailable
    };
  });
}

export function toOptimisationBatteryConfig(
  system: BessSystemInput,
  financial: FinancialInput,
  batterySohPct?: number
): OptimisationBatteryConfig {
  // The LP's energy bound must be derated by state of health for the same reason the
  // rule-based engine's is: SOC percentages are a fraction of PHYSICAL capacity.
  const ratedEnergyKwh = batterySohPct === undefined
    ? system.ratedEnergyKwh
    : system.ratedEnergyKwh * (batterySohPct / 100);

  return {
    ratedPowerKw: system.ratedPowerKw,
    ratedEnergyKwh,
    minSocPct: system.minSocPct,
    maxSocPct: system.maxSocPct,
    initialSocPct: system.initialSocPct,
    reserveSocPct: system.reserveSocPct,
    chargeEfficiencyPct: system.chargeEfficiencyPct,
    dischargeEfficiencyPct: system.dischargeEfficiencyPct,
    degradationCostPerKwh: financial.variableOmPerKwhThroughput || 0.15
  };
}

/**
 * Merges an optimiser's kW schedule back into full IntervalRecords, reusing the ORIGINAL
 * records for everything the optimiser could not see (solar, DG, gross load, tariff tags).
 *
 * The per-interval physical bookkeeping below (solar-first charge attribution, meter-side
 * import/export, curtailment, kVA derivation) is deliberately the same arithmetic as
 * src/engine/dispatchEngine.ts so that a record produced here is indistinguishable in
 * shape and meaning from one the rule-based engine produced — which is what lets both
 * feed the same savingsAggregator.
 */
export interface MergeDispatchOptions {
  intervalMinutes: number;
  ratedEnergyKwh: number;
  powerFactor?: number;
  /** Per-interval action tags produced by the attribution rule (see lpAttribution.ts). */
  actionTags: string[];
}

export function mergeDispatchIntoIntervals(
  originals: IntervalRecord[],
  dispatch: DispatchInterval[],
  options: MergeDispatchOptions
): IntervalRecord[] {
  if (originals.length !== dispatch.length) {
    throw new Error(`Dispatch schedule length (${dispatch.length}) does not match the interval count (${originals.length})`);
  }
  const pf = options.powerFactor;

  return originals.map((original, index) => {
    const scheduled = dispatch[index];
    const loadKw = original.loadKw;
    const solarKw = original.solarKw;
    const gridAvailable = original.gridAvailable;

    const solarGenerationServingLoadKw = Math.min(Math.max(solarKw, 0), Math.max(loadKw, 0));
    const preBessGridImportKw = Math.max(loadKw - solarGenerationServingLoadKw, 0);

    const batteryDischargeKw = Math.max(0, scheduled.dischargeKw);
    const batteryChargeKw = Math.max(0, scheduled.chargeKw);

    // Charge is attributed to surplus solar first, exactly as the rule-based engine does.
    // Anything beyond the surplus available this interval must have come from the grid.
    const surplusSolarKw = Math.max(0, solarKw - loadKw);
    const solarSourcedChargeKw = Math.min(batteryChargeKw, surplusSolarKw);
    const gridBatteryChargeKw = batteryChargeKw - solarSourcedChargeKw;

    const postBessGridImportKw = Math.max(
      loadKw - solarGenerationServingLoadKw - batteryDischargeKw + gridBatteryChargeKw,
      0
    );
    const postBessLoadKw = Math.max(0, loadKw - batteryDischargeKw);
    const postBessLoadKva = pf ? postBessGridImportKw / pf : 0;

    const postBessDgKw = gridAvailable ? 0 : Math.max(0, loadKw - batteryDischargeKw);

    const solarAbsorbedKw = solarGenerationServingLoadKw + solarSourcedChargeKw;
    const solarCurtailedKw = solarKw > solarAbsorbedKw ? solarKw - solarAbsorbedKw : 0;

    const gridImportKw = gridAvailable ? postBessGridImportKw : 0;
    const gridExportKw = gridAvailable ? Math.max(0, solarKw - solarAbsorbedKw - postBessGridImportKw) : 0;

    const bessPowerKw = batteryDischargeKw > 0 ? batteryDischargeKw : -batteryChargeKw;

    return {
      ...original,
      bessPowerKw,
      bessSocPct: options.ratedEnergyKwh > 0 ? (scheduled.socKwh / options.ratedEnergyKwh) * 100 : 0,
      bessEnergyKwh: scheduled.socKwh,
      postBessLoadKw,
      postBessLoadKva,
      postBessDgKw,
      gridImportKw,
      gridExportKw,
      solarCurtailedKw,
      bessAction: options.actionTags[index],
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
    };
  });
}
