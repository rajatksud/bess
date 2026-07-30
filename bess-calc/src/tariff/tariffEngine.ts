import {
  TariffDefinition,
  TariffCalculationContext,
  TariffCalculationResult,
  BillSummary,
  BillingWarning
} from './types';
import { calculateEnergyCharges } from './energyCharges';
import { calculateDemandCharges } from './demandCharges';
import { calculateExportCredit } from './exportRules';
import { calculateTaxesAndDuties, applyRounding } from './taxesAndDuties';
import { validateTariffApplicability, validateDemandIntegrationCompatibility } from './validation';
import { aggregateDemandWindows } from './billingDemand';

function buildBill(
  tariff: TariffDefinition,
  ctx: TariffCalculationContext,
  useEnergyField: 'baselineGridImportKw' | 'postBessGridImportKw',
  useExportField: 'baselineGridExportKw' | 'postBessGridExportKw',
  demandIntervalsOverride?: ReturnType<typeof aggregateDemandWindows>
): { summary: BillSummary; energyBreakdown: ReturnType<typeof calculateEnergyCharges>['breakdown']; demandBreakdown: ReturnType<typeof calculateDemandCharges>['breakdown']; exportBreakdown: ReturnType<typeof calculateExportCredit>['breakdown']; taxBreakdown: ReturnType<typeof calculateTaxesAndDuties>['breakdown']; warnings: BillingWarning[] } {
  const warnings: BillingWarning[] = [];

  const energyResult = calculateEnergyCharges(ctx.intervals, tariff.energyCharges, tariff.timezone, useEnergyField);

  const lossAdjustedEnergyAmount = tariff.lossesSurcharge
    ? energyResult.totalAmount * (1 + tariff.lossesSurcharge.lossPct / 100)
    : energyResult.totalAmount;

  const demandSourceIntervals = demandIntervalsOverride
    ? demandIntervalsOverride.map(w => ({
        timestamp: w.windowStart,
        durationHours: tariff.demandIntegrationWindowMinutes / 60,
        baselineGridImportKw: useEnergyField === 'baselineGridImportKw' ? w.avgImportKw : 0,
        postBessGridImportKw: useEnergyField === 'postBessGridImportKw' ? w.avgImportKw : 0,
        baselineGridImportKva: useEnergyField === 'baselineGridImportKw' ? w.avgImportKva : undefined,
        postBessGridImportKva: useEnergyField === 'postBessGridImportKw' ? w.avgImportKva : undefined
      }))
    : ctx.intervals;

  const demandResult = calculateDemandCharges(
    demandSourceIntervals,
    tariff.demandCharges,
    {
      existingMonthToDatePeakKw: ctx.existingMonthToDatePeakKw,
      existingMonthToDatePeakKva: ctx.existingMonthToDatePeakKva,
      ratchetLookbackPeakKw: ctx.ratchetLookbackPeakKw,
      ratchetLookbackPeakKva: ctx.ratchetLookbackPeakKva,
      timezone: tariff.timezone
    },
    useEnergyField
  );
  warnings.push(...demandResult.warnings);

  const exportResult = calculateExportCredit(ctx.intervals, tariff.exportRules, useExportField);
  warnings.push(...exportResult.warnings);

  const taxResult = calculateTaxesAndDuties(
    tariff.taxesAndDuties,
    { energyCharge: lossAdjustedEnergyAmount, demandCharge: demandResult.totalAmount },
    tariff.roundingRule
  );

  const totalBill = applyRounding(
    lossAdjustedEnergyAmount + demandResult.totalAmount + taxResult.totalAmount - exportResult.totalCredit,
    tariff.roundingRule
  );

  const summary: BillSummary = {
    energyChargeTotal: applyRounding(lossAdjustedEnergyAmount, tariff.roundingRule),
    demandChargeTotal: applyRounding(demandResult.totalAmount, tariff.roundingRule),
    exportCreditTotal: applyRounding(exportResult.totalCredit, tariff.roundingRule),
    taxesAndDutiesTotal: applyRounding(taxResult.totalAmount, tariff.roundingRule),
    totalBill,
    billedDemandKw: demandResult.billedDemandKw,
    billedDemandKva: demandResult.billedDemandKva,
    totalEnergyKwh: energyResult.totalKwh,
    totalExportKwh: exportResult.totalExportKwh
  };

  return {
    summary,
    energyBreakdown: energyResult.breakdown,
    demandBreakdown: demandResult.breakdown,
    exportBreakdown: exportResult.breakdown,
    taxBreakdown: taxResult.breakdown,
    warnings
  };
}

/**
 * Calculates a baseline (no-BESS) bill and a post-BESS bill for the same tariff and
 * interval series, and returns the avoided cost between them along with a full
 * assumptions/warnings trail. This is the tariff engine's top-level entry point.
 */
export function calculateTariffBill(tariff: TariffDefinition, ctx: TariffCalculationContext): TariffCalculationResult {
  const assumptions: string[] = [];
  const warnings: BillingWarning[] = [];

  warnings.push(...validateTariffApplicability(tariff, ctx.asOfDate));

  const compatibilityWarnings = validateDemandIntegrationCompatibility(
    ctx.sourceCadenceMinutes,
    tariff.demandIntegrationWindowMinutes
  );
  warnings.push(...compatibilityWarnings);

  const needsAggregation = ctx.sourceCadenceMinutes < tariff.demandIntegrationWindowMinutes
    && tariff.demandIntegrationWindowMinutes % ctx.sourceCadenceMinutes === 0;
  const cadenceUnusable = compatibilityWarnings.some(w => w.level === 'error');

  const baselineDemandWindows = needsAggregation && !cadenceUnusable
    ? aggregateDemandWindows(ctx.intervals, tariff.demandIntegrationWindowMinutes, 'baselineGridImportKw')
    : undefined;
  const postBessDemandWindows = needsAggregation && !cadenceUnusable
    ? aggregateDemandWindows(ctx.intervals, tariff.demandIntegrationWindowMinutes, 'postBessGridImportKw')
    : undefined;

  const baseline = buildBill(tariff, ctx, 'baselineGridImportKw', 'baselineGridExportKw', baselineDemandWindows);
  const postBess = buildBill(tariff, ctx, 'postBessGridImportKw', 'postBessGridExportKw', postBessDemandWindows);

  warnings.push(...baseline.warnings, ...postBess.warnings);

  if (cadenceUnusable) {
    assumptions.push('Demand-charge figures are NOT engineering-grade: source interval cadence is coarser than the tariff\'s demand integration window.');
  } else if (needsAggregation) {
    assumptions.push(`Demand charges were computed by energy-weighted-averaging ${ctx.sourceCadenceMinutes}-minute source intervals into ${tariff.demandIntegrationWindowMinutes}-minute integration windows.`);
  }

  if (tariff.lossesSurcharge) {
    assumptions.push(`Energy charges include a ${tariff.lossesSurcharge.lossPct}% T&D losses surcharge.`);
  }

  const netAvoidedCost = baseline.summary.totalBill - postBess.summary.totalBill;

  return {
    baselineBill: baseline.summary,
    postBessBill: postBess.summary,
    energyChargeBreakdown: postBess.energyBreakdown,
    demandChargeBreakdown: postBess.demandBreakdown,
    exportCreditBreakdown: postBess.exportBreakdown,
    taxesAndDutiesBreakdown: postBess.taxBreakdown,
    netAvoidedCost,
    assumptions,
    warnings
  };
}
