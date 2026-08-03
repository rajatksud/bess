import { BillingInterval, DemandChargeDefinition, ChargeLine, BillingWarning } from './types';
import { maximumDemand } from './billingDemand';
import { resolveTodPeriod } from './energyCharges';

export interface DemandChargeResult {
  billedDemandKw?: number;
  billedDemandKva?: number;
  totalAmount: number;
  breakdown: ChargeLine[];
  warnings: BillingWarning[];
}

export interface DemandChargeContext {
  existingMonthToDatePeakKw?: number;
  existingMonthToDatePeakKva?: number;
  ratchetLookbackPeakKw?: number;
  ratchetLookbackPeakKva?: number;
  timezone: string;
}

/**
 * Computes the demand charge given a measured maximum demand for the billing horizon
 * plus contract/minimum/ratchet/month-to-date-peak overlays. Only the INCREMENTAL peak
 * above any existing month-to-date peak attracts additional charge for this calculation
 * run — the full billed demand (for display) still reflects the true maximum across
 * existing + new peaks.
 */
export function calculateDemandCharges(
  intervals: BillingInterval[],
  demand: DemandChargeDefinition,
  ctx: DemandChargeContext,
  useField: 'baselineGridImportKw' | 'postBessGridImportKw' = 'postBessGridImportKw'
): DemandChargeResult {
  const warnings: BillingWarning[] = [];
  const breakdown: ChargeLine[] = [];

  if (demand.todDemandCharges && demand.todDemandCharges.length > 0) {
    return calculateTodDemandCharges(intervals, demand, ctx, useField);
  }

  // Intervals supplied here are expected to already be aggregated to the tariff's
  // demand integration window (see billingDemand.aggregateDemandWindows) - each
  // interval is treated as one already-averaged demand-window sample.
  const { maxKw: measuredMaxKw, maxKva: measuredMaxKva } = maximumDemand(
    intervals.map(inv => ({
      windowStart: inv.timestamp,
      avgImportKw: inv[useField],
      avgImportKva: useField === 'baselineGridImportKw' ? inv.baselineGridImportKva : inv.postBessGridImportKva
    }))
  );

  // Only the incremental peak above any existing month-to-date peak matters for demand
  // billed this horizon; a shorter-than-billing-cycle evaluation window must not claim
  // credit for a peak the site already recorded earlier this cycle.
  let billedKw = Math.max(measuredMaxKw, ctx.existingMonthToDatePeakKw ?? 0);
  let billedKva = measuredMaxKva !== undefined ? Math.max(measuredMaxKva, ctx.existingMonthToDatePeakKva ?? 0) : undefined;

  if (demand.contractDemandKw !== undefined) {
    billedKw = Math.min(billedKw, demand.contractDemandKw) || billedKw; // billed is capped at contract but never below the floor logic below
    billedKw = Math.max(billedKw, 0);
  }

  const contractFloorPct = demand.minimumBillingDemandPct ?? 0;
  if (demand.basis === 'contract_demand' && demand.contractDemandKw !== undefined) {
    const floorKw = demand.contractDemandKw * (contractFloorPct / 100);
    billedKw = Math.max(billedKw, floorKw);
    if (billedKva !== undefined && demand.contractDemandKva !== undefined) {
      billedKva = Math.max(billedKva, demand.contractDemandKva * (contractFloorPct / 100));
    }
  }

  if (demand.basis === 'ratchet' && demand.ratchet) {
    const ratchetFloorKw = (ctx.ratchetLookbackPeakKw ?? 0) * (demand.ratchet.ratchetPct / 100);
    billedKw = Math.max(billedKw, ratchetFloorKw);
    if (billedKva !== undefined && ctx.ratchetLookbackPeakKva !== undefined) {
      billedKva = Math.max(billedKva, ctx.ratchetLookbackPeakKva * (demand.ratchet.ratchetPct / 100));
    }
  }

  if (demand.basis === 'month_to_date_peak') {
    billedKw = Math.max(measuredMaxKw, ctx.existingMonthToDatePeakKw ?? 0);
    if (billedKva !== undefined) {
      billedKva = Math.max(billedKva, ctx.existingMonthToDatePeakKva ?? 0);
    }
    if (ctx.existingMonthToDatePeakKw !== undefined) {
      warnings.push({
        code: 'DEMAND_SCOPE_MONTH_TO_DATE',
        level: 'info',
        message: 'Billed demand reflects the month-to-date peak (existing recorded peak plus any new peak in this horizon), not a full-month guarantee if the evaluation horizon is shorter than the billing cycle.'
      });
    }
  }

  const unit = demand.ratePerKva !== undefined ? 'kVA' : 'kW';
  const rate = demand.ratePerKva ?? demand.ratePerKw ?? 0;
  const quantity = unit === 'kVA' ? (billedKva ?? billedKw) : billedKw;
  const amount = quantity * rate;

  breakdown.push({
    label: `Demand charge (${demand.basis})`,
    quantity,
    unit,
    rate,
    amount
  });

  return { billedDemandKw: billedKw, billedDemandKva: billedKva, totalAmount: amount, breakdown, warnings };
}

function calculateTodDemandCharges(
  intervals: BillingInterval[],
  demand: DemandChargeDefinition,
  ctx: DemandChargeContext,
  useField: 'baselineGridImportKw' | 'postBessGridImportKw'
): DemandChargeResult {
  const breakdown: ChargeLine[] = [];
  const warnings: BillingWarning[] = [];
  let totalAmount = 0;
  let overallBilledKw = 0;
  let overallBilledKva: number | undefined = 0;

  for (const todDemand of demand.todDemandCharges ?? []) {
    const matched = intervals.filter(inv => {
      const period = resolveTodPeriod(inv.timestamp, ctx.timezone, {
        type: 'tod',
        todPeriods: [{ id: todDemand.id, name: todDemand.name, startTime: todDemand.startTime, endTime: todDemand.endTime, ratePerKwh: 0, schedule: todDemand.schedule }]
      });
      return period !== undefined;
    });
    const { maxKw, maxKva } = maximumDemand(matched.map(inv => ({
      windowStart: inv.timestamp,
      avgImportKw: inv[useField],
      avgImportKva: useField === 'baselineGridImportKw' ? inv.baselineGridImportKva : inv.postBessGridImportKva
    })));

    const unit = todDemand.ratePerKva !== undefined ? 'kVA' : 'kW';
    const rate = todDemand.ratePerKva ?? todDemand.ratePerKw ?? 0;
    const quantity = unit === 'kVA' ? (maxKva ?? maxKw) : maxKw;
    const amount = quantity * rate;
    totalAmount += amount;
    overallBilledKw = Math.max(overallBilledKw, maxKw);
    if (maxKva !== undefined) overallBilledKva = Math.max(overallBilledKva ?? 0, maxKva);

    breakdown.push({
      label: `TOD demand charge — ${todDemand.name}`,
      quantity,
      unit,
      rate,
      amount
    });
  }

  return { billedDemandKw: overallBilledKw, billedDemandKva: overallBilledKva, totalAmount, breakdown, warnings };
}
