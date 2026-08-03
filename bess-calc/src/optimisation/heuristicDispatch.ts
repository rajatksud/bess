import { OptimisationInterval, OptimisationBatteryConfig, DispatchInterval } from './types';

/**
 * Simple greedy peak-shaving heuristic used as the default dispatch mode and as the
 * fallback whenever the LP/MILP solver fails or times out. Discharges to shave import
 * above the battery's available power whenever net load is positive, charges from
 * available headroom during outage-free intervals with low relative import rate.
 * This is deliberately simple/transparent (Layer 1 rule-based dispatch per the
 * optimisation engine design) - it is NOT the same algorithm as dispatchEngine.ts's
 * priority-list simulation, since this module operates on the narrower
 * OptimisationInterval boundary independent of solar/DG/TOU-period-tag internals.
 */
export function runHeuristicDispatch(
  intervals: OptimisationInterval[],
  battery: OptimisationBatteryConfig
): DispatchInterval[] {
  const etaCharge = battery.chargeEfficiencyPct / 100;
  const etaDischarge = battery.dischargeEfficiencyPct / 100;
  const minStoredKwh = Math.max(battery.minSocPct, battery.minSocPct + battery.reserveSocPct) / 100 * battery.ratedEnergyKwh;
  const maxStoredKwh = battery.maxSocPct / 100 * battery.ratedEnergyKwh;
  let storedKwh = (battery.initialSocPct / 100) * battery.ratedEnergyKwh;

  const avgRate = intervals.reduce((s, i) => s + i.importRatePerKwh, 0) / Math.max(1, intervals.length);

  return intervals.map(interval => {
    const dtHours = interval.durationHours;
    let chargeKw = 0;
    let dischargeKw = 0;

    if (interval.isOutage) {
      // Outage intervals are not optimised here - discharge to cover load as far as possible.
      const availableDischargeKwh = Math.max(0, storedKwh - minStoredKwh);
      dischargeKw = Math.min(battery.ratedPowerKw, availableDischargeKwh / dtHours, Math.max(0, interval.netLoadKw));
    } else if (interval.netLoadKw > 0) {
      // Discharge to shave import.
      const availableDischargeKwh = Math.max(0, storedKwh - minStoredKwh);
      const maxDischargeKw = Math.min(battery.ratedPowerKw, availableDischargeKwh / dtHours);
      dischargeKw = Math.min(maxDischargeKw, interval.netLoadKw);
    } else if (interval.importRatePerKwh <= avgRate) {
      // Cheap-rate interval with no positive net load: opportunistically charge.
      const availableChargeKwh = Math.max(0, maxStoredKwh - storedKwh);
      chargeKw = Math.min(battery.ratedPowerKw, availableChargeKwh / dtHours);
    }

    let netEnergyKwhChange = 0;
    if (dischargeKw > 0) netEnergyKwhChange = -(dischargeKw * dtHours) / etaDischarge;
    else if (chargeKw > 0) netEnergyKwhChange = chargeKw * dtHours * etaCharge;

    storedKwh = Math.min(maxStoredKwh, Math.max(minStoredKwh, storedKwh + netEnergyKwhChange));

    const gridImportKw = Math.max(0, interval.netLoadKw - dischargeKw + chargeKw);
    const rawExportKw = Math.max(0, dischargeKw + interval.netLoadKw < 0 ? -(interval.netLoadKw) : 0);
    const gridExportKw = interval.exportAllowed ? Math.min(rawExportKw, interval.exportLimitKw ?? Infinity) : 0;

    return {
      timestamp: interval.timestamp,
      chargeKw,
      dischargeKw,
      gridImportKw,
      gridExportKw,
      socKwh: storedKwh,
      socPct: (storedKwh / battery.ratedEnergyKwh) * 100,
      mode: 'heuristic'
    };
  });
}
