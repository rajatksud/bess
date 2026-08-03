import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { importIntervalCsv } from '../../src/import';
import { ApiError } from '../lib/errors';

const importDatasetSchema = z.object({
  projectId: z.string().uuid(),
  csvText: z.string().min(1).max(15 * 1024 * 1024),
  tariffTimezone: z.string().min(1),
  mode: z.enum(['strict', 'permissive']).optional(),
  allowIrregular: z.boolean().optional(),
  sourceFile: z.string().optional()
});

const BULK_INSERT_BATCH_SIZE = 5_000;

/** Persistence-backed dataset import: validates via the existing src/import module unchanged, then persists an IntervalDataset + bulk IntervalRecord rows. Takes an injected PrismaClient so tests can point it at a test database. */
export function createDatasetsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/datasets/import', async (req, res, next) => {
    try {
      const body = importDatasetSchema.parse(req.body);

      const project = await prisma.project.findUnique({ where: { id: body.projectId } });
      if (!project) {
        throw new ApiError(404, 'PROJECT_NOT_FOUND', `No project with id ${body.projectId}`);
      }

      const importResult = importIntervalCsv(body.csvText, {
        tariffTimezone: body.tariffTimezone,
        mode: body.mode,
        allowIrregular: body.allowIrregular
      });

      if (importResult.records.length === 0) {
        throw new ApiError(422, 'NO_VALID_ROWS', 'CSV import produced no valid interval records', [
          { message: `${importResult.summary.errorCount} row error(s), ${importResult.summary.rejectedRows} rejected row(s)` }
        ]);
      }

      const dataset = await prisma.intervalDataset.create({
        data: {
          projectId: body.projectId,
          sourceFile: body.sourceFile,
          timezone: body.tariffTimezone,
          intervalMinutes: importResult.summary.intervalDurationMinutes ?? 0,
          startTime: new Date(importResult.summary.startTimestamp ?? importResult.records[0].timestamp),
          endTime: new Date(importResult.summary.endTimestamp ?? importResult.records[importResult.records.length - 1].timestamp),
          metadata: importResult.summary as unknown as Prisma.InputJsonValue
        }
      });

      // Bulk insert in batches rather than one createMany for the whole file - keeps
      // a single query's payload bounded regardless of how large maxRowCount is
      // configured (see src/import/types.ts DEFAULT_IMPORT_LIMITS: up to 200,000 rows).
      for (let i = 0; i < importResult.records.length; i += BULK_INSERT_BATCH_SIZE) {
        const batch = importResult.records.slice(i, i + BULK_INSERT_BATCH_SIZE);
        await prisma.intervalRecord.createMany({
          data: batch.map(record => ({
            datasetId: dataset.id,
            timestamp: new Date(record.timestamp),
            loadKw: record.loadKw,
            loadKva: record.loadKva,
            solarKw: record.solarKw,
            dgKw: record.dgKw,
            powerFactor: record.powerFactor
          }))
        });
      }

      res.status(201).json({
        result: {
          datasetId: dataset.id,
          summary: importResult.summary,
          warnings: importResult.warnings,
          rowErrors: importResult.rowErrors
        },
        correlationId: req.correlationId
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
