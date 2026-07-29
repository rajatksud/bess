import { 
  BessSystemInput, 
  TariffInput, 
  DieselInput, 
  SolarInput, 
  FinancialInput, 
  ValidationWarning, 
  ConfidenceGrade 
} from '../types/bess';

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

  // Financial Checks
  if (financial.initialCapex <= 0) {
    warnings.push({
      id: 'fin-01',
      level: 'warning',
      category: 'financial',
      code: 'ZERO_CAPEX',
      message: 'Initial project CapEx is set to zero or unassigned.',
      recommendation: 'Enter estimated turnkey BESS installation cost.'
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
