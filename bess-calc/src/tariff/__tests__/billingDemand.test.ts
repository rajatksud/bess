import { describe, it, expect } from 'vitest';
import { aggregateDemandWindows, maximumDemand } from '../billingDemand';
import { validateDemandIntegrationCompatibility } from '../validation';
import { makeFlatIntervals } from './fixtures';

describe('demand integration window aggregation', () => {
  it('energy-weight-averages 15-minute intervals into a 30-minute window', () => {
    // Two 15-min intervals within the same 30-min window: 100kW then 200kW -> avg 150kW.
    const intervals = [
      { timestamp: '2024-06-15T00:00:00.000Z', durationHours: 0.25, baselineGridImportKw: 100, postBessGridImportKw: 100 },
      { timestamp: '2024-06-15T00:15:00.000Z', durationHours: 0.25, baselineGridImportKw: 200, postBessGridImportKw: 200 }
    ];
    const windows = aggregateDemandWindows(intervals, 30, 'postBessGridImportKw');
    expect(windows.length).toBe(1);
    expect(windows[0].avgImportKw).toBeCloseTo(150, 5);
  });

  it('reports the maximum across aggregated windows', () => {
    const intervals = makeFlatIntervals(4, 100).concat(
      { timestamp: '2024-06-15T01:00:00.000Z', durationHours: 0.25, baselineGridImportKw: 300, postBessGridImportKw: 300 }
    );
    const windows = aggregateDemandWindows(intervals, 15, 'postBessGridImportKw');
    const { maxKw } = maximumDemand(windows);
    expect(maxKw).toBeCloseTo(300, 5);
  });
});

describe('demand integration cadence validation', () => {
  it('passes with no warnings when source cadence equals the integration window', () => {
    const warnings = validateDemandIntegrationCompatibility(30, 30);
    expect(warnings.length).toBe(0);
  });

  it('flags a required aggregation step (info) when cadence evenly divides the window', () => {
    const warnings = validateDemandIntegrationCompatibility(15, 30);
    expect(warnings.some(w => w.code === 'DEMAND_AGGREGATION_REQUIRED' && w.level === 'info')).toBe(true);
  });

  it('errors when cadence does not evenly divide the window', () => {
    const warnings = validateDemandIntegrationCompatibility(20, 30);
    expect(warnings.some(w => w.code === 'CADENCE_DOES_NOT_DIVIDE_WINDOW' && w.level === 'error')).toBe(true);
  });

  it('errors when source cadence is coarser than the integration window (cannot substitute an instantaneous reading)', () => {
    const warnings = validateDemandIntegrationCompatibility(60, 30);
    expect(warnings.some(w => w.code === 'CADENCE_COARSER_THAN_WINDOW' && w.level === 'error')).toBe(true);
  });
});
