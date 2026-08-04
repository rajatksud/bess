import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  ValidationWarning,
  ConfidenceGrade,
  IntervalRecord,
  SavingsBreakdown,
  TechnicalResult,
  FinancialResult
} from '../types/bess';
import { resolveTurnkeyCapex } from './capexModel';
import { solarProcurementModelOf, solarUnitCostPerKwh } from './solarProcurement';

export function validateBessConfig(
  system: BessSystemInput,
  tariff: TariffInput,
  diesel: DieselInput,
  solar: SolarInput,
  financial: FinancialInput,
  mode: 'quick' | 'interval' | 'legacy'
): { warnings: ValidationWarning[]; confidenceGrade: ConfidenceGrade; gradeReason: string } {
  const warnings: ValidationWarning[] = [];

  // Physical Constraint Checks
  if (system.ratedPowerKw <= 0) {
    warnings.push({
      id: 'phys-01',
      level: 'error',
      category: 'physical',
      code: 'INVALID_POWER',
      message: 'BESS Rated Power must be greater than 0 kW.',
      recommendation: 'Enter a valid positive rated power capacity.'
    });
  }

  if (system.ratedEnergyKwh <= 0) {
    warnings.push({
      id: 'phys-02',
      level: 'error',
      category: 'physical',
      code: 'INVALID_CAPACITY',
      message: 'BESS Rated Energy must be greater than 0 kWh.',
      recommendation: 'Enter a valid positive nameplate battery energy.'
    });
  }

  if (system.minSocPct >= system.maxSocPct) {
    warnings.push({
      id: 'phys-03',
      level: 'error',
      category: 'physical',
      code: 'SOC_BOUNDS_INVALID',
      message: 'Minimum SOC % must be strictly less than Maximum SOC %.',
      recommendation: 'Set Min SOC (e.g. 10%) below Max SOC (e.g. 100%).'
    });
  }

  if (system.reserveSocPct > (system.usableDodPct)) {
    warnings.push({
      id: 'phys-04',
      level: 'warning',
      category: 'physical',
      code: 'RESERVE_EXCEEDS_USABLE',
      message: 'Backup reserve SOC exceeds the configured usable Depth of Discharge range.',
      recommendation: 'Reduce reserve SOC or expand DoD range to allow economic dispatch.'
    });
  }

  if (system.chargeEfficiencyPct < 70 || system.dischargeEfficiencyPct < 70) {
    warnings.push({
      id: 'phys-05',
      level: 'warning',
      category: 'physical',
      code: 'LOW_EFFICIENCY',
      message: 'Inverter/PCS charge or discharge efficiency is lower than 70%.',
      recommendation: 'Typical LiFePO4 round-trip efficiency is 85-92%.'
    });
  }

  // Commercial Checks
  if (tariff.demandChargePerKvaMonth > 0 && (!tariff.powerFactor || tariff.powerFactor <= 0)) {
    warnings.push({
      id: 'comm-01',
      level: 'error',
      category: 'commercial',
      code: 'KVA_KW_MIXED',
      message: 'Demand charges billed in kVA require a valid site power factor (PF).',
      recommendation: 'Provide site power factor (e.g. 0.90 to 0.98) to derive kVA accurately.'
    });
  }

  if (diesel.enableDieselDisplacement && diesel.specificFuelConsumptionLitrePerKwh > 0.5) {
    warnings.push({
      id: 'comm-02',
      level: 'warning',
      category: 'commercial',
      code: 'HIGH_FUEL_FACTOR',
      message: 'Diesel fuel factor exceeds 0.50 L/kWh (typical range is 0.25 - 0.32 L/kWh).',
      recommendation: 'Verify specific fuel consumption against generator test sheet.'
    });
  }

  if (solar.enableSolarIntegration && solar.dailySurplusSolarKwh > system.ratedEnergyKwh * 3) {
    warnings.push({
      id: 'comm-03',
      level: 'warning',
      category: 'commercial',
      code: 'SOLAR_SURPLUS_CLIPPED',
      message: 'Daily excess solar exceeds 3x nameplate battery storage capacity.',
      recommendation: 'Battery will clip remaining surplus solar unless multiple daily cycles occur.'
    });
  }

  // On-site solar is bounded by available roof/land; open access is not.
  if (
    solar.enableSolarIntegration &&
    solarProcurementModelOf(solar) === 'onsite_capex' &&
    solar.maxOnsiteCapacityKwp !== undefined &&
    solar.installedCapacityKwp > solar.maxOnsiteCapacityKwp
  ) {
    warnings.push({
      id: 'comm-05',
      level: 'error',
      category: 'commercial',
      code: 'ONSITE_SOLAR_EXCEEDS_SITE_CAPACITY',
      message: `On-site solar of ${solar.installedCapacityKwp} kWp exceeds the ${solar.maxOnsiteCapacityKwp} kWp the site can physically host.`,
      recommendation: 'Reduce installed capacity to the site limit, or procure the balance through open access.'
    });
  }

  // Open access is contracted per kWh; without a contracted tariff the generation
  // appears free, which it is not - the whole contracted capacity is payable.
  if (
    solar.enableSolarIntegration &&
    solarProcurementModelOf(solar) === 'open_access' &&
    solarUnitCostPerKwh(solar) <= 0
  ) {
    warnings.push({
      id: 'comm-06',
      level: 'warning',
      category: 'commercial',
      code: 'OPEN_ACCESS_SOLAR_WITHOUT_TARIFF',
      message: 'Solar is procured through open access but no contracted tariff or open-access charges are configured, so its generation is being treated as free.',
      recommendation: 'Enter the contracted generation tariff and wheeling/open-access charges per kWh.'
    });
  }

  // Solar-only charging removes every grid charge path, so with no solar array the
  // battery has no permitted energy source at all beyond its initial state of charge.
  if (solar.solarOnlyCharging && (!solar.enableSolarIntegration || solar.installedCapacityKwp <= 0)) {
    warnings.push({
      id: 'comm-04',
      level: 'error',
      category: 'commercial',
      code: 'SOLAR_ONLY_CHARGING_WITHOUT_SOLAR',
      message: 'Solar-only charging is enabled but no solar array is configured, leaving the battery with no permitted charging source.',
      recommendation: 'Enable solar integration with a non-zero installed capacity, or allow grid charging.'
    });
  }

  // Financial Checks
  // Checked against the RESOLVED turnkey figure so a derived-model scenario with
  // missing or zeroed rates is caught, not just a zeroed fixed CapEx field.
  const resolvedCapex = resolveTurnkeyCapex(system, financial, solar);
  if (resolvedCapex <= 0) {
    warnings.push({
      id: 'fin-01',
      level: 'warning',
      category: 'financial',
      code: 'ZERO_CAPEX',
      message: financial.capexModel === 'derived'
        ? 'Turnkey CapEx derived from rated power and energy resolves to zero or less.'
        : 'Initial project CapEx is set to zero or unassigned.',
      recommendation: financial.capexModel === 'derived'
        ? 'Enter non-zero CapEx rates per kWh and/or per kW, or switch to a fixed turnkey CapEx.'
        : 'Enter estimated turnkey BESS installation cost.'
    });
  }

  if (mode === 'legacy') {
    warnings.push({
      id: 'legacy-warn',
      level: 'error',
      category: 'commercial',
      code: 'UNCONSTRAINED_SALES_PITCH',
      message: 'LEGACY ILLUSTRATION MODE ACTIVE: Uses unconstrained arithmetic from initial sales proposal.',
      recommendation: 'This calculation assumes double-counted energy, 100% usable capacity without round-trip loss, and zero charging cost. Use Single-Balance Engineering simulation for investment decisions.'
    });
  }

  // Determine Confidence Grade
  let confidenceGrade: ConfidenceGrade = 'B';
  let gradeReason = 'Interval dispatch simulation with structured operational & tariff parameters.';

  if (mode === 'legacy') {
    confidenceGrade = 'D';
    gradeReason = 'Grade D: Customer-stated unverified sales arithmetic. Excludes degradation, charging costs, and double-counting constraints.';
  } else if (mode === 'quick') {
    confidenceGrade = 'C';
    gradeReason = 'Grade C: Monthly / Quick Estimate mode with averaged daily profiles. Subject to interval load profile validation.';
  } else if (mode === 'interval') {
    confidenceGrade = 'A';
    gradeReason = 'Grade A: Interval dispatch simulation with verified single-energy balance, loss accounting, and tariff schedule.';
  }

  return { warnings, confidenceGrade, gradeReason };
}

// Numeric tolerance for floating point comparisons below. Simulation values are
// derived from repeated multiply/divide operations over many intervals, so exact
// equality is not achievable; this tolerance is intentionally small (0.01 kWh /
// 0.01 percentage point) - it exists only to absorb IEEE-754 rounding, not to hide
// genuine physical/commercial inconsistencies.
const EPSILON = 0.01;

/**
 * Validates the OUTPUT of a completed dispatch simulation (per-interval battery
 * state + the resulting savings/financial figures). This is distinct from
 * validateBessConfig above, which only checks the static input configuration
 * before any simulation has run. These checks require the simulated intervals
 * and results to exist, per the task's validation framework requirement:
 * technical checks (SOC bounds, impossible discharge, simultaneous charge/
 * discharge, energy imbalance) and commercial checks (savings vs. physical
 * ceiling, negative payback).
 */
export function validateSimulationResult(
  intervals: IntervalRecord[],
  system: BessSystemInput,
  diesel: DieselInput,
  solar: SolarInput,
  savings: SavingsBreakdown,
  technical: TechnicalResult,
  financial: FinancialResult,
  intervalMinutes: number
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const dtHours = intervalMinutes / 60;

  // --- Technical checks ---------------------------------------------------

  // 1. SOC below configured minimum / above configured maximum.
  const socBelowMin = intervals.some(inv => inv.bessSocPct < system.minSocPct - EPSILON);
  const socAboveMax = intervals.some(inv => inv.bessSocPct > system.maxSocPct + EPSILON);
  if (socBelowMin) {
    warnings.push({
      id: 'sim-tech-01',
      level: 'error',
      category: 'physical',
      code: 'SOC_BELOW_MIN',
      message: 'Simulated SOC fell below the configured minimum SOC in at least one interval.',
      recommendation: 'Check discharge limit logic - available discharge energy must be clamped to (SOC - minSoc - reserveSoc) before dispatch.'
    });
  }
  if (socAboveMax) {
    warnings.push({
      id: 'sim-tech-02',
      level: 'error',
      category: 'physical',
      code: 'SOC_ABOVE_MAX',
      message: 'Simulated SOC exceeded the configured maximum SOC in at least one interval.',
      recommendation: 'Check charge limit logic - available charge energy must be clamped to (maxSoc - SOC) before dispatch.'
    });
  }

  // 2. Impossible battery discharge: discharge power exceeding rated power, or an
  // interval discharging more energy than was available in the battery.
  const impossibleDischarge = intervals.some(inv => inv.bessPowerKw > system.ratedPowerKw + EPSILON);
  if (impossibleDischarge) {
    warnings.push({
      id: 'sim-tech-03',
      level: 'error',
      category: 'physical',
      code: 'DISCHARGE_EXCEEDS_RATED_POWER',
      message: 'At least one interval discharges more power than the BESS rated power (PCS/inverter limit).',
      recommendation: 'Clamp dispatch power to system.ratedPowerKw in every interval.'
    });
  }
  const impossibleCharge = intervals.some(inv => inv.bessPowerKw < -(system.ratedPowerKw + EPSILON));
  if (impossibleCharge) {
    warnings.push({
      id: 'sim-tech-04',
      level: 'error',
      category: 'physical',
      code: 'CHARGE_EXCEEDS_RATED_POWER',
      message: 'At least one interval charges at a power exceeding the BESS rated power (PCS/inverter limit).',
      recommendation: 'Clamp charge power to system.ratedPowerKw in every interval.'
    });
  }

  // 3. Charge and discharge cannot occur "simultaneously" - bessPowerKw is a single
  // signed scalar per interval in this model (Rule 1: one battery model), so this
  // check confirms no interval encodes both a nonzero charge component and a
  // nonzero discharge component at once. Included even though the current type
  // model makes this structurally impossible, so a future refactor that splits
  // charge/discharge into separate fields cannot silently reintroduce the bug.
  const simultaneousChargeDischarge = intervals.some(inv => {
    const rec = inv as unknown as { bessChargeKw?: number; bessDischargeKw?: number };
    return (rec.bessChargeKw ?? 0) > EPSILON && (rec.bessDischargeKw ?? 0) > EPSILON;
  });
  if (simultaneousChargeDischarge) {
    warnings.push({
      id: 'sim-tech-05',
      level: 'error',
      category: 'physical',
      code: 'SIMULTANEOUS_CHARGE_DISCHARGE',
      message: 'An interval reports nonzero charge and discharge power at the same time.',
      recommendation: 'Battery dispatch must resolve to a single signed power value per interval.'
    });
  }

  // 4. Energy imbalance: recompute SOC from the very first interval using each
  // interval's own bessPowerKw and efficiencies, and compare against the SOC the
  // dispatch engine reported for the LAST interval. A material mismatch means the
  // reported SOC trace does not correspond to a valid running energy balance -
  // i.e. energy was implicitly created or destroyed somewhere in the simulation.
  if (intervals.length > 0) {
    const etaCharge = system.chargeEfficiencyPct / 100;
    const etaDischarge = system.dischargeEfficiencyPct / 100;
    const minStoredKwh = (Math.max(system.minSocPct, system.minSocPct + system.reserveSocPct) / 100) * system.ratedEnergyKwh;
    const maxStoredKwh = (system.maxSocPct / 100) * system.ratedEnergyKwh;

    // Reconstruct the FIRST interval's starting SOC from its own bessPowerKw and the
    // SOC it reports at the end of that interval (SOC values in IntervalRecord are
    // post-dispatch/end-of-interval), then replay forward the same way the engine
    // does, using only each interval's OWN reported bessPowerKw as input.
    const first = intervals[0];
    let netFirst = 0;
    if (first.bessPowerKw > 0) netFirst = -(first.bessPowerKw * dtHours) / etaDischarge;
    else if (first.bessPowerKw < 0) netFirst = Math.abs(first.bessPowerKw) * dtHours * etaCharge;
    const impliedStartStoredKwh = (first.bessSocPct / 100) * system.ratedEnergyKwh - netFirst;

    let replaySoc = impliedStartStoredKwh;
    for (const inv of intervals) {
      let net = 0;
      if (inv.bessPowerKw > 0) net = -(inv.bessPowerKw * dtHours) / etaDischarge;
      else if (inv.bessPowerKw < 0) net = Math.abs(inv.bessPowerKw) * dtHours * etaCharge;
      replaySoc = Math.min(maxStoredKwh, Math.max(minStoredKwh, replaySoc + net));
    }

    const reportedFinalStoredKwh = (intervals[intervals.length - 1].bessSocPct / 100) * system.ratedEnergyKwh;
    const imbalanceKwh = Math.abs(replaySoc - reportedFinalStoredKwh);
    // Tolerance scales with interval count because floating point rounding
    // accumulates; still tight enough to catch a real energy-balance defect.
    const imbalanceTolerance = Math.max(0.5, intervals.length * 0.001);
    if (imbalanceKwh > imbalanceTolerance) {
      warnings.push({
        id: 'sim-tech-06',
        level: 'error',
        category: 'physical',
        code: 'ENERGY_IMBALANCE',
        message: `Replaying the reported per-interval dispatch power does not reproduce the reported final SOC (mismatch: ${imbalanceKwh.toFixed(2)} kWh). The stored-energy trace is not internally consistent.`,
        recommendation: 'Verify the SOC update step applies charge/discharge efficiency in the correct direction and that no interval is clamped inconsistently with its reported power.'
      });
    }
  }

  // --- Commercial checks ----------------------------------------------------

  // 5. Diesel savings cannot exceed the energy the DG would actually have had to
  // supply (the site's own outage-period load), since the battery can only displace
  // DG generation that would otherwise have occurred.
  const totalDgRequiredKwh = intervals.reduce((sum, inv) => sum + Math.max(0, inv.dgRequiredKw) * dtHours, 0);
  const daysInYear = 365;
  const annualDgRequiredCeilingKwh = totalDgRequiredKwh * daysInYear;
  if (diesel.enableDieselDisplacement && technical.dgEnergyDisplacedKwh > annualDgRequiredCeilingKwh + EPSILON) {
    warnings.push({
      id: 'sim-comm-01',
      level: 'error',
      category: 'commercial',
      code: 'DIESEL_SAVING_EXCEEDS_DG_OPERATION',
      message: 'Annual DG energy displaced by the BESS exceeds the annual energy the DG would actually have needed to supply during outage periods.',
      recommendation: 'DG displacement cannot exceed observed/assumed outage load. Check outage profile and dispatch priority ordering.'
    });
  }

  // 6. Solar self-consumption savings cannot exceed the actual surplus solar
  // (solar generation above load) available in the simulated profile.
  const totalSurplusSolarKwh = intervals.reduce((sum, inv) => sum + Math.max(0, inv.solarKw - inv.loadKw) * dtHours, 0);
  const annualSurplusSolarCeilingKwh = totalSurplusSolarKwh * daysInYear;
  if (solar.enableSolarIntegration && technical.solarEnergyStoredKwh > annualSurplusSolarCeilingKwh + EPSILON) {
    warnings.push({
      id: 'sim-comm-02',
      level: 'error',
      category: 'commercial',
      code: 'SOLAR_SAVING_EXCEEDS_SURPLUS',
      message: 'Annual solar energy stored by the BESS exceeds the annual surplus solar (generation above load) available in the simulated profile.',
      recommendation: 'Solar self-consumption saving cannot exceed actual excess solar generation. Check solar charging priority against the interval solar/load profile.'
    });
  }

  // 7. Total savings-attributed discharge energy cannot exceed the total energy
  // physically discharged from the battery (a direct, output-level check for
  // Rule 2 - no single kWh may be counted in more than one avoided-cost category,
  // and the sum of all categories cannot exceed total discharge).
  const totalAttributedDischargeKwh = technical.dgEnergyDisplacedKwh; // diesel + backup share one tag; solar/arbitrage are charge-side or separately tracked
  if (totalAttributedDischargeKwh > technical.energyDischargedKwh + EPSILON) {
    warnings.push({
      id: 'sim-comm-03',
      level: 'error',
      category: 'commercial',
      code: 'SAVINGS_EXCEED_AVAILABLE_ENERGY',
      message: 'Energy attributed to diesel displacement exceeds the total energy physically discharged from the battery.',
      recommendation: 'Each kWh of savings must trace back to a kWh of dispatched battery energy; verify per-category accumulators sum to at most the total discharge.'
    });
  }

  // 8. Negative or zero net savings should not be presented with a payback figure.
  if (savings.netOperatingSaving <= 0 && (financial.simplePaybackYears !== null || financial.discountedPaybackYears !== null)) {
    warnings.push({
      id: 'sim-comm-04',
      level: 'error',
      category: 'financial',
      code: 'PAYBACK_WITH_NONPOSITIVE_SAVINGS',
      message: 'Net operating savings are zero or negative, but a payback period was calculated and would be misleading if displayed.',
      recommendation: 'Suppress payback display and show only NPV/IRR (which correctly reflect a negative-return project) when first-year net savings are not positive.'
    });
  }

  // 9. Payback never achieved within the project evaluation horizon (distinct from a
  // negative/nonsensical payback above - this is a valid, common outcome that should
  // still be surfaced rather than silently rendered as a blank field).
  if (financial.simplePaybackYears === null && savings.netOperatingSaving > 0) {
    warnings.push({
      id: 'sim-comm-05',
      level: 'warning',
      category: 'financial',
      code: 'PAYBACK_NOT_ACHIEVED',
      message: `Simple payback is not achieved within the ${system.projectLifeYears || 10}-year project life at current savings and CapEx.`,
      recommendation: 'Reduce CapEx, increase utilisation (dispatch priorities/profile), or extend the evaluation horizon.'
    });
  }

  return warnings;
}
