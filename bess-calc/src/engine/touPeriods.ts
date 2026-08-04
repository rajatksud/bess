import { TariffInput, TouPeriod, TouPeriodKind } from '../types/bess';

/**
 * Time-of-Use period matching and classification.
 *
 * Two concerns live here, both previously duplicated or hard-coded at call sites:
 *
 * 1. MATCHING a clock time to a configured period, including periods that wrap past
 *    midnight (a night rebate of 22:00-06:00 is the normal shape of an Indian C&I
 *    night slab, and the previous inline matchers - presetProfiles.ts and
 *    toEngineIntervals.ts - both compared `mins >= start && mins < end`, which silently
 *    matched NOTHING for a wrapping window).
 *
 * 2. CLASSIFYING a period as peak / standard / off-peak so the dispatch engine can act
 *    on it. This used to be inferred from the period NAME ('Peak Surge') or from a
 *    +/-20% rate threshold against the base energy charge. Both are brittle: a tariff
 *    modelled as a modest per-kWh delta - e.g. a Rs 1 night rebate and Rs 1 peak
 *    surcharge on a Rs 9.5 base, which is only -/+10.5% - clears neither threshold, so
 *    a perfectly real TOU spread would have driven no battery dispatch at all unless
 *    the periods happened to carry the exact magic names.
 *
 * Classification precedence: an explicit `TouPeriod.kind` always wins; otherwise the
 * period is classified by its rate relative to `TariffInput.energyChargePerKwh` -
 * dearer than base is peak, cheaper than base is off-peak, equal is standard. That
 * makes an arbitrarily small surcharge or rebate actionable while keeping a flat rate
 * correctly inert.
 */

/** Rates within this many currency units of each other are treated as equal. */
const RATE_EPSILON = 1e-9;

/** Parses "HH:MM" into minutes past midnight. Returns NaN for unparseable input. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/**
 * True when `minuteOfDay` falls inside the period, handling windows that wrap past
 * midnight (start > end, e.g. 22:00-06:00). Half-open [start, end) so adjacent
 * periods never both match a boundary minute.
 */
export function isWithinTouPeriod(minuteOfDay: number, period: TouPeriod): boolean {
  const start = toMinutes(period.startTime);
  const end = toMinutes(period.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;

  // A period ending at exactly its start time (or 24:00 written as 00:00) covers the
  // whole day rather than nothing.
  if (start === end) return true;

  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end; // wraps past midnight
}

/** The configured period active at `minuteOfDay`, or undefined when none matches. */
export function findTouPeriod(minuteOfDay: number, tariff: TariffInput): TouPeriod | undefined {
  if (!tariff.enableTou || tariff.touPeriods.length === 0) return undefined;
  return tariff.touPeriods.find(p => isWithinTouPeriod(minuteOfDay, p));
}

/**
 * Resolves the import rate, period name and dispatch-relevant kind for a clock time.
 * Falls back to the flat energy charge (classified 'standard') when TOU is disabled or
 * no period covers the time.
 */
export function resolveTouRate(
  minuteOfDay: number,
  tariff: TariffInput
): { importRatePerKwh: number; periodName: string; kind: TouPeriodKind } {
  const period = findTouPeriod(minuteOfDay, tariff);
  if (!period) {
    return { importRatePerKwh: tariff.energyChargePerKwh, periodName: 'Standard', kind: 'standard' };
  }
  return {
    importRatePerKwh: period.importRatePerKwh,
    periodName: period.name,
    kind: classifyTouRate(period.importRatePerKwh, tariff.energyChargePerKwh, period.kind)
  };
}

/**
 * Classifies an import rate against the base energy charge. An explicit `declaredKind`
 * (from TouPeriod.kind) always wins, so an operator can mark a period as peak even when
 * its rate happens to equal the base.
 */
export function classifyTouRate(
  importRatePerKwh: number,
  baseEnergyChargePerKwh: number,
  declaredKind?: TouPeriodKind
): TouPeriodKind {
  if (declaredKind) return declaredKind;
  if (importRatePerKwh > baseEnergyChargePerKwh + RATE_EPSILON) return 'peak';
  if (importRatePerKwh < baseEnergyChargePerKwh - RATE_EPSILON) return 'off_peak';
  return 'standard';
}

/** Highest import rate anywhere in the tariff (base charge included). */
export function peakImportRate(tariff: TariffInput): number {
  if (!tariff.enableTou || tariff.touPeriods.length === 0) return tariff.energyChargePerKwh;
  return Math.max(tariff.energyChargePerKwh, ...tariff.touPeriods.map(p => p.importRatePerKwh));
}

/** Lowest import rate anywhere in the tariff (base charge included). */
export function offPeakImportRate(tariff: TariffInput): number {
  if (!tariff.enableTou || tariff.touPeriods.length === 0) return tariff.energyChargePerKwh;
  return Math.min(tariff.energyChargePerKwh, ...tariff.touPeriods.map(p => p.importRatePerKwh));
}

/**
 * Whether charging from the grid off-peak to discharge on-peak is economic at all.
 *
 * Storing a kWh loses (1 - etaCharge * etaDischarge) of it to round-trip losses, so a
 * kWh bought at `offPeakRate` costs `offPeakRate / (etaCharge * etaDischarge)` by the
 * time it is delivered. Arbitrage only creates value when the peak rate exceeds that.
 * Without this guard a narrow spread - which is exactly what a modest per-kWh
 * surcharge/rebate produces - would drive cycling that destroys value on every kWh.
 */
export function isArbitrageEconomic(
  peakRatePerKwh: number,
  offPeakRatePerKwh: number,
  etaCharge: number,
  etaDischarge: number
): boolean {
  const roundTripEfficiency = etaCharge * etaDischarge;
  if (roundTripEfficiency <= 0) return false;
  return peakRatePerKwh > offPeakRatePerKwh / roundTripEfficiency;
}
