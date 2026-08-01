// Simplified DoD-bin cycle counting from an interval SOC trace.
//
// A full rainflow algorithm identifies nested partial cycles from arbitrary
// oscillation; this is a documented simplified equivalent suited to the dispatch
// engine's per-interval SOC trace: it tracks direction reversals (peak/trough
// detection) and records each peak-to-trough (or trough-to-peak) excursion as one
// half-cycle at that excursion's depth of discharge. This under-counts small nested
// oscillations within a larger swing (true rainflow would separate them out), which
// is a conservative simplification for degradation estimation purposes - it will
// slightly undercount low-DoD nested cycling, not overcount ageing.
export interface HalfCycle {
  fromSocPct: number;
  toSocPct: number;
  depthOfDischargePct: number;
}

/**
 * Extracts half-cycles (SOC direction reversals) from a chronological SOC trace.
 * Flat runs (no change) are ignored; only actual reversals produce a half-cycle.
 */
export function extractHalfCycles(socTracePct: number[]): HalfCycle[] {
  if (socTracePct.length < 2) return [];

  const halfCycles: HalfCycle[] = [];
  let segmentStart = socTracePct[0];
  let direction: 'up' | 'down' | null = null;

  for (let i = 1; i < socTracePct.length; i++) {
    const prev = socTracePct[i - 1];
    const curr = socTracePct[i];
    if (curr === prev) continue;

    const currentDirection = curr > prev ? 'up' : 'down';

    if (direction === null) {
      direction = currentDirection;
    } else if (currentDirection !== direction) {
      halfCycles.push({
        fromSocPct: segmentStart,
        toSocPct: prev,
        depthOfDischargePct: Math.abs(prev - segmentStart)
      });
      segmentStart = prev;
      direction = currentDirection;
    }
  }

  const last = socTracePct[socTracePct.length - 1];
  if (last !== segmentStart) {
    halfCycles.push({
      fromSocPct: segmentStart,
      toSocPct: last,
      depthOfDischargePct: Math.abs(last - segmentStart)
    });
  }

  return halfCycles;
}

/**
 * Converts half-cycles into equivalent full cycles at a reference DoD, using a
 * standard DoD-stress-weighted approach: deeper cycles consume proportionally more
 * of the rated cycle life than shallow ones (roughly linear in DoD, the common
 * simplified engineering assumption absent a manufacturer-supplied DoD-vs-cycle-life
 * curve). Two half-cycles of depth D contribute the same equivalent full-cycle count
 * as one full cycle of depth D.
 */
export function equivalentFullCycles(halfCycles: HalfCycle[], referenceDodPct = 100): number {
  if (referenceDodPct <= 0) throw new Error('referenceDodPct must be positive');
  const totalDodWeightedHalfCycles = halfCycles.reduce((sum, hc) => sum + hc.depthOfDischargePct / referenceDodPct, 0);
  return totalDodWeightedHalfCycles / 2;
}
