// BESS Tariff Domain Engine — core types.
// Independent of the dispatch/battery engine and the UI. Converts a billing-relevant
// interval series (BillingInterval[]) plus a TariffDefinition into a bill.

export type BillingCycle = 'monthly' | 'bimonthly' | 'quarterly';

export type RoundingMode = 'none' | 'nearest' | 'up' | 'down';

export interface RoundingRule {
  mode: RoundingMode;
  /** Decimal places to round to, e.g. 2 for currency subunits, 0 for whole units. */
  decimals: number;
}

// --- Energy charges ---------------------------------------------------------

export interface WeekdayWeekendSchedule {
  /** 0=Sunday..6=Saturday. Days not listed use the default (non-TOD) rate. */
  applicableDays: number[];
}

export interface SeasonDefinition {
  id: string;
  name: string;
  /** Inclusive month range, 1-12. Wraps (e.g. 11-2) for seasons crossing year end. */
  startMonth: number;
  endMonth: number;
}

export interface TodRatePeriod {
  id: string;
  name: string;
  /** "HH:MM" 24h local (tariff timezone) time, inclusive start. */
  startTime: string;
  /** "HH:MM" 24h local (tariff timezone) time, exclusive end. */
  endTime: string;
  ratePerKwh: number;
  /** If omitted, applies every day. */
  schedule?: WeekdayWeekendSchedule;
  /** If omitted, applies in every season. */
  seasonId?: string;
}

export interface EnergyChargeDefinition {
  type: 'flat' | 'tod';
  /** Required when type === 'flat'; ignored otherwise. */
  flatRatePerKwh?: number;
  /** Required when type === 'tod'; ignored otherwise. Must have full 24h coverage per applicable day/season. */
  todPeriods?: TodRatePeriod[];
  seasons?: SeasonDefinition[];
}

// --- Demand charges ----------------------------------------------------------

export type DemandBasis =
  | 'measured_maximum'
  | 'contract_demand'
  | 'ratchet'
  | 'month_to_date_peak';

export interface DemandRatchetRule {
  /** Percentage of the highest demand recorded in the trailing window, e.g. 80 = 80%. */
  ratchetPct: number;
  /** Number of months the ratchet look-back covers. */
  lookbackMonths: number;
}

export interface TodDemandChargeDefinition {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  ratePerKw?: number;
  ratePerKva?: number;
  schedule?: WeekdayWeekendSchedule;
}

export interface DemandChargeDefinition {
  ratePerKw?: number;
  ratePerKva?: number;
  contractDemandKw?: number;
  contractDemandKva?: number;
  /** Percentage of contract demand billed as a floor even if measured demand is lower. */
  minimumBillingDemandPct?: number;
  ratchet?: DemandRatchetRule;
  todDemandCharges?: TodDemandChargeDefinition[];
  basis: DemandBasis;
}

// --- Export rules --------------------------------------------------------------

export type ExportPolicy =
  | 'prohibited'
  | 'zero_value'
  | 'fixed_credit'
  | 'net_metering'
  | 'banking'
  | 'curtailed';

export interface ExportRuleDefinition {
  policy: ExportPolicy;
  /** Required for fixed_credit / net_metering (as the sell rate) / banking (settlement rate). */
  creditPerKwh?: number;
  /** For 'curtailed': maximum exportable kW; excess must be curtailed, not exported. */
  curtailmentLimitKw?: number;
  /** For 'banking': months before unbanked energy expires/forfeits, if applicable. */
  bankingSettlementMonths?: number;
}

// --- Taxes and duties ----------------------------------------------------------

export type ChargeBase = 'energy_charge' | 'demand_charge' | 'subtotal' | 'energy_plus_demand';

export interface TaxDutyDefinition {
  id: string;
  name: string;
  type: 'percentage' | 'fixed';
  /** Percentage value (e.g. 18 for 18%) when type === 'percentage'. */
  rate?: number;
  /** Fixed currency amount per billing cycle when type === 'fixed'. */
  fixedAmount?: number;
  base: ChargeBase;
}

export interface LossSurchargeDefinition {
  /** Percentage applied to energy charges to account for T&D losses. */
  lossPct: number;
}

// --- Applicability -------------------------------------------------------------

export interface ApplicabilityCondition {
  description: string;
  /** True if this condition is currently satisfied for the site in question (caller-supplied). */
  satisfied: boolean;
}

// --- Tariff definition -----------------------------------------------------------

export interface TariffDefinition {
  id: string;
  name: string;
  source: string;
  version: string;

  effectiveFrom: string;
  effectiveTo?: string;

  jurisdiction: string;
  utility?: string;
  consumerCategory: string;
  voltageLevel: string;

  timezone: string;
  currency: string;

  billingCycle: BillingCycle;
  billingUnit: 'kW' | 'kVA';
  demandIntegrationWindowMinutes: number;

  energyCharges: EnergyChargeDefinition;
  demandCharges: DemandChargeDefinition;
  exportRules: ExportRuleDefinition;

  taxesAndDuties: TaxDutyDefinition[];
  lossesSurcharge?: LossSurchargeDefinition;

  applicabilityConditions: ApplicabilityCondition[];
  roundingRule: RoundingRule;
}

// --- Billing interval boundary (adapter target from dispatch output) --------------

export interface BillingInterval {
  timestamp: string;
  durationHours: number;

  baselineGridImportKw: number;
  postBessGridImportKw: number;

  baselineGridImportKva?: number;
  postBessGridImportKva?: number;

  baselineGridExportKw?: number;
  postBessGridExportKw?: number;
}

// --- Results -----------------------------------------------------------------

export interface ChargeLine {
  label: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface BillSummary {
  energyChargeTotal: number;
  demandChargeTotal: number;
  exportCreditTotal: number;
  taxesAndDutiesTotal: number;
  totalBill: number;
  billedDemandKw?: number;
  billedDemandKva?: number;
  totalEnergyKwh: number;
  totalExportKwh: number;
}

export type BillingWarningLevel = 'error' | 'warning' | 'info';

export interface BillingWarning {
  code: string;
  level: BillingWarningLevel;
  message: string;
}

export interface TariffCalculationResult {
  baselineBill: BillSummary;
  postBessBill: BillSummary;

  energyChargeBreakdown: ChargeLine[];
  demandChargeBreakdown: ChargeLine[];
  exportCreditBreakdown: ChargeLine[];
  taxesAndDutiesBreakdown: ChargeLine[];

  netAvoidedCost: number;
  assumptions: string[];
  warnings: BillingWarning[];
}

/** Context needed alongside a TariffDefinition to run a calculation. */
export interface TariffCalculationContext {
  intervals: BillingInterval[];
  /** Existing month-to-date peak demand already recorded this billing cycle, if any (kW). */
  existingMonthToDatePeakKw?: number;
  existingMonthToDatePeakKva?: number;
  /** Highest demand recorded in the ratchet lookback window, if a ratchet rule applies. */
  ratchetLookbackPeakKw?: number;
  ratchetLookbackPeakKva?: number;
  /** ISO date the calculation is being evaluated as-of, for effective-date checks. */
  asOfDate: string;
  /** Source cadence of the underlying interval data, in minutes (for aggregation-window checks). */
  sourceCadenceMinutes: number;
}
