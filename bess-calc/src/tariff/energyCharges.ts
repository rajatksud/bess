import { BillingInterval, EnergyChargeDefinition, ChargeLine, TodRatePeriod } from './types';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function monthInSeason(month: number, startMonth: number, endMonth: number): boolean {
  if (startMonth <= endMonth) return month >= startMonth && month <= endMonth;
  // Wraps across year end, e.g. Nov(11) - Feb(2).
  return month >= startMonth || month <= endMonth;
}

/** Resolves the applicable TOD period for a given ISO timestamp, or undefined if none matches. */
export function resolveTodPeriod(
  timestampIso: string,
  timezone: string,
  energyCharges: EnergyChargeDefinition
): TodRatePeriod | undefined {
  if (energyCharges.type !== 'tod' || !energyCharges.todPeriods) return undefined;

  const date = new Date(timestampIso);
  // Timezone-aware resolution: use Intl to get the wall-clock parts in the tariff's IANA
  // timezone rather than the host's local time or UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    month: '2-digit'
  }).formatToParts(date);

  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  const month = Number(parts.find(p => p.type === 'month')?.value ?? '1');
  const weekdayShort = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[weekdayShort] ?? 0;
  const minutesOfDay = hour === 24 ? 0 : hour * 60 + minute;

  for (const period of energyCharges.todPeriods) {
    if (period.schedule && !period.schedule.applicableDays.includes(dayOfWeek)) continue;
    if (period.seasonId) {
      const season = energyCharges.seasons?.find(s => s.id === period.seasonId);
      if (season && !monthInSeason(month, season.startMonth, season.endMonth)) continue;
    }
    const startMin = timeToMinutes(period.startTime);
    const endMin = timeToMinutes(period.endTime);
    const inRange = startMin <= endMin
      ? minutesOfDay >= startMin && minutesOfDay < endMin
      : minutesOfDay >= startMin || minutesOfDay < endMin; // wraps past midnight
    if (inRange) return period;
  }
  return undefined;
}

export interface EnergyChargeResult {
  totalKwh: number;
  totalAmount: number;
  breakdown: ChargeLine[];
}

/** Computes energy charges for a series of intervals, using the given import-kW field. */
export function calculateEnergyCharges(
  intervals: BillingInterval[],
  energyCharges: EnergyChargeDefinition,
  timezone: string,
  useField: 'baselineGridImportKw' | 'postBessGridImportKw' = 'postBessGridImportKw'
): EnergyChargeResult {
  if (energyCharges.type === 'flat') {
    const rate = energyCharges.flatRatePerKwh ?? 0;
    const totalKwh = intervals.reduce((sum, inv) => sum + inv[useField] * inv.durationHours, 0);
    const totalAmount = totalKwh * rate;
    return {
      totalKwh,
      totalAmount,
      breakdown: [{ label: 'Flat energy charge', quantity: totalKwh, unit: 'kWh', rate, amount: totalAmount }]
    };
  }

  // TOD: accumulate kWh per period.
  const perPeriodKwh = new Map<string, { name: string; rate: number; kwh: number }>();
  let unmatchedKwh = 0;
  const fallbackRate = energyCharges.todPeriods?.[0]?.ratePerKwh ?? 0;

  for (const inv of intervals) {
    const kwh = inv[useField] * inv.durationHours;
    const period = resolveTodPeriod(inv.timestamp, timezone, energyCharges);
    if (!period) {
      unmatchedKwh += kwh;
      continue;
    }
    const existing = perPeriodKwh.get(period.id) ?? { name: period.name, rate: period.ratePerKwh, kwh: 0 };
    existing.kwh += kwh;
    perPeriodKwh.set(period.id, existing);
  }

  const breakdown: ChargeLine[] = Array.from(perPeriodKwh.values()).map(p => ({
    label: `TOD energy charge — ${p.name}`,
    quantity: p.kwh,
    unit: 'kWh',
    rate: p.rate,
    amount: p.kwh * p.rate
  }));

  if (unmatchedKwh > 0) {
    breakdown.push({
      label: 'Energy charge — unmatched TOD period (fallback rate)',
      quantity: unmatchedKwh,
      unit: 'kWh',
      rate: fallbackRate,
      amount: unmatchedKwh * fallbackRate
    });
  }

  const totalKwh = breakdown.reduce((s, l) => s + l.quantity, 0);
  const totalAmount = breakdown.reduce((s, l) => s + l.amount, 0);
  return { totalKwh, totalAmount, breakdown };
}
