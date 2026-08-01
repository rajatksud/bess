import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { runIntervalDispatch } from '../../src/engine/dispatchEngine';
import { calculateFinancialMetrics } from '../../src/engine/financialEngine';
import { validateBessConfig, validateSimulationResult } from '../../src/engine/validationEngine';
import { toEngineIntervals, IntervalRecordImport } from '../../src/import';
import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  DispatchPriorityType
} from '../../src/types/bess';
import { ApiError } from '../lib/errors';
import { CALCULATION_ENGINE_VERSION } from '../lib/version';

const createSimulationSchema = z.object({
  scenarioId: z.string().uuid()
});

/** Persistence-backed simulation workflow: loads a scenario + its dataset from the DB, runs the existing engine functions unchanged, and persists a reproducible/auditable SimulationRun + SimulationResult. Takes an injected PrismaClient so tests can point it at a test database. */
export function createSimulationsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/simulations', async (req, res, next) => {
    try {
      const body = createSimulationSchema.parse(req.body);

      const scenario = await prisma.scenario.findUnique({ where: { id: body.scenarioId } });
      if (!scenario) {
        throw new ApiError(404, 'SCENARIO_NOT_FOUND', `No scenario with id ${body.scenarioId}`);
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

        res.status(201).json({
          result: { simulationId: completedRun.id, status: completedRun.status, confidenceGrade, confidenceGradeReason: gradeReason },
          correlationId: req.correlationId
        });
      } catch (engineErr) {
        const message = engineErr instanceof Error ? engineErr.message : String(engineErr);
        await prisma.simulationRun.update({
          where: { id: run.id },
          data: { status: 'failed', errorMessage: message, completedAt: new Date() }
        });
        throw engineErr;
      }
    } catch (err) {
      next(err);
    }
  });

  router.get('/simulations/:id', async (req, res, next) => {
    try {
      const run = await prisma.simulationRun.findUnique({ where: { id: req.params.id } });
      if (!run) {
        throw new ApiError(404, 'SIMULATION_NOT_FOUND', `No simulation run with id ${req.params.id}`);
      }
      res.status(200).json({ result: run, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/simulations/:id/results', async (req, res, next) => {
    try {
      const run = await prisma.simulationRun.findUnique({
        where: { id: req.params.id },
        include: { result: true }
      });
      if (!run) {
        throw new ApiError(404, 'SIMULATION_NOT_FOUND', `No simulation run with id ${req.params.id}`);
      }
      if (!run.result) {
        throw new ApiError(404, 'RESULTS_NOT_READY', `Simulation run ${req.params.id} has status "${run.status}" and no results yet`);
      }
      res.status(200).json({ result: run.result, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
