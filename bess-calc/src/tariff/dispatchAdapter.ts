import { IntervalRecord } from '../types/bess';
import { BillingInterval } from './types';

/**
 * Adapts dispatch-engine IntervalRecord[] output into the tariff engine's
 * BillingInterval[] boundary. Deliberately the ONLY place the tariff engine touches
 * dispatch internals — keeps the two engines decoupled per the tariff engine design.
 *
 * `startTimestamp` anchors intervalIndex 0; each subsequent interval is offset by
 * `intervalMinutes`. `timeLabel` alone is not sufficient to build an ISO timestamp
 * (no date), so callers must supply a real calendar anchor for TOD/seasonal resolution.
 */
export function toBillingIntervals(
  intervals: IntervalRecord[],
  startTimestamp: string,
  intervalMinutes: number
): BillingInterval[] {
  const startMs = Date.parse(startTimestamp);
  const durationHours = intervalMinutes / 60;

  return intervals.map(inv => ({
    timestamp: new Date(startMs + inv.intervalIndex * intervalMinutes * 60 * 1000).toISOString(),
    durationHours,
    baselineGridImportKw: inv.preBessGridImportKw,
    postBessGridImportKw: inv.postBessGridImportKw,
    baselineGridImportKva: inv.preBessGridImportKva,
    postBessGridImportKva: inv.postBessGridImportKva,
    baselineGridExportKw: 0, // pre-BESS export is not modelled separately upstream (Objective A scope)
    postBessGridExportKw: inv.gridExportKw
  }));
}
