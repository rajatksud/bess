import { Prisma, type PrismaClient } from '@prisma/client';
import { runIntervalDispatch } from '../../src/engine/dispatchEngine';
import { runMultiYearSimulation } from '../../src/engine/multiYearSimulation';
import { calculateFinancialMetrics, DegradedYearInput } from '../../src/engine/financialEngine';
import { validateBessConfig, validateSimulationResult } from '../../src/engine/validationEngine';
import { toEngineIntervals, IntervalRecordImport } from '../../src/import';
import { SohForecast } from '../../src/battery';
import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  DispatchPriorityType,
  IntervalRecord,
  SavingsBreakdown,
  TechnicalResult,
  FinancialResult,
  ValidationWarning,
  ConfidenceGrade
} from '../../src/types/bess';
import { ApiError } from '../lib/errors';
import { CALCULATION_ENGINE_VERSION } from '../lib/version';

/**
 * The scenario run-and-persist sequence, extracted verbatim from the POST /simulations
 * route handler so that the comparison endpoint runs the SAME pipeline rather than a
 * second, drifting copy of it.
 *
 * Behaviour is unchanged from the inline version: load scenario -> 404/422 guards ->
 * load intervals -> cast JSON config columns -> toEngineIntervals -> validateBessConfig
 * -> runIntervalDispatch -> calculateFinancialMetrics -> validateSimulationResult ->
 * persist SimulationResult -> mark the SimulationRun completed (or failed).
 */

export interface RunScenarioSimulationOptions {
  /**
   * Additionally run the multi-year SOH simulation and return its forecast.
   *
   * This does NOT change what is persisted or what the single-run financial result
   * contains — the stored SimulationResult stays year-1 based exactly as before, so
   * every existing persistence test and stored row keeps its meaning. The forecast is
   * returned in-memory for callers (the comparison endpoint, the report) that need it.
   */
  includeSohForecast?: boolean;
}

export interface ScenarioSimulationOutcome {
  scenarioId: string;
  scenarioName: string;
  simulationRunId: string;
  confidenceGrade: ConfidenceGrade;
  confidenceGradeReason: string;
  system: BessSystemInput;
  tariff: TariffInput;
  diesel: DieselInput;
  solar: SolarInput;
  financialInput: FinancialInput;
  dispatchPriorities: DispatchPriorityType[];
  savings: SavingsBreakdown;
  technical: TechnicalResult;
  financial: FinancialResult;
  warnings: ValidationWarning[];
  simulatedIntervals: IntervalRecord[];
  intervalDatasetId: string;
  intervalMinutes: number;
  recordCount: number;
  /** Present only when includeSohForecast was requested. */
  sohForecast?: SohForecast;
  /** Present only when includeSohForecast was requested: the degradation-aware financial result, computed alongside (never instead of) the persisted one. */
  degradationAwareFinancial?: FinancialResult;
}

export async function runScenarioSimulation(
  prisma: PrismaClient,
  scenarioId: string,
  options: RunScenarioSimulationOptions = {}
): Promise<ScenarioSimulationOutcome> {
  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario) {
    throw new ApiError(404, 'SCENARIO_NOT_FOUND', `No scenario with id ${scenarioId}`);
  }

  if (!scenario.intervalDatasetId) {
    throw new ApiError(422, 'NO_DATASET', 'Scenario has no associated interval dataset; import one via POST /api/v1/datasets/import and attach it before running a simulation');
  }

  const datasetRecords = await prisma.intervalRecord.findMany({
    where: { datasetId: scenario.intervalDatasetId },
    orderBy: { timestamp: 'asc' }
  });

  if (datasetRecords.length === 0) {
    throw new ApiError(422, 'EMPTY_DATASET', `Interval dataset ${scenario.intervalDatasetId} has no records`);
  }

  const system = scenario.batteryConfig as unknown as BessSystemInput;
  const tariff = scenario.tariffConfig as unknown as TariffInput;
  const diesel = scenario.generatorConfig as unknown as DieselInput;
  const solar = scenario.solarConfig as unknown as SolarInput;
  const financial = scenario.financialConfig as unknown as FinancialInput;
  const priorities = scenario.dispatchPriorities as unknown as DispatchPriorityType[];

  const importRecords: IntervalRecordImport[] = datasetRecords.map((record, index) => ({
    timestamp: record.timestamp.toISOString(),
    loadKw: record.loadKw,
    loadKva: record.loadKva ?? undefined,
    powerFactor: record.powerFactor ?? undefined,
    solarKw: record.solarKw ?? undefined,
    dgKw: record.dgKw ?? undefined,
    rowNumber: index + 1
  }));

  const dataset = await prisma.intervalDataset.findUnique({ where: { id: scenario.intervalDatasetId } });
  const intervalMinutes = dataset?.intervalMinutes || 15;

  const engineIntervals = toEngineIntervals(importRecords, tariff);

  const inputSnapshot = {
    system, tariff, diesel, solar, financial,
    dispatchPriorities: priorities,
    intervalMinutes,
    mode: 'interval' as const,
    intervalDatasetId: scenario.intervalDatasetId,
    recordCount: datasetRecords.length
  };

  const run = await prisma.simulationRun.create({
    data: {
      scenarioId: scenario.id,
      engineVersion: CALCULATION_ENGINE_VERSION,
      inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
      status: 'running'
    }
  });

  try {
    const { warnings: configWarnings, confidenceGrade, gradeReason } = validateBessConfig(
      system, tariff, diesel, solar, financial, 'interval'
    );

    const { simulatedIntervals, savings, technical } = runIntervalDispatch(
      engineIntervals, system, tariff, diesel, solar, financial, priorities, intervalMinutes
    );

    const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

    const simulationWarnings = validateSimulationResult(
      simulatedIntervals, system, diesel, solar, savings, technical, financialResult, intervalMinutes
    );

    const allWarnings = [...configWarnings, ...simulationWarnings];

    await prisma.simulationResult.create({
      data: {
        simulationRunId: run.id,
        peakReductionKw: technical.peakBeforeKw - technical.peakAfterKw,
        energySavings: savings.grossSaving,
        demandSavings: savings.demandChargeSaving,
        arbitrageSavings: savings.energyArbitrageSaving,
        totalSavings: savings.netOperatingSaving,
        irr: financialResult.irrPct,
        npv: financialResult.npv,
        savingsBreakdown: savings as unknown as Prisma.InputJsonValue,
        technicalResult: technical as unknown as Prisma.InputJsonValue,
        financialResult: financialResult as unknown as Prisma.InputJsonValue,
        warnings: allWarnings as unknown as Prisma.InputJsonValue
      }
    });

    const completedRun = await prisma.simulationRun.update({
      where: { id: run.id },
      data: { status: 'completed', completedAt: new Date() }
    });

    let sohForecast: SohForecast | undefined;
    let degradationAwareFinancial: FinancialResult | undefined;
    if (options.includeSohForecast) {
      const multiYear = runMultiYearSimulation({
        intervals: engineIntervals,
        system, tariff, diesel, solar, financial,
        priorities,
        intervalMinutes
      });
      sohForecast = multiYear.sohForecast;
      const degradedYears: DegradedYearInput[] = multiYear.years.map(year => ({
        year: year.year,
        savings: year.savings,
        energyDischargedKwh: year.technical.energyDischargedKwh,
        sohPctStartOfYear: year.sohPctStartOfYear
      }));
      degradationAwareFinancial = calculateFinancialMetrics(savings, technical, financial, system, { degradedYears });
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      simulationRunId: completedRun.id,
      confidenceGrade,
      confidenceGradeReason: gradeReason,
      system, tariff, diesel, solar,
      financialInput: financial,
      dispatchPriorities: priorities,
      savings,
      technical,
      financial: financialResult,
      warnings: allWarnings,
      simulatedIntervals,
      intervalDatasetId: scenario.intervalDatasetId,
      intervalMinutes,
      recordCount: datasetRecords.length,
      sohForecast,
      degradationAwareFinancial
    };
  } catch (engineErr) {
    const message = engineErr instanceof Error ? engineErr.message : String(engineErr);
    await prisma.simulationRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorMessage: message, completedAt: new Date() }
    });
    throw engineErr;
  }
}
