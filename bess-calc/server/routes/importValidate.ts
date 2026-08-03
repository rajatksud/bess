import { Router } from 'express';
import { z } from 'zod';
import { importIntervalCsv } from '../../src/import';

export const importRouter = Router();

const importValidateRequestSchema = z.object({
  csvText: z.string().min(1).max(15 * 1024 * 1024), // hard ceiling; importIntervalCsv applies its own configurable limit too
  tariffTimezone: z.string().min(1),
  mode: z.enum(['strict', 'permissive']).optional(),
  allowIrregular: z.boolean().optional()
});

importRouter.post('/import/validate', (req, res, next) => {
  try {
    const body = importValidateRequestSchema.parse(req.body);
    const result = importIntervalCsv(body.csvText, {
      tariffTimezone: body.tariffTimezone,
      mode: body.mode,
      allowIrregular: body.allowIrregular
    });
    res.status(200).json({ result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
});
