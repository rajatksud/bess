import { IntervalRecordImport, ImportWarning } from './types';

export interface CadenceDetectionResult {
  intervalDurationMinutes?: number;
  isRegular: boolean;
  warnings: ImportWarning[];
}

const SUPPORTED_CADENCES_MINUTES = [15, 30, 60];

/** Detects the interval cadence from consecutive timestamp gaps and checks it against supported cadences. */
export function detectCadence(records: IntervalRecordImport[], allowIrregular: boolean): CadenceDetectionResult {
  if (records.length < 2) {
    return { intervalDurationMinutes: undefined, isRegular: true, warnings: [] };
  }

  const gapsMinutes: number[] = [];
  for (let i = 1; i < records.length; i++) {
    const prevMs = Date.parse(records[i - 1].timestamp);
    const curMs = Date.parse(records[i].timestamp);
    gapsMinutes.push((curMs - prevMs) / 60000);
  }

  const roundedGaps = gapsMinutes.map(g => Math.round(g * 100) / 100);
  const distinctGaps = Array.from(new Set(roundedGaps));
  const warnings: ImportWarning[] = [];

  if (distinctGaps.length === 1) {
    const gap = distinctGaps[0];
    if (!SUPPORTED_CADENCES_MINUTES.includes(gap)) {
      warnings.push({
        code: 'UNSUPPORTED_CADENCE',
        message: `Detected a uniform ${gap}-minute interval cadence, which is outside the supported set (15/30/60 minutes).`
      });
    }
    return { intervalDurationMinutes: gap, isRegular: true, warnings };
  }

  // Multiple distinct gaps observed. The modal (most frequent) gap is treated as the
  // detected cadence; any other observed gap that is an exact positive-integer
  // multiple of it is a MISSING INTERVAL (a real, if incomplete, regular series), not
  // "irregular cadence". A gap that is NOT a clean multiple of the modal cadence (e.g.
  // a 20-minute gap in an otherwise 15-minute series) is genuinely irregular.
  const gapCounts = new Map<number, number>();
  for (const g of roundedGaps) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
  const modalGap = Array.from(gapCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];

  const nonMultipleGaps = distinctGaps.filter(g => g !== modalGap && (g <= 0 || Math.abs(g / modalGap - Math.round(g / modalGap)) > 1e-6));

  if (nonMultipleGaps.length === 0) {
    if (!SUPPORTED_CADENCES_MINUTES.includes(modalGap)) {
      warnings.push({
        code: 'UNSUPPORTED_CADENCE',
        message: `Detected a ${modalGap}-minute interval cadence (with gaps), which is outside the supported set (15/30/60 minutes).`
      });
    }
    return { intervalDurationMinutes: modalGap, isRegular: true, warnings };
  }

  // Genuinely mixed/irregular cadence detected.
  if (!allowIrregular) {
    warnings.push({
      code: 'MIXED_CADENCE_REJECTED',
      message: `Mixed interval cadence detected (${distinctGaps.join(', ')} minutes). Set allowIrregular=true to accept irregular cadence data, which will be marked non-engineering-grade.`
    });
    return { intervalDurationMinutes: undefined, isRegular: false, warnings };
  }

  warnings.push({
    code: 'MIXED_CADENCE_ACCEPTED',
    message: `Mixed interval cadence detected (${distinctGaps.join(', ')} minutes) and accepted because allowIrregular=true. This dataset is NOT engineering-grade for demand-charge or peak-shaving calculations.`
  });
  return { intervalDurationMinutes: undefined, isRegular: false, warnings };
}

/** Detects gaps in an otherwise-regular cadence series (missing intervals). */
export function detectMissingIntervals(records: IntervalRecordImport[], intervalDurationMinutes: number): number {
  if (records.length < 2 || intervalDurationMinutes <= 0) return 0;
  let missing = 0;
  for (let i = 1; i < records.length; i++) {
    const prevMs = Date.parse(records[i - 1].timestamp);
    const curMs = Date.parse(records[i].timestamp);
    const expectedGapMs = intervalDurationMinutes * 60000;
    const gapMs = curMs - prevMs;
    if (gapMs > expectedGapMs) {
      const missedSteps = Math.round(gapMs / expectedGapMs) - 1;
      if (missedSteps > 0) missing += missedSteps;
    }
  }
  return missing;
}
