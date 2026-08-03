import { describe, it, expect } from 'vitest';
import { extractHalfCycles, equivalentFullCycles } from '../cycleCounting';

describe('extractHalfCycles', () => {
  it('returns no half-cycles for a flat trace', () => {
    expect(extractHalfCycles([50, 50, 50])).toEqual([]);
  });

  it('returns no half-cycles for fewer than 2 points', () => {
    expect(extractHalfCycles([50])).toEqual([]);
  });

  it('extracts a single half-cycle for a monotonic discharge', () => {
    const halfCycles = extractHalfCycles([90, 70, 50, 30]);
    expect(halfCycles).toEqual([{ fromSocPct: 90, toSocPct: 30, depthOfDischargePct: 60 }]);
  });

  it('extracts two half-cycles for one full discharge-charge swing', () => {
    const halfCycles = extractHalfCycles([90, 50, 90]);
    expect(halfCycles).toEqual([
      { fromSocPct: 90, toSocPct: 50, depthOfDischargePct: 40 },
      { fromSocPct: 50, toSocPct: 90, depthOfDischargePct: 40 }
    ]);
  });

  it('detects a reversal at a peak/trough and starts a new segment', () => {
    const halfCycles = extractHalfCycles([80, 60, 40, 60, 80, 50]);
    expect(halfCycles).toEqual([
      { fromSocPct: 80, toSocPct: 40, depthOfDischargePct: 40 },
      { fromSocPct: 40, toSocPct: 80, depthOfDischargePct: 40 },
      { fromSocPct: 80, toSocPct: 50, depthOfDischargePct: 30 }
    ]);
  });
});

describe('equivalentFullCycles', () => {
  it('returns 0 for no half-cycles', () => {
    expect(equivalentFullCycles([])).toBe(0);
  });

  it('counts two 100%-DoD half-cycles as one equivalent full cycle', () => {
    const halfCycles = [
      { fromSocPct: 100, toSocPct: 0, depthOfDischargePct: 100 },
      { fromSocPct: 0, toSocPct: 100, depthOfDischargePct: 100 }
    ];
    expect(equivalentFullCycles(halfCycles, 100)).toBeCloseTo(1, 10);
  });

  it('deeper cycles contribute more equivalent full cycles than shallower ones for the same half-cycle count', () => {
    const shallow = [
      { fromSocPct: 60, toSocPct: 50, depthOfDischargePct: 10 },
      { fromSocPct: 50, toSocPct: 60, depthOfDischargePct: 10 }
    ];
    const deep = [
      { fromSocPct: 90, toSocPct: 10, depthOfDischargePct: 80 },
      { fromSocPct: 10, toSocPct: 90, depthOfDischargePct: 80 }
    ];
    expect(equivalentFullCycles(deep, 100)).toBeGreaterThan(equivalentFullCycles(shallow, 100));
  });

  it('throws for a non-positive referenceDodPct', () => {
    expect(() => equivalentFullCycles([], 0)).toThrow();
  });
});
