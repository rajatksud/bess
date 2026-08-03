import { 
  FinancialInput, 
  SavingsBreakdown, 
  TechnicalResult, 
  FinancialResult, 
  AnnualCashFlow,
  BessSystemInput
} from '../types/bess';

export function calculateFinancialMetrics(
  savings: SavingsBreakdown,
  technical: TechnicalResult,
  financial: FinancialInput,
  system: BessSystemInput
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

  for (let year = 1; year <= projectYears; year++) {
    // Capacity degradation multiplier
    const effectiveCapacityPct = Math.max(0.5, 1.0 - degRate * (year - 1));

    // Escalated savings components
    const demandSavingsY = savings.demandChargeSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;
    const dieselSavingsY = savings.dieselFuelSaving * Math.pow(1 + dieselEsc, year - 1) * effectiveCapacityPct;
    const dgMaintSavingsY = savings.dgMaintenanceSaving * Math.pow(1 + omEsc, year - 1);
    const solarSavingsY = savings.solarSelfConsumptionSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;
    const arbitrageSavingsY = savings.energyArbitrageSaving * Math.pow(1 + tariffEsc, year - 1) * effectiveCapacityPct;

    const grossSavingY = demandSavingsY + dieselSavingsY + dgMaintSavingsY + solarSavingsY + arbitrageSavingsY;

    // Escalated costs
    const chargingCostY = savings.chargingEnergyCost * Math.pow(1 + tariffEsc, year - 1);
    const auxCostY = savings.auxiliaryEnergyCost * Math.pow(1 + tariffEsc, year - 1);
    const degradationCostY = savings.degradationCost * effectiveCapacityPct;
    const omCostY = (savings.omCost + degradationCostY + auxCostY + chargingCostY) * Math.pow(1 + omEsc, year - 1);

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
    discountedLifetimeDischargeKwh += (technical.energyDischargedKwh * effectiveCapacityPct) / discountFactorY;

    annualCashFlows.push({
      year,
      effectiveCapacityPct: Math.round(effectiveCapacityPct * 100),
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

  return {
    initialInvestment: initialCapex,
    firstYearGrossSaving: savings.grossSaving,
    firstYearNetSaving: savings.netOperatingSaving,
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
