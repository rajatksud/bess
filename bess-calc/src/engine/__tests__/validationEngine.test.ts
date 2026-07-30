import { describe, it, expect } from 'vitest';
import { validateBessConfig, validateSimulationResult } from '../validationEngine';
import { runIntervalDispatch } from '../dispatchEngine';
import { calculateFinancialMetrics } from '../financialEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval, makeFlatDay } from './fixtures';

describe('validateBessConfig (static input checks)', () => {
  it('flags non-positive rated power and energy as errors', () => {
    const { warnings } = validateBessConfig(
      makeSystem({ ratedPowerKw: 0, ratedEnergyKwh: -10 }),
      makeTariff(), makeDiesel(), makeSolar(), makeFinancial(), 'interval'
    );
    expect(warnings.some(w => w.code === 'INVALID_POWER' && w.level === 'error')).toBe(true);
    expect(warnings.some(w => w.code === 'INVALID_CAPACITY' && w.level === 'error')).toBe(true);
  });

  it('flags inverted SOC bounds', () => {
    const { warnings } = validateBessConfig(
      makeSystem({ minSocPct: 90, maxSocPct: 20 }),
      makeTariff(), makeDiesel(), makeSolar(), makeFinancial(), 'interval'
    );
    expect(warnings.some(w => w.code === 'SOC_BOUNDS_INVALID')).toBe(true);
  });

  it('assigns confidence grade A to interval mode, C to quick, D to legacy', () => {
    const base = [makeSystem(), makeTariff(), makeDiesel(), makeSolar(), makeFinancial()] as const;
    expect(validateBessConfig(...base, 'interval').confidenceGrade).toBe('A');
    expect(validateBessConfig(...base, 'quick').confidenceGrade).toBe('C');
    expect(validateBessConfig(...base, 'legacy').confidenceGrade).toBe('D');
  });

  it('flags legacy mode as an unconstrained sales-pitch calculation', () => {
    const { warnings } = validateBessConfig(
      makeSystem(), makeTariff(), makeDiesel(), makeSolar(), makeFinancial(), 'legacy'
    );
    expect(warnings.some(w => w.code === 'UNCONSTRAINED_SALES_PITCH' && w.level === 'error')).toBe(true);
  });
});

describe('validateSimulationResult (post-simulation output checks)', () => {
  function runReferenceCase() {
    const system = makeSystem();
    const tariff = makeTariff();
    const diesel = makeDiesel();
    const solar = makeSolar();
    const financial = makeFinancial();
    const intervals = makeFlatDay({ loadKw: 150, solarKw: 50, gridAvailable: true });

    const { simulatedIntervals, savings, technical } = runIntervalDispatch(
      intervals, system, tariff, diesel, solar, financial,
      ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'],
      15
    );
    const financialResult = calculateFinancialMetrics(savings, technical, financial, system);
    return { system, diesel, solar, simulatedIntervals, savings, technical, financialResult };
  }

  it('produces no physical-consistency errors for a well-formed reference-case simulation', () => {
    const { system, diesel, solar, simulatedIntervals, savings, technical, financialResult } = runReferenceCase();

    const warnings = validateSimulationResult(simulatedIntervals, system, diesel, solar, savings, technical, financialResult, 15);

    const physicalErrors = warnings.filter(w => w.category === 'physical' && w.level === 'error');
    expect(physicalErrors).toEqual([]);
  });

  it('flags SOC_BELOW_MIN when a simulated interval reports SOC under the configured minimum', () => {
    const system = makeSystem({ minSocPct: 10, maxSocPct: 100 });
    const diesel = makeDiesel();
    const solar = makeSolar();
    const financial = makeFinancial();
    // Hand-craft an interval list with a corrupted SOC trace (as if a future dispatch
    // bug clamped incorrectly) rather than relying on the engine to produce this state.
    const intervals = [makeInterval({ bessSocPct: 5, bessPowerKw: 10 })];
    const { savings, technical } = runIntervalDispatch(intervals, system, makeTariff(), diesel, solar, financial, ['backup_reserve'], 15);
    // Force the corrupted trace directly to test the validator in isolation from the engine.
    const corruptedIntervals = intervals.map(inv => ({ ...inv, bessSocPct: 5 }));
    const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

    const warnings = validateSimulationResult(corruptedIntervals, system, diesel, solar, savings, technical, financialResult, 15);

    expect(warnings.some(w => w.code === 'SOC_BELOW_MIN')).toBe(true);
  });

  it('flags DISCHARGE_EXCEEDS_RATED_POWER when an interval reports power above the PCS rating', () => {
    const system = makeSystem({ ratedPowerKw: 100 });
    const diesel = makeDiesel();
    const solar = makeSolar();
    const financial = makeFinancial();
    const intervals = [makeInterval({ bessPowerKw: 150, bessSocPct: 80 })];
    const { savings, technical } = runIntervalDispatch(intervals, system, makeTariff(), diesel, solar, financial, [], 15);
    const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

    const warnings = validateSimulationResult(intervals, system, diesel, solar, savings, technical, financialResult, 15);

    expect(warnings.some(w => w.code === 'DISCHARGE_EXCEEDS_RATED_POWER')).toBe(true);
  });

  it('flags DIESEL_SAVING_EXCEEDS_DG_OPERATION when diesel savings are fabricated beyond the DG-required profile', () => {
    const system = makeSystem();
    const diesel = makeDiesel();
    const solar = makeSolar({ enableSolarIntegration: false });
    const financial = makeFinancial();
    // No interval ever required DG (dgRequiredKw = 0 everywhere), yet technical result
    // claims displaced DG energy - simulates a dispatch/attribution bug.
    const intervals = makeFlatDay({ loadKw: 50, gridAvailable: true, dgRequiredKw: 0 });
    const { savings, technical } = runIntervalDispatch(intervals, system, makeTariff(), diesel, solar, financial, [], 15);
    const fabricatedTechnical = { ...technical, dgEnergyDisplacedKwh: 100000 };
    const financialResult = calculateFinancialMetrics(savings, fabricatedTechnical, financial, system);

    const warnings = validateSimulationResult(intervals, system, diesel, solar, savings, fabricatedTechnical, financialResult, 15);

    expect(warnings.some(w => w.code === 'DIESEL_SAVING_EXCEEDS_DG_OPERATION')).toBe(true);
  });

  it('flags PAYBACK_WITH_NONPOSITIVE_SAVINGS when a payback figure exists despite non-positive net savings', () => {
    const system = makeSystem();
    const diesel = makeDiesel({ enableDieselDisplacement: false });
    const solar = makeSolar({ enableSolarIntegration: false });
    const financial = makeFinancial();
    const intervals = makeFlatDay({ loadKw: 10, gridAvailable: true });
    const { savings, technical } = runIntervalDispatch(intervals, system, makeTariff(), diesel, solar, financial, [], 15);
    const negativeSavings = { ...savings, netOperatingSaving: -1000 };
    const financialResult = { ...calculateFinancialMetrics(negativeSavings, technical, financial, system), simplePaybackYears: 5 };

    const warnings = validateSimulationResult(intervals, system, diesel, solar, negativeSavings, technical, financialResult, 15);

    expect(warnings.some(w => w.code === 'PAYBACK_WITH_NONPOSITIVE_SAVINGS')).toBe(true);
  });
});
