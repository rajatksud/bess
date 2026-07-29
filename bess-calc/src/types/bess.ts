export type CurrencySymbol = '₹' | '$' | '€' | '£';

export type BatteryChemistry = 'LFP' | 'NMC' | 'SODIUM_ION' | 'OTHER';

export type ConfidenceGrade = 'A' | 'B' | 'C' | 'D';

export type DispatchPriorityType = 
  | 'backup_reserve'
  | 'peak_shaving'
  | 'diesel_displacement'
  | 'solar_self_consumption'
  | 'tou_arbitrage';

export interface TouPeriod {
  id: string;
  name: string;
  startTime: string; // "08:00"
  endTime: string;   // "12:00"
  importRatePerKwh: number;
  exportRatePerKwh?: number;
}

export interface BessSystemInput {
  ratedPowerKw: number;
  ratedEnergyKwh: number;
  batteryChemistry: BatteryChemistry;
  usableDodPct: number;       // e.g., 90
  minSocPct: number;          // e.g., 10
  maxSocPct: number;          // e.g., 100
  initialSocPct: number;      // e.g., 80
  reserveSocPct: number;      // e.g., 20
  chargeEfficiencyPct: number;   // e.g., 95
  dischargeEfficiencyPct: number;// e.g., 95
  availabilityPct: number;    // e.g., 98
  auxiliaryLoadKw: number;    // e.g., 2 kW continuous HVAC/BMS
  annualDegradationPct: number; // e.g., 2.0 % per year
  projectLifeYears: number;   // e.g., 10
  cycleLife: number;          // e.g., 6000
}

export interface TariffInput {
  currency: CurrencySymbol;
  energyChargePerKwh: number;       // e.g., 9.5
  demandChargePerKvaMonth: number;  // e.g., 450
  contractDemandKva: number;        // e.g., 300
  billingDemandWindowMinutes: number;// 15 or 30
  powerFactor: number;              // e.g., 0.90 or 0.95
  exportCreditPerKwh: number;       // e.g., 3.5
  minimumBillingDemandPct: number;  // e.g., 75 (% of contract demand)
  demandRatchetPct: number;         // e.g., 80
  enableTou: boolean;
  touPeriods: TouPeriod[];
}

export interface DieselInput {
  enableDieselDisplacement: boolean;
  dgCapacityKva: number;              // e.g., 250
  dieselPricePerLitre: number;        // e.g., 92
  specificFuelConsumptionLitrePerKwh: number; // e.g., 0.28
  fixedFuelLitresPerHour: number;     // e.g., 5.0
  variableFuelLitresPerKwh: number;   // e.g., 0.24
  maintenanceCostPerRunHour: number;  // e.g., 150
  outageHoursPerMonth: number;        // e.g., 180 (6 hrs/day)
  avgOutageLoadKw: number;            // e.g., 120
}

export interface SolarInput {
  enableSolarIntegration: boolean;
  installedCapacityKwp: number;       // e.g., 150
  dailySurplusSolarKwh: number;       // e.g., 240
  exportAllowed: boolean;
  exportCreditPerKwh: number;         // e.g., 3.0
  curtailmentEnabled: boolean;
}

export interface FinancialInput {
  initialCapex: number;               // e.g., 4,000,000 (INR) or 48,000 (USD)
  fixedAnnualOm: number;              // e.g., 200,000
  variableOmPerKwhThroughput: number; // e.g., 0.15
  annualOmEscalationPct: number;      // e.g., 5.0
  tariffEscalationPct: number;        // e.g., 4.0
  dieselEscalationPct: number;        // e.g., 5.0
  discountRatePct: number;            // e.g., 12.0
  taxRatePct: number;                 // e.g., 25.0
  residualValuePct: number;           // e.g., 10.0 (% of initial Capex)
  replacementYear?: number;           // e.g., 8
  replacementCapexAmount?: number;    // e.g., 1,200,000
}

export interface IntervalRecord {
  intervalIndex: number;
  timeLabel: string; // "00:00", "00:15", etc.
  loadKw: number;
  loadKva: number;
  solarKw: number;
  gridAvailable: boolean;
  dgRequiredKw: number;
  tariffImportRate: number;
  tariffPeriod?: string;
  
  // Post-BESS values
  bessPowerKw: number; // positive = discharge, negative = charge
  bessSocPct: number;
  bessEnergyKwh: number;
  postBessLoadKw: number;
  postBessLoadKva: number;
  postBessDgKw: number;
  gridImportKw: number;
  gridExportKw: number;
  solarCurtailedKw: number;
  bessAction: string; // "Peak Shaving", "Solar Charge", "Diesel Displacement", "TOU Discharge", "Idle"
}

export interface SavingsBreakdown {
  demandChargeSaving: number;
  dieselFuelSaving: number;
  dgMaintenanceSaving: number;
  solarSelfConsumptionSaving: number;
  energyArbitrageSaving: number;
  exportRevenueChange: number;
  
  // Cost deductions
  chargingEnergyCost: number;
  auxiliaryEnergyCost: number;
  degradationCost: number;
  omCost: number;
  
  grossSaving: number;
  netOperatingSaving: number;
}

export interface TechnicalResult {
  peakBeforeKw: number;
  peakAfterKw: number;
  peakBeforeKva: number;
  peakAfterKva: number;
  energyChargedKwh: number;
  energyDischargedKwh: number;
  solarEnergyStoredKwh: number;
  dgEnergyDisplacedKwh: number;
  equivalentFullCycles: number;
  minimumSocPct: number;
  maximumSocPct: number;
  unservedBackupEnergyKwh: number;
  curtailedSolarKwh: number;
  deliverableCapacityKwh: number;
}

export interface AnnualCashFlow {
  year: number;
  effectiveCapacityPct: number;
  grossSaving: number;
  omCost: number;
  replacementCapex: number;
  taxableIncome: number;
  taxAmount: number;
  netCashFlow: number;
  discountedCashFlow: number;
  cumulativeCashFlow: number;
  cumulativeDiscountedCashFlow: number;
}

export interface FinancialResult {
  initialInvestment: number;
  firstYearGrossSaving: number;
  firstYearNetSaving: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  npv: number;
  irrPct: number | null;
  tenYearCumulativeCashFlow: number;
  lcoePerKwh: number; // Levelized Cost of Storage
  annualCashFlows: AnnualCashFlow[];
}

export interface ValidationWarning {
  id: string;
  level: 'error' | 'warning' | 'info';
  category: 'physical' | 'commercial' | 'financial';
  code: string;
  message: string;
  recommendation: string;
}

export interface SimulationResult {
  mode: 'quick' | 'interval' | 'legacy';
  confidenceGrade: ConfidenceGrade;
  confidenceGradeReason: string;
  system: BessSystemInput;
  tariff: TariffInput;
  diesel: DieselInput;
  solar: SolarInput;
  financialInput: FinancialInput;
  dispatchPriorities: DispatchPriorityType[];
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  financial: FinancialResult;
  warnings: ValidationWarning[];
  intervals: IntervalRecord[];
  
  // Comparison against legacy sales pitch if calculated
  legacyComparison?: {
    salesPitchAnnualSavings: number;
    salesPitchPaybackYears: number;
    defensibleAnnualSavings: number;
    defensiblePaybackYears: number;
    doubleCountedAmount: number;
    overestimationPct: number;
  };
}
