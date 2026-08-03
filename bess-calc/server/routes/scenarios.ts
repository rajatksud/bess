import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/errors';

// Config payloads (BessSystemInput/TariffInput/SolarInput/DieselInput/FinancialInput,
// see src/types/bess.ts) are validated in depth by validateBessConfig/the engine
// itself at simulation time - here they're accepted as opaque records and stored
// as-is, matching the existing stateless routes' own record(z.string(), z.unknown())
// pattern (see server/routes/simulation.ts).
const createScenarioSchema = z.object({
  name: z.string().min(1),
  intervalDatasetId: z.string().uuid().optional(),
  batteryConfig: z.record(z.string(), z.unknown()),
  tariffConfig: z.record(z.string(), z.unknown()),
  solarConfig: z.record(z.string(), z.unknown()),
  generatorConfig: z.record(z.string(), z.unknown()),
  financialConfig: z.record(z.string(), z.unknown()),
  dispatchPriorities: z.array(z.enum(['backup_reserve', 'peak_shaving', 'diesel_displacement', 'solar_self_consumption', 'tou_arbitrage']))
});

/** Persistence-backed scenario CRUD, nested under a project. Takes an injected PrismaClient so tests can point it at a test database. */
export function createScenariosRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/projects/:projectId/scenarios', async (req, res, next) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
      if (!project) {
        throw new ApiError(404, 'PROJECT_NOT_FOUND', `No project with id ${req.params.projectId}`);
      }

      const body = createScenarioSchema.parse(req.body);

      if (body.intervalDatasetId) {
        const dataset = await prisma.intervalDataset.findUnique({ where: { id: body.intervalDatasetId } });
        if (!dataset || dataset.projectId !== req.params.projectId) {
          throw new ApiError(404, 'DATASET_NOT_FOUND', `No interval dataset with id ${body.intervalDatasetId} in project ${req.params.projectId}`);
        }
      }

      const scenario = await prisma.scenario.create({
        data: {
          projectId: req.params.projectId,
          name: body.name,
          intervalDatasetId: body.intervalDatasetId,
          batteryConfig: body.batteryConfig as Prisma.InputJsonValue,
          tariffConfig: body.tariffConfig as Prisma.InputJsonValue,
          solarConfig: body.solarConfig as Prisma.InputJsonValue,
          generatorConfig: body.generatorConfig as Prisma.InputJsonValue,
          financialConfig: body.financialConfig as Prisma.InputJsonValue,
          dispatchPriorities: body.dispatchPriorities as Prisma.InputJsonValue
        }
      });

      res.status(201).json({ result: scenario, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/scenarios/:id', async (req, res, next) => {
    try {
      const scenario = await prisma.scenario.findUnique({ where: { id: req.params.id } });
      if (!scenario) {
        throw new ApiError(404, 'SCENARIO_NOT_FOUND', `No scenario with id ${req.params.id}`);
      }
      res.status(200).json({ result: scenario, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
