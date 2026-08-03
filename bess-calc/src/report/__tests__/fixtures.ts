import { runIntervalDispatch } from '../../engine/dispatchEngine';
import { calculateFinancialMetrics } from '../../engine/financialEngine';
import { validateBessConfig, validateSimulationResult } from '../../engine/validationEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from '../../engine/__tests__/fixtures';
import { SimulationResult } from '../../types/bess';

/** Builds a small, real (fully engine-computed, no shortcuts) SimulationResult for report-model tests. */
export function makeSimulationResult(): SimulationResult {
  const system = makeSystem({ ratedPowerKw: 250, ratedEnergyKwh: 500, initialSocPct: 100, minSocPct: 10, reserveSocPct: 0, maxSocPct: 100 });
  const tariff = makeTariff({ powerFactor: 1, demandChargePerKvaMonth: 400, contractDemandKva: 600, minimumBillingDemandPct: 0, enableTou: false });
  const diesel = makeDiesel({ enableDieselDisplacement: false });
  const solar = makeSolar({ enableSolarIntegration: false });
  const financial = makeFinancial();
  const priorities: SimulationResult['dispatchPriorities'] = ['peak_shaving'];

  const intervals = [
    ...Array.from({ length: 40 }, (_, i) => makeInterval({ intervalIndex: i, loadKw: 200, loadKva: 200, gridAvailable: true })),
    makeInterval({ intervalIndex: 40, loadKw: 500, loadKva: 500, gridAvailable: true }),
    ...Array.from({ length: 55 }, (_, i) => makeInterval({ intervalIndex: i + 41, loadKw: 200, loadKva: 200, gridAvailable: true }))
  ];

  const { warnings: configWarnings, confidenceGrade, gradeReason } = validateBessConfig(system, tariff, diesel, solar, financial, 'interval');
  const { simulatedIntervals, savings, technical } = runIntervalDispatch(intervals, system, tariff, diesel, solar, financial, priorities, 15);
  const financialResult = calculateFinancialMetrics(savings, technical, financial, system);
  const simulationWarnings = validateSimulationResult(simulatedIntervals, system, diesel, solar, savings, technical, financialResult, 15);

  return {
    mode: 'interval',
    confidenceGrade,
    confidenceGradeReason: gradeReason,
    system,
    tariff,
    diesel,
    solar,
    financialInput: financial,
    dispatchPriorities: priorities,
    savings,
    technical,
    financial: financialResult,
    warnings: [...configWarnings, ...simulationWarnings],
    intervals: simulatedIntervals
  };
}
