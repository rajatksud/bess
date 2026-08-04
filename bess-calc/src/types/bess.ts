export type CurrencySymbol = '₹' | '$' | '€' | '£';

export type BatteryChemistry = 'LFP' | 'NMC' | 'SODIUM_ION' | 'OTHER';

export type ConfidenceGrade = 'A' | 'B' | 'C' | 'D';

export type DispatchPriorityType = 
  | 'backup_reserve'
  | 'peak_shaving'
  | 'diesel_displacement'
  | 'solar_self_consumption'
  | 'tou_arbitrage';

/**
 * Dispatch-relevant classification of a TOU period. 'peak' is a discharge opportunity,
 * 'off_peak' a grid-charging opportunity, 'standard' neither. See
 * `engine/touPeriods.ts` - when a period does not declare a kind it is classified by
 * its rate relative to `TariffInput.energyChargePerKwh`.
 */
export type TouPeriodKind = 'peak' | 'standard' | 'off_peak';

export interface TouPeriod {
  id: string;
  name: string;
  /** "HH:MM". A period may wrap past midnight (e.g. 22:00 -> 06:00). */
  startTime: string; // "08:00"
  endTime: string;   // "12:00"
  importRatePerKwh: number;
  exportRatePerKwh?: number;
  /**
   * Optional explicit classification. When absent the period is classified from its
   * rate against the base energy charge, so a surcharge or rebate of any size is
   * actionable. Set this to force a classification the rate alone would not imply.
   */
  kind?: TouPeriodKind;
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

/**
 * How the solar capacity is procured. Either way the site pays for the ENTIRE
 * capacity, not just the energy it manages to consume - which is what makes curtailed
 * generation a real financial loss rather than a merely technical one.
 *
 *   'onsite_capex'  — invested on site. Capacity is limited by available roof/land
 *                     (`maxOnsiteCapacityKwp`) and paid for once, up front, as CapEx.
 *                     Every generated kWh is then already paid for.
 *   'open_access'   — contracted from a third-party generator and wheeled to site.
 *                     No CapEx; instead every contracted kWh is paid for at the
 *                     contracted tariff plus wheeling/open-access charges, whether or
 *                     not the site consumes it.
 */
export type SolarProcurementModel = 'onsite_capex' | 'open_access';

export interface SolarInput {
  enableSolarIntegration: boolean;
  installedCapacityKwp: number;       // e.g., 150
  dailySurplusSolarKwh: number;       // e.g., 240
  exportAllowed: boolean;
  exportCreditPerKwh: number;         // e.g., 3.0
  curtailmentEnabled: boolean;
  /** Defaults to 'onsite_capex' when absent. */
  procurementModel?: SolarProcurementModel;
  /**
   * On-site only: the largest array the site can physically host (roof/land limit).
   * Configuring `installedCapacityKwp` above this raises a validation error.
   */
  maxOnsiteCapacityKwp?: number;      // e.g., 200
  /** On-site only: installed cost per kWp, folded into the project's turnkey CapEx. */
  solarCapexPerKwp?: number;          // e.g., 35,000 (INR/kWp)
  /** Open access only: contracted generation tariff, currency/kWh. */
  contractedTariffPerKwh?: number;    // e.g., 4.5
  /**
   * Open access only: wheeling, banking, cross-subsidy and additional surcharges,
   * currency/kWh. Added to the contracted tariff to give the delivered unit cost.
   */
  openAccessChargesPerKwh?: number;   // e.g., 1.8
  /**
   * Solar-only charging constraint. When true the battery may charge ONLY from surplus
   * solar (generation above site load); every grid-sourced charge path is disabled, so
   * `gridBatteryChargeKw` is 0 in every interval and the battery only gains energy while
   * the array is generating a surplus. Optional: absent/false preserves the legacy
   * behaviour where TOU off-peak grid charging is permitted.
   */
  solarOnlyCharging?: boolean;
}

/**
 * How turnkey CapEx is arrived at.
 *   'fixed'   — `FinancialInput.initialCapex` is used verbatim; rated power/energy
 *               have no effect on it. This is the default and the behaviour any
 *               scenario authored before the derived model resolves to.
 *   'derived' — CapEx is built from per-kWh and per-kW rates against the configured
 *               system size, plus balance-of-plant and an optional EPC markup.
 *               See `engine/capexModel.ts`.
 */
export type CapexModelType = 'fixed' | 'derived';

/** Component-level turnkey CapEx breakdown; see `engine/capexModel.ts`. */
export interface CapexBreakdown {
  model: CapexModelType;
  /** capexPerKwh * ratedEnergyKwh — the energy block (cells, racks, modules). */
  energyCapex: number;
  /** capexPerKw * ratedPowerKw — power conversion (PCS, switchgear, thermal). */
  powerCapex: number;
  /** Size-independent civil/EPC/commissioning/freight component. */
  balanceOfPlantCost: number;
  /** epcMarkupPct applied to the sum of the three components above (BESS scope only). */
  epcMarkup: number;
  /** On-site solar investment (installedCapacityKwp * solarCapexPerKwp); 0 for open access. */
  solarCapex: number;
  /** The turnkey figure the financial engine actually invests. */
  totalCapex: number;
}

export interface FinancialInput {
  /**
   * Turnkey CapEx. Under `capexModel: 'fixed'` (the default) this is the figure used
   * directly. Under `capexModel: 'derived'` it is ignored and recomputed from the
   * rates below against rated power/energy - use `resolveTurnkeyCapex()` rather than
   * reading this field when the model may be derived.
   */
  initialCapex: number;               // e.g., 4,000,000 (INR) or 48,000 (USD)
  /** Defaults to 'fixed' when absent. */
  capexModel?: CapexModelType;
  /** Energy-block rate, currency/kWh of rated energy. Derived model only. */
  capexPerKwh?: number;               // e.g., 10,000 (INR/kWh)
  /** Power-conversion rate, currency/kW of rated power. Derived model only. */
  capexPerKw?: number;                // e.g., 8,000 (INR/kW)
  /** Size-independent balance-of-plant / EPC cost. Derived model only. */
  balanceOfPlantCost?: number;        // e.g., 390,000 (INR)
  /** Percentage markup applied to the sum of the components. Derived model only. */
  epcMarkupPct?: number;              // e.g., 0
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
  /**
   * Dispatch-relevant classification of this interval's TOU period. Populated from the
   * matched TouPeriod where one exists. When absent, the dispatch engine classifies the
   * interval from `tariffImportRate` against the base energy charge instead, so
   * CSV-imported intervals carrying only rates still drive TOU dispatch correctly.
   */
  tariffPeriodKind?: TouPeriodKind;

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

  // Explicit meter-side / physical energy-flow signals (Objective A).
  // grossSiteLoadKw === loadKw; kept as an explicit alias so downstream billing
  // code never has to guess whether `loadKw` is gross or net of solar.
  grossSiteLoadKw: number;
  solarGenerationKw: number;
  /** Portion of solarGenerationKw actually consumed on-site this interval (<= min(solarGenerationKw, grossSiteLoadKw)). */
  solarGenerationServingLoadKw: number;
  /** Grid-side import that WOULD be metered with no BESS present: max(grossSiteLoadKw - solarGenerationServingLoadKw, 0). */
  preBessGridImportKw: number;
  /** Grid-side import actually metered post-BESS: max(grossSiteLoadKw - solarGenerationServingLoadKw - batteryDischargeKw + gridBatteryChargeKw, 0). */
  postBessGridImportKw: number;
  batteryChargeKw: number; // >= 0, total battery charge power this interval (any source)
  batteryDischargeKw: number; // >= 0, total battery discharge power this interval
  /** Portion of batteryChargeKw sourced from the grid (as opposed to solar). */
  gridBatteryChargeKw: number;

  // kVA billing equivalents, populated only when a reactive-power basis is available
  // (see ReactivePowerBasis). Undefined means "no kVA billing quantity could be derived".
  preBessGridImportKva?: number;
  postBessGridImportKva?: number;
}

/**
 * Deterministic precedence for deriving a kVA billing quantity from a kW value,
 * per docs/architecture — Objective A reactive-power policy:
 *   1. measured_kva    — validated measured interval grid-side kVA
 *   2. measured_pf     — validated measured interval grid-side power factor
 *   3. configured_pf   — configured site power factor
 *   4. unavailable     — no valid basis; kVA fields must be omitted and a warning raised
 */
export type ReactivePowerBasis = 'measured_kva' | 'measured_pf' | 'configured_pf' | 'unavailable';

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

  /**
   * Annual cost of the ENTIRE procured solar generation, consumed or not (open access
   * only; on-site solar is paid through CapEx instead). Reported at project level and
   * deliberately NOT included in netOperatingSaving - the same cost is incurred with
   * and without the battery, so it cancels in a BESS-attributable comparison. See
   * engine/solarProcurement.ts.
   */
  solarProcurementCost: number;
  /** The share of solarProcurementCost paid for generation that was curtailed - pure waste. */
  solarCurtailmentCost: number;

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
  /** TOTAL annual solar generation, before allocation to load/battery/export/curtailment. */
  solarGeneratedKwh: number;
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
  /**
   * Levelized Cost of Storage (currency per kWh discharged), computed as
   * (discounted lifetime cost) / (discounted lifetime energy discharged), both
   * discounted at financial.discountRatePct. Lifetime cost includes CapEx,
   * every year's full O&M (including charging/auxiliary energy cost and
   * degradation cost, matching the same omCostY used in the cash flow build)
   * and any scheduled replacement CapEx. Energy discharged is degradation-adjusted
   * per year using the same effectiveCapacityPct as the cash flow projection.
   * This is a standard discounted-LCOS definition, not a simple undiscounted
   * average - do not compare it against a non-discounted "cost per kWh" figure.
   */
  lcoePerKwh: number;
  /**
   * Simple lifetime ROI: total undiscounted net cash flow generated over the
   * project life, as a percentage of the initial CapEx. This is NOT
   * annualised and NOT the same as IRR - it answers "how many times over does
   * the project return the initial investment", not "what rate of return".
   */
  roiPct: number;
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
