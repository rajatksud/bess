import { BillingInterval } from './types';

export interface AggregatedDemandWindow {
  windowStart: string;
  /** Energy-weighted average import kW across the source intervals within this window. */
  avgImportKw: number;
  avgImportKva?: number;
}

/**
 * Aggregates source-cadence BillingInterval[] into demandIntegrationWindowMinutes-wide
 * windows using energy-weighted averaging: sum(kW * durationHours) / sum(durationHours)
 * per window. Callers must have already confirmed (via validateDemandIntegrationCompatibility)
 * that sourceCadenceMinutes evenly divides the window; this function does not re-check.
 */
export function aggregateDemandWindows(
  intervals: BillingInterval[],
  demandIntegrationWindowMinutes: number,
  useField: 'baselineGridImportKw' | 'postBessGridImportKw' = 'postBessGridImportKw'
): AggregatedDemandWindow[] {
  if (intervals.length === 0) return [];

  const windowMs = demandIntegrationWindowMinutes * 60 * 1000;
  const windows = new Map<number, { energyKwh: number; durationHours: number; kvaEnergyKwh: number; hasKva: boolean }>();

  for (const inv of intervals) {
    const t = Date.parse(inv.timestamp);
    const windowKey = Math.floor(t / windowMs) * windowMs;
    const kw = inv[useField];
    const kva = useField === 'baselineGridImportKw' ? inv.baselineGridImportKva : inv.postBessGridImportKva;

    const existing = windows.get(windowKey) ?? { energyKwh: 0, durationHours: 0, kvaEnergyKwh: 0, hasKva: kva !== undefined };
    existing.energyKwh += kw * inv.durationHours;
    existing.durationHours += inv.durationHours;
    if (kva !== undefined) {
      existing.kvaEnergyKwh += kva * inv.durationHours;
    } else {
      existing.hasKva = false;
    }
    windows.set(windowKey, existing);
  }

  return Array.from(windows.entries())
    .sort(([a], [b]) => a - b)
    .map(([windowKey, agg]) => ({
      windowStart: new Date(windowKey).toISOString(),
      avgImportKw: agg.durationHours > 0 ? agg.energyKwh / agg.durationHours : 0,
      avgImportKva: agg.hasKva && agg.durationHours > 0 ? agg.kvaEnergyKwh / agg.durationHours : undefined
    }));
}

/** Maximum demand across a set of aggregated windows, in kW and (if available) kVA. */
export function maximumDemand(windows: AggregatedDemandWindow[]): { maxKw: number; maxKva?: number } {
  let maxKw = 0;
  let maxKva: number | undefined;
  let sawKva = windows.length > 0;
  for (const w of windows) {
    if (w.avgImportKw > maxKw) maxKw = w.avgImportKw;
    if (w.avgImportKva === undefined) {
      sawKva = false;
    } else if (maxKva === undefined || w.avgImportKva > maxKva) {
      maxKva = w.avgImportKva;
    }
  }
  return { maxKw, maxKva: sawKva ? maxKva : undefined };
}
