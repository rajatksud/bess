import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord,
  SavingsBreakdown,
  TechnicalResult
} from '../types/bess';

/**
 * Per-category energy attribution for one simulated horizon (normally one day).
 *
 * Rule 2 (no double counting) used to be an unwritten convention enforced by
 * dispatchEngine.ts tagging each interval with exactly one `bessAction` string. That
 * works for the rule-based engine but cannot represent an LP schedule, where a single
 * interval's discharge legitimately splits across categories (see
 * docs/architecture/LP_ENERGY_ATTRIBUTION.md).
 *
 * Making the attribution an explicit record turns Rule 2 from a convention into a
 * checkable invariant:
 *
 *   dgDisplacedKwh + peakShavingKwh + arbitrageDischargeKwh === totalDischargedKwh
 *
 * `totalChargedKwh`/`totalDischargedKwh` are the PHYSICAL totals across every category.
 * They are valid only for physical purposes (SOC bookkeeping, cycle counting,
 * degradation cost) and must never be used to derive a per-category monetary saving —
 * that is precisely the double-count this record exists to prevent.
 *
 * All quantities are in kWh over the simulated horizon, before annualisation.
 */
export interface DispatchAttribution {
  /** Discharge that displaced diesel generation (grid-outage backup + explicit DG displacement). */
  dgDisplacedKwh: number;
  /** Discharge credited with reducing billed demand. Monetised via the peak delta, not per-kWh — tracked here so the Rule 2 invariant is checkable. */
  peakShavingKwh: number;
  /** Discharge monetised at the peak energy rate as TOU arbitrage. */
  arbitrageDischargeKwh: number;
  /** Charge sourced from surplus solar that would otherwise have been curtailed or exported. */
  solarStoredKwh: number;
  /** Charge drawn from the grid (any reason). */
  gridChargedKwh: number;
  /** Charge drawn from the grid specifically during a TOU off-peak arbitrage window. */
  arbitrageChargedKwh: number;
  /** Physical total charge across every category — SOC/degradation only. */
  totalChargedKwh: number;
  /** Physical total discharge across every category — SOC/degradation only. */
  totalDischargedKwh: number;
  /** Load that could not be served during a grid outage (diesel still required). */
  unservedBackupKwh: number;
  /** Solar generation neither consumed on site nor absorbed by the battery. */
  curtailedSolarKwh: number;
}

export function emptyAttribution(): DispatchAttribution {
  return {
    dgDisplacedKwh: 0,
    peakShavingKwh: 0,
    arbitrageDischargeKwh: 0,
    solarStoredKwh: 0,
    gridChargedKwh: 0,
    arbitrageChargedKwh: 0,
    totalChargedKwh: 0,
    totalDischargedKwh: 0,
    unservedBackupKwh: 0,
    curtailedSolarKwh: 0
  };
}

/**
 * Checks the Rule 2 invariant. Returns an empty array when the attribution is balanced,
 * otherwise a list of human-readable violations. Callers on both dispatch paths assert
 * on this in tests; it is deliberately NOT thrown from the aggregation hot path, because
 * a balance failure is a programming error in the producer, not a user-input error.
 */
export function attributionViolations(attribution: DispatchAttribution, toleranceKwh = 1e-6): string[] {
  const violations: string[] = [];
  const attributedDischargeKwh =
    attribution.dgDisplacedKwh + attribution.peakShavingKwh + attribution.arbitrageDischargeKwh;

  if (Math.abs(attributedDischargeKwh - attribution.totalDischargedKwh) > toleranceKwh) {
    violations.push(
      `Discharge attribution does not balance: dg(${attribution.dgDisplacedKwh}) + ` +
      `peakShaving(${attribution.peakShavingKwh}) + arbitrage(${attribution.arbitrageDischargeKwh}) = ` +
      `${attributedDischargeKwh}, but totalDischargedKwh = ${attribution.totalDischargedKwh}`
    );
  }

  const attributedChargeKwh = attribution.solarStoredKwh + attribution.gridChargedKwh;
  if (Math.abs(attributedChargeKwh - attribution.totalChargedKwh) > toleranceKwh) {
    violations.push(
      `Charge attribution does not balance: solar(${attribution.solarStoredKwh}) + ` +
      `grid(${attribution.gridChargedKwh}) = ${attributedChargeKwh}, but ` +
      `totalChargedKwh = ${attribution.totalChargedKwh}`
    );
  }

  if (attribution.arbitrageChargedKwh - attribution.gridChargedKwh > toleranceKwh) {
    violations.push(
      `Arbitrage charging (${attribution.arbitrageChargedKwh} kWh) exceeds total grid charging ` +
      `(${attribution.gridChargedKwh} kWh); arbitrage charge is a subset of grid charge.`
    );
  }

  return violations;
}

/**
 * Everything the aggregation needs from a dispatch run that is not already in the
 * scenario's own configuration inputs. Any dispatch implementation (rule-based, LP,
 * MILP, MPC) that can produce this context gets identical, Rule 2-compliant savings.
 */
export interface AggregationContext {
  simulatedIntervals: IntervalRecord[];
  attribution: DispatchAttribution;
  /** Meter-side (net-of-solar) peak import with no battery present. */
  peakBeforeKw: number;
  peakBeforeKva: number;
  /** Resolved kW -> kVA basis, or undefined when no reactive-power basis is available. */
  powerFactor?: number;
  minimumSocPct: number;
  maximumSocPct: number;
  /** Usable energy the battery can actually deliver, at this run's state of health. */
  deliverableCapacityKwh: number;
  /**
   * Number of times the simulated horizon repeats to make a year. The engine simulates a
   * representative day and scales by 365; a full-year interval dataset would use 1.
   */
  daysPerYear?: number;
}

const DEFAULT_DAYS_PER_YEAR = 365;

/**
 * Turns a per-interval dispatch trace plus its energy attribution into the annualised
 * SavingsBreakdown and TechnicalResult.
 *
 * Extracted verbatim from dispatchEngine.ts so that every dispatch implementation shares
 * one aggregation — and so that the multi-year SOH forecast, the scenario comparison
 * engine and the LP path do not each grow their own copy of these formulas.
 */
export function aggregateSavings(
  context: AggregationContext,
  system: BessSystemInput,
  tariff: TariffInput,
  diesel: DieselInput,
  solar: SolarInput,
  financial: FinancialInput
): { savings: SavingsBreakdown; technical: TechnicalResult } {
  const { simulatedIntervals, attribution, peakBeforeKw, peakBeforeKva, powerFactor: pf } = context;
  const daysInYear = context.daysPerYear ?? DEFAULT_DAYS_PER_YEAR;

  // Find Peak After BESS - billing-relevant peak is the METER-SIDE grid import
  // (postBessGridImportKw/Kva), not raw post-battery load, since demand charges are
  // levied on what the grid meter actually sees.
  let peakAfterKw = 0;
  let peakAfterKva = 0;
  simulatedIntervals.forEach(inv => {
    if (inv.postBessGridImportKw > peakAfterKw) peakAfterKw = inv.postBessGridImportKw;
    if (pf && (inv.postBessGridImportKva ?? 0) > peakAfterKva) peakAfterKva = inv.postBessGridImportKva ?? 0;
  });

  // 1. Demand Charge Saving
  const billedKvaBefore = Math.min(tariff.contractDemandKva, peakBeforeKva);
  const billedKvaAfter = Math.min(tariff.contractDemandKva, Math.max(peakAfterKva, tariff.contractDemandKva * (tariff.minimumBillingDemandPct / 100)));
  const kvaReduced = Math.max(0, billedKvaBefore - billedKvaAfter);
  const annualDemandSaving = kvaReduced * tariff.demandChargePerKvaMonth * 12;

  // 2. Diesel Displacement Saving
  const annualDgEnergyDisplacedKwh = attribution.dgDisplacedKwh * daysInYear;
  const fuelFactorLPerKwh = diesel.specificFuelConsumptionLitrePerKwh || 0.28;
  const annualLitresSaved = annualDgEnergyDisplacedKwh * fuelFactorLPerKwh;
  const annualDieselFuelSaving = annualLitresSaved * diesel.dieselPricePerLitre;

  // DG maintenance saving (approx. run hours reduced)
  const avgOutageLoad = diesel.avgOutageLoadKw || 120;
  const avoidedDgRunHours = annualDgEnergyDisplacedKwh / Math.max(10, avgOutageLoad);
  const annualDgMaintenanceSaving = avoidedDgRunHours * (diesel.maintenanceCostPerRunHour || 150);

  // 3. Solar Self-Consumption Saving
  const annualSolarStoredKwh = attribution.solarStoredKwh * daysInYear;
  const avoidedImportTariff = tariff.energyChargePerKwh;
  const exportCredit = solar.exportCreditPerKwh || 3.0;
  const netSolarBenefitPerKwh = Math.max(0, avoidedImportTariff - exportCredit);
  const annualSolarSelfConsumptionSaving = annualSolarStoredKwh * netSolarBenefitPerKwh;

  // 4. Energy Arbitrage Saving
  //
  // Rule 2 (no double counting): this MUST be computed only from energy the dispatch
  // path attributed to arbitrage (attribution.arbitrageDischargeKwh /
  // arbitrageChargedKwh). Using attribution.totalDischargedKwh here would re-monetize
  // kWh already credited to demand-charge reduction (peak shaving) and diesel-fuel
  // saving (backup/DG displacement) above, because those categories share the same
  // physical battery and are mutually exclusive per kWh, but totalDischargedKwh sums
  // across ALL of them.
  const annualDischargedKwh = attribution.totalDischargedKwh * daysInYear;
  const annualChargedKwh = attribution.totalChargedKwh * daysInYear;
  const annualArbitrageDischargedKwh = attribution.arbitrageDischargeKwh * daysInYear;
  // Net arbitrage value = (peak-rate energy discharged x peak rate) - (off-peak energy
  // charged x off-peak rate), consistent with CALCULATION_ENGINE_DESIGN.md section on
  // Arbitrage and the coding spec's net-arbitrage-value formula. Falls back to the
  // standard energy charge if no TOU periods are configured for this interval set.
  const peakRate = tariff.enableTou
    ? Math.max(tariff.energyChargePerKwh, ...tariff.touPeriods.map(p => p.importRatePerKwh))
    : tariff.energyChargePerKwh;
  const offPeakRate = tariff.enableTou && tariff.touPeriods.length > 0
    ? Math.min(...tariff.touPeriods.map(p => p.importRatePerKwh))
    : tariff.energyChargePerKwh;
  // This is the GROSS arbitrage saving (avoided peak-rate import only). The cost of
  // the off-peak grid energy used to charge is deducted once, below, via
  // annualChargingCost - it must not also be netted out here or it would be
  // subtracted from net savings twice.
  const annualEnergyArbitrageSaving = Math.max(0, annualArbitrageDischargedKwh * peakRate);

  // Costs
  // All grid (non-solar) charging in this simulation currently originates from the
  // TOU off-peak-charge branch, so annualGridChargedKwh === annualArbitrageChargedKwh.
  // Priced at the actual off-peak tariff rather than an approximated 0.8x factor.
  const annualGridChargedKwh = attribution.gridChargedKwh * daysInYear;
  const annualChargingCost = annualGridChargedKwh * offPeakRate;

  const annualAuxiliaryKwh = system.auxiliaryLoadKw * 24 * daysInYear;
  const annualAuxiliaryCost = annualAuxiliaryKwh * tariff.energyChargePerKwh;

  const totalAnnualThroughputKwh = annualDischargedKwh;
  const degradationCostPerKwh = financial.variableOmPerKwhThroughput || 0.15;
  const annualDegradationCost = totalAnnualThroughputKwh * degradationCostPerKwh;

  const annualOmCost = financial.fixedAnnualOm;

  const grossSaving = annualDemandSaving + annualDieselFuelSaving + annualDgMaintenanceSaving + annualSolarSelfConsumptionSaving + annualEnergyArbitrageSaving;
  const netOperatingSaving = grossSaving - annualChargingCost - annualAuxiliaryCost - annualDegradationCost - annualOmCost;

  // Utilisation-style cycle count: annual throughput relative to NAMEPLATE energy.
  // This is deliberately NOT the DoD-weighted ageing cycle count from
  // src/battery/cycleCounting.ts - see docs/architecture/BATTERY_MODEL_ARCHITECTURE.md
  // and src/report/types.ts for why both exist and which is canonical for ageing.
  const equivalentFullCycles = annualDischargedKwh / Math.max(1, system.ratedEnergyKwh);

  return {
    savings: {
      demandChargeSaving: annualDemandSaving,
      dieselFuelSaving: annualDieselFuelSaving,
      dgMaintenanceSaving: annualDgMaintenanceSaving,
      solarSelfConsumptionSaving: annualSolarSelfConsumptionSaving,
      energyArbitrageSaving: annualEnergyArbitrageSaving,
      exportRevenueChange: 0,
      chargingEnergyCost: annualChargingCost,
      auxiliaryEnergyCost: annualAuxiliaryCost,
      degradationCost: annualDegradationCost,
      omCost: annualOmCost,
      grossSaving,
      netOperatingSaving
    },
    technical: {
      peakBeforeKw,
      peakAfterKw,
      peakBeforeKva,
      peakAfterKva,
      energyChargedKwh: annualChargedKwh,
      energyDischargedKwh: annualDischargedKwh,
      solarEnergyStoredKwh: annualSolarStoredKwh,
      dgEnergyDisplacedKwh: annualDgEnergyDisplacedKwh,
      equivalentFullCycles,
      minimumSocPct: context.minimumSocPct,
      maximumSocPct: context.maximumSocPct,
      unservedBackupEnergyKwh: attribution.unservedBackupKwh * daysInYear,
      curtailedSolarKwh: attribution.curtailedSolarKwh * daysInYear,
      deliverableCapacityKwh: context.deliverableCapacityKwh
    }
  };
}
