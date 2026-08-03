import { Router } from 'express';
import { z } from 'zod';
import { type PrismaClient } from '@prisma/client';
import { runScenarioSimulation } from '../services/runScenarioSimulation';
import { ApiError } from '../lib/errors';

const createSimulationSchema = z.object({
  scenarioId: z.string().uuid()
});

/** Persistence-backed simulation workflow: loads a scenario + its dataset from the DB, runs the existing engine functions unchanged, and persists a reproducible/auditable SimulationRun + SimulationResult. Takes an injected PrismaClient so tests can point it at a test database. */
export function createSimulationsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/simulations', async (req, res, next) => {
    try {
      const body = createSimulationSchema.parse(req.body);
      const outcome = await runScenarioSimulation(prisma, body.scenarioId);

      res.status(201).json({
        result: {
          simulationId: outcome.simulationRunId,
          status: 'completed',
          confidenceGrade: outcome.confidenceGrade,
          confidenceGradeReason: outcome.confidenceGradeReason
        },
        correlationId: req.correlationId
      });
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
