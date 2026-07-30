import { OptimisationInterval, OptimisationBatteryConfig, OptimisationOptions } from './types';

export interface LpModelVariables {
  [name: string]: { [key: string]: number };
}

export interface LpModel {
  optimize: string;
  opType: 'min' | 'max';
  constraints: { [key: string]: { min?: number; max?: number; equal?: number } };
  variables: LpModelVariables;
  binaries?: { [name: string]: number };
}

export interface LpVariableNames {
  charge: string[];
  discharge: string[];
  isCharging: string[];
  soc: string[]; // soc AFTER interval i
  gridExport: string[];
  gridImport: string[];
}

/**
 * Builds the MILP model for grid-connected dispatch over `intervals`, per the
 * optimisation engine design (Layer 3: charge/discharge power, isCharging binary,
 * SOC, terminal-SOC discipline, degradation penalty, incremental demand-charge cost,
 * export credit). Outage intervals are excluded from decision variables entirely (they
 * are handled by the heuristic engine) but still consume an index in the returned
 * variable-name arrays for alignment with `intervals`.
 */
export function buildDispatchLpModel(
  intervals: OptimisationInterval[],
  battery: OptimisationBatteryConfig,
  options: OptimisationOptions
): { model: LpModel; varNames: LpVariableNames; optimisableIndices: number[] } {
  const etaCharge = battery.chargeEfficiencyPct / 100;
  const etaDischarge = battery.dischargeEfficiencyPct / 100;
  const minStoredKwh = Math.max(battery.minSocPct, battery.minSocPct + battery.reserveSocPct) / 100 * battery.ratedEnergyKwh;
  const maxStoredKwh = battery.maxSocPct / 100 * battery.ratedEnergyKwh;
  const initialStoredKwh = (battery.initialSocPct / 100) * battery.ratedEnergyKwh;

  const constraints: LpModel['constraints'] = {};
  const variables: LpModelVariables = {};
  const binaries: { [name: string]: number } = {};

  const varNames: LpVariableNames = { charge: [], discharge: [], isCharging: [], soc: [], gridExport: [], gridImport: [] };
  const optimisableIndices: number[] = [];

  const peakDemandVar = 'peakDemand';
  let peakDemandUsed = false;

  let prevSocVar: string | null = null;

  intervals.forEach((interval, i) => {
    if (interval.isOutage) {
      varNames.charge.push('');
      varNames.discharge.push('');
      varNames.isCharging.push('');
      varNames.soc.push('');
      varNames.gridExport.push('');
      varNames.gridImport.push('');
      return; // outage intervals are not decision variables in the LP
    }

    optimisableIndices.push(i);
    const dtHours = interval.durationHours;
    const chargeVar = `charge_${i}`;
    const dischargeVar = `discharge_${i}`;
    const isChargingVar = `isCharging_${i}`;
    const socVar = `soc_${i}`;
    const exportVar = `export_${i}`;

    varNames.charge[i] = chargeVar;
    varNames.discharge[i] = dischargeVar;
    varNames.isCharging[i] = isChargingVar;
    varNames.soc[i] = socVar;
    varNames.gridExport[i] = exportVar;

    binaries[isChargingVar] = 1;

    // charge_t <= Pmax * isCharging_t  ->  charge_t - Pmax*isCharging_t <= 0
    const chargeGateConstraint = `chargeGate_${i}`;
    constraints[chargeGateConstraint] = { max: 0 };
    // discharge_t <= Pmax * (1 - isCharging_t)  ->  discharge_t + Pmax*isCharging_t <= Pmax
    const dischargeGateConstraint = `dischargeGate_${i}`;
    constraints[dischargeGateConstraint] = { max: battery.ratedPowerKw };

    // Note: charge/discharge carry ONLY the degradation-penalty cost here. Their
    // effect on grid energy cost/export credit is captured entirely through the
    // energy-balance equality below, via gridImport_t's own cost coefficient and
    // export_t's own credit coefficient - putting an import-rate term directly on
    // charge/discharge as well would double-count it.
    variables[chargeVar] = {
      cost: battery.degradationCostPerKwh * dtHours,
      [chargeGateConstraint]: 1,
      [`chargeBound_${i}`]: 1,
      [socRecursionKey(i)]: -etaCharge * dtHours
    };
    variables[isChargingVar] = {
      cost: 0,
      [chargeGateConstraint]: -battery.ratedPowerKw,
      [dischargeGateConstraint]: battery.ratedPowerKw
    };
    variables[dischargeVar] = {
      cost: battery.degradationCostPerKwh * dtHours,
      [dischargeGateConstraint]: 1,
      [`dischargeBound_${i}`]: 1,
      [socRecursionKey(i)]: dtHours / etaDischarge
    };

    constraints[`chargeBound_${i}`] = { max: battery.ratedPowerKw };
    constraints[`dischargeBound_${i}`] = { max: battery.ratedPowerKw };

    // SOC recursion: soc_t = soc_(t-1) + charge_t*etaCharge*dt - discharge_t*dt/etaDischarge
    // Encoded as: soc_t - soc_(t-1) + discharge_t*dt/etaDischarge - charge_t*etaCharge*dt = 0
    // i.e. soc_t (coefficient 1) minus previous soc (coefficient 1) via the linking
    // constraint below, using the socRecursionKey column shared across this and the
    // previous interval's soc variable and this interval's charge/discharge terms.
    const socRecursionConstraint = socRecursionKey(i);
    constraints[socRecursionConstraint] = { equal: prevSocVar ? 0 : initialStoredKwh };
    variables[socVar] = {
      cost: 0,
      [socRecursionConstraint]: 1,
      [`socMin_${i}`]: 1,
      [`socMax_${i}`]: 1
    };
    if (prevSocVar) {
      variables[prevSocVar][socRecursionConstraint] = (variables[prevSocVar][socRecursionConstraint] ?? 0) - 1;
    }

    constraints[`socMin_${i}`] = { min: minStoredKwh };
    constraints[`socMax_${i}`] = { max: maxStoredKwh };

    // Export variable (only meaningful if export is allowed this interval).
    if (interval.exportAllowed) {
      variables[exportVar] = {
        cost: -(interval.exportCreditPerKwh ?? 0) * dtHours,
        [`exportBound_${i}`]: 1
      };
      constraints[`exportBound_${i}`] = { max: interval.exportLimitKw ?? battery.ratedPowerKw };
    }

    // gridImport_t is modelled as its OWN free (>= 0 by default) decision variable,
    // lower-bounded by the physical residual rather than tied to it by an equality -
    // an equality would force gridImport_t negative (infeasible, since it is a >= 0
    // variable) whenever netLoad_t - discharge_t + charge_t - export_t is negative
    // (a surplus larger than what discharge/charge/export account for), which is
    // exactly the case that must instead resolve to implicit, cost-free curtailment.
    //   gridImport_t >= netLoad_t - discharge_t + charge_t - export_t
    //   i.e. gridImport_t + discharge_t - charge_t - export_t >= netLoad_t
    // This is the standard MILP formulation for this kind of balance and is what
    // correctly caps discharge's usefulness: the objective only ever credits
    // discharge/charge indirectly, through their effect on gridImport_t (which has a
    // real cost) and export_t (which has a real credit) - so there is no "phantom
    // discharge" reward independent of an actual outlet, and no risk of
    // over-constraining a genuine surplus interval into infeasibility.
    const gridImportVar = `gridImport_${i}`;
    varNames.gridImport[i] = gridImportVar;
    const balanceConstraint = `balance_${i}`;
    constraints[balanceConstraint] = { min: interval.netLoadKw };
    variables[gridImportVar] = {
      cost: interval.importRatePerKwh * dtHours,
      [balanceConstraint]: 1
    };
    variables[dischargeVar][balanceConstraint] = 1;
    variables[chargeVar][balanceConstraint] = -1;
    if (interval.exportAllowed) {
      variables[exportVar][balanceConstraint] = -1;
    }

    // Incremental demand charge: peakDemand >= gridImport_t for every interval.
    if (options.demandCharge) {
      peakDemandUsed = true;
      const peakConstraint = `peakDemand_${i}`;
      // gridImport_t <= peakDemand -> gridImport_t - peakDemand <= 0
      constraints[peakConstraint] = { max: 0 };
      variables[gridImportVar][peakConstraint] = 1;
      variables[peakDemandVar] = variables[peakDemandVar] ?? { cost: 0 };
      variables[peakDemandVar][peakConstraint] = -1;
    }

    prevSocVar = socVar;
  });

  // Terminal SOC discipline.
  if (prevSocVar) {
    if (options.terminalSocRule === 'equal_to_initial') {
      constraints['terminalSoc'] = { min: initialStoredKwh };
      variables[prevSocVar]['terminalSoc'] = 1;
    } else if (options.terminalSocRule === 'minimum_terminal_reserve') {
      const reserveKwh = ((options.minimumTerminalReserveSocPct ?? battery.minSocPct) / 100) * battery.ratedEnergyKwh;
      constraints['terminalSoc'] = { min: reserveKwh };
      variables[prevSocVar]['terminalSoc'] = 1;
    }
    // 'unconstrained': no additional constraint.
  }

  if (peakDemandUsed && options.demandCharge) {
    variables[peakDemandVar] = variables[peakDemandVar] ?? { cost: 0 };
    variables[peakDemandVar].cost = options.demandCharge.ratePerKw;
    constraints['peakDemandFloor'] = { min: options.demandCharge.existingMonthToDatePeakKw };
    variables[peakDemandVar]['peakDemandFloor'] = 1;
  }

  const model: LpModel = {
    optimize: 'cost',
    opType: 'min',
    constraints,
    variables,
    binaries
  };

  return { model, varNames, optimisableIndices };
}

function socRecursionKey(i: number): string {
  return `socLink_${i}`;
}
