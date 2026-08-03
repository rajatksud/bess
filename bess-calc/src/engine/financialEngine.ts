import { 
  FinancialInput, 
  SavingsBreakdown, 
  TechnicalResult, 
  FinancialResult, 
  AnnualCashFlow,
  BessSystemInput
} from '../types/bess';

/**
 * One physically-simulated project year: the output of re-running the dispatch engine at
 * that year's actual state of health (see src/engine/multiYearSimulation.ts).
 */
export interface DegradedYearInput {
  year: number;
  savings: SavingsBreakdown;
  /** Annual discharge throughput ACTUALLY achieved at this year's capacity. Already degraded. */
  energyDischargedKwh: number;
  sohPctStartOfYear: number;
}

export interface FinancialEngineOptions {
  /**
   * Per-year physically-simulated results, year 1..N.
   *
   * TRAP 2 (LCOS double counting), resolved explicitly. The legacy path multiplies a
   * FIXED technical.energyDischargedKwh by effectiveCapacityPct to model later years'
   * reduced output. If dispatch has ALSO been re-run at each year's degraded capacity,
   * that same physical effect is already baked into these figures, and applying
   * effectiveCapacityPct on top would derate it twice — inflating LCOS and deflating
   * savings by roughly the square of the degradation.
   *
   * The two paths are therefore mutually exclusive by construction:
   *   - degradedYears ABSENT  -> today's flat-scalar path, completely unchanged.
   *   - degradedYears PRESENT -> effectiveCapacityPct is pinned to 1.0 for savings, and
   *                              the LCOS denominator uses these per-year figures RAW.
   *                              Escalation (tariff/diesel/O&M) still applies, because
   *                              that is a price effect, not a capacity effect.
   */
  degradedYears?: DegradedYearInput[];
}

/**
 * Model-validity floor on the capacity multiplier.
 *
 * TRAP 1 (SOH-0 vs. the 0.5 floor), resolved explicitly. estimateDegradation floors SOH
 * at 0; a 0 would zero every savings stream and produce a nonsense NPV. The pre-existing
 * financial engine already floored the flat-linear multiplier at 0.5. That floor is kept,
 * unified across BOTH paths, and named for what it actually is: a statement that the
 * linear-fade projection is outside its range of validity below 50% capacity, NOT a
 * physical claim that a battery cannot fall below 50%.
 *
 * A run that hits the floor is not silently rescued: the SOH forecast separately reports
 * endOfLifeYear (see src/battery/sohForecast.ts) and the engineering report surfaces it,
 * so a reader sees "this asset reached end of life in year N" rather than a smooth curve
 * that quietly stopped moving.
 */
export const MIN_MODEL_VALID_CAPACITY_FACTOR = 0.5;

export function calculateFinancialMetrics(
  savings: SavingsBreakdown,
  technical: TechnicalResult,
  financial: FinancialInput,
  system: BessSystemInput,
  options: FinancialEngineOptions = {}
): FinancialResult {
  const projectYears = system.projectLifeYears || 10;
  const initialCapex = financial.initialCapex;
  const discountRate = financial.discountRatePct / 100;
  const tariffEsc = financial.tariffEscalationPct / 100;
  const dieselEsc = financial.dieselEscalationPct / 100;
  const omEsc = financial.annualOmEscalationPct / 100;
  const degRate = system.annualDegradationPct / 100;

  const annualCashFlows: AnnualCashFlow[] = [];

  let cumulativeCashFlow = -initialCapex;
  let cumulativeDiscountedCashFlow = -initialCapex;

  let simplePaybackYears: number | null = null;
  let discountedPaybackYears: number | null = null;

  const cashFlowArrayForIrr: number[] = [-initialCapex];

  // Accumulators for the discounted LCOS: discounted lifetime cost divided by
  // discounted lifetime energy discharged (both discounted at discountRatePct).
  let discountedLifetimeCost = initialCapex;
  let discountedLifetimeDischargeKwh = 0;

  const degradedYears = options.degradedYears;
  // When per-year simulated results are supplied, degradation is already embodied in
  // them, so the capacity multiplier must be neutral (see FinancialEngineOptions).
  const usePhysicallySimulatedYears = degradedYears !== undefined && degradedYears.length > 0;

  for (let year = 1; year <= projectYears; year++) {
    // Year-specific savings: either the physically simulated ones, or the flat first-year
    // set that the legacy path scales by a capacity multiplier.
    const simulatedYear = usePhysicallySimulatedYears
      ? degradedYears!.find(entry => entry.year === year) ?? degradedYears![degradedYears!.length - 1]
      : undefined;
    const yearSavings = simulatedYear ? simulatedYear.savings : savings;

    // Capacity degradation multiplier. Pinned to 1.0 on the simulated path so the same
    // physical effect is never applied twice.
    const effectiveCapacityPct = usePhysicallySimulatedYears
      ? 1.0
      : Math.max(MIN_MODEL_VALID_CAPACITY_FACTOR, 1.0 - degRate * (year - 1));

    // Escalated savings components
    const demandSavingsY = yearSavings.demandChargeSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;
    const dieselSavingsY = yearSavings.dieselFuelSaving * Math.pow(1 + dieselEsc, year - 1) * effectiveCapacityPct;
    const dgMaintSavingsY = yearSavings.dgMaintenanceSaving * Math.pow(1 + omEsc, year - 1);
    const solarSavingsY = yearSavings.solarSelfConsumptionSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;
    const arbitrageSavingsY = yearSavings.energyArbitrageSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;

    const grossSavingY = demandSavingsY + dieselSavingsY + dgMaintSavingsY + solarSavingsY + arbitrageSavingsY;

    // Escalated costs
    const chargingCostY = yearSavings.chargingEnergyCost * Math.pow(1 + tariffEsc, year - 1);
    const auxCostY = yearSavings.auxiliaryEnergyCost * Math.pow(1 + tariffEsc, year - 1);
    const degradationCostY = yearSavings.degradationCost * effectiveCapacityPct;
    const omCostY = (yearSavings.omCost + degradationCostY + auxCostY + chargingCostY) * Math.pow(1 + omEsc, year - 1);

    // Replacement CaPex in scheduled year
    let replacementCapex = 0;
    if (financial.replacementYear === year && financial.replacementCapexAmount) {
      replacementCapex = financial.replacementCapexAmount;
    }

    // Taxes & Depreciation (Straight-line 10 years)
    const annualDepreciation = initialCapex / projectYears;
    const taxableIncome = Math.max(0, grossSavingY - omCostY - annualDepreciation);
    const taxAmount = taxableIncome * (financial.taxRatePct / 100);

    // Residual value in final year
    let residualValue = 0;
    if (year === projectYears && financial.residualValuePct) {
      residualValue = initialCapex * (financial.residualValuePct / 100);
    }

    const netCashFlowY = grossSavingY - omCostY - replacementCapex - taxAmount + residualValue;
    const discountedCashFlowY = netCashFlowY / Math.pow(1 + discountRate, year);

    const prevCum = cumulativeCashFlow;
    cumulativeCashFlow += netCashFlowY;

    const prevCumDisc = cumulativeDiscountedCashFlow;
    cumulativeDiscountedCashFlow += discountedCashFlowY;

    // Calculate Simple Payback year with fractional interpolation
    if (simplePaybackYears === null && cumulativeCashFlow >= 0) {
      if (netCashFlowY > 0) {
        const fraction = Math.abs(prevCum) / netCashFlowY;
        simplePaybackYears = Math.round(((year - 1) + fraction) * 10) / 10;
      } else {
        simplePaybackYears = year;
      }
    }

    // Calculate Discounted Payback year
    if (discountedPaybackYears === null && cumulativeDiscountedCashFlow >= 0) {
      if (discountedCashFlowY > 0) {
        const fraction = Math.abs(prevCumDisc) / discountedCashFlowY;
        discountedPaybackYears = Math.round(((year - 1) + fraction) * 10) / 10;
      } else {
        discountedPaybackYears = year;
      }
    }

    cashFlowArrayForIrr.push(netCashFlowY);

    const discountFactorY = Math.pow(1 + discountRate, year);
    discountedLifetimeCost += (omCostY + replacementCapex) / discountFactorY;
    // LCOS denominator. On the simulated path the per-year figure is used RAW — it is
    // already the throughput achieved at that year's degraded capacity, so
    // effectiveCapacityPct (pinned to 1.0 above) must not derate it a second time.
    const yearDischargeKwh = simulatedYear
      ? simulatedYear.energyDischargedKwh
      : technical.energyDischargedKwh * effectiveCapacityPct;
    discountedLifetimeDischargeKwh += yearDischargeKwh / discountFactorY;

    annualCashFlows.push({
      year,
      // On the simulated path this column reports the actual modelled state of health
      // rather than a hardcoded 100, so a reader can still see the capacity trajectory.
      effectiveCapacityPct: simulatedYear
        ? Math.round(simulatedYear.sohPctStartOfYear)
        : Math.round(effectiveCapacityPct * 100),
      grossSaving: grossSavingY,
      omCost: omCostY,
      replacementCapex,
      taxableIncome,
      taxAmount,
      netCashFlow: netCashFlowY,
      discountedCashFlow: discountedCashFlowY,
      cumulativeCashFlow,
      cumulativeDiscountedCashFlow
    });
  }

  // Calculate Net Present Value
  const npv = cumulativeDiscountedCashFlow;

  // Calculate Internal Rate of Return (IRR) via bisection method
  const irrPct = calculateIrr(cashFlowArrayForIrr);

  // Levelized Cost of Storage (LCOS): discounted lifetime cost / discounted
  // lifetime energy discharged. See FinancialResult.lcoePerKwh doc comment for
  // the full definition and why this replaces the previous undocumented
  // "* 0.9" flat derate that also excluded charging/auxiliary cost.
  const lcoePerKwh = discountedLifetimeDischargeKwh > 0
    ? discountedLifetimeCost / discountedLifetimeDischargeKwh
    : 0;

  // Simple lifetime ROI (not annualised, not IRR - see FinancialResult.roiPct doc comment).
  const roiPct = initialCapex > 0 ? (cumulativeCashFlow / initialCapex) * 100 : 0;

  // Report year 1's own figures. On the simulated path the caller passes year 1's savings
  // as `savings` anyway (year 1 runs at 100% SOH), but reading it from the year-1 entry
  // when present removes the need for the caller to keep those two in step.
  const firstSimulatedYear = usePhysicallySimulatedYears
    ? degradedYears!.find(entry => entry.year === 1)
    : undefined;
  const firstYearSavings = firstSimulatedYear ? firstSimulatedYear.savings : savings;

  return {
    initialInvestment: initialCapex,
    firstYearGrossSaving: firstYearSavings.grossSaving,
    firstYearNetSaving: firstYearSavings.netOperatingSaving,
    simplePaybackYears,
    discountedPaybackYears,
    npv,
    irrPct,
    tenYearCumulativeCashFlow: cumulativeCashFlow,
    lcoePerKwh,
    roiPct,
    annualCashFlows
  };
}

// Bisection method to solve for IRR
function calculateIrr(cashflows: number[]): number | null {
  let minRate = -0.5;
  let maxRate = 1.0;
  let irr = 0.1;

  for (let i = 0; i < 100; i++) {
    irr = (minRate + maxRate) / 2;
    let npvVal = 0;
    for (let t = 0; t < cashflows.length; t++) {
      npvVal += cashflows[t] / Math.pow(1 + irr, t);
    }

    if (Math.abs(npvVal) < 1e-4) {
      return Math.round(irr * 1000) / 10;
    }

    if (npvVal > 0) {
      minRate = irr;
    } else {
      maxRate = irr;
    }
  }

  const finalIrr = Math.round(irr * 1000) / 10;
  return isNaN(finalIrr) || finalIrr < -50 || finalIrr > 100 ? null : finalIrr;
}
