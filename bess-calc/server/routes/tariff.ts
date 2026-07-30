import { Router } from 'express';
import { z } from 'zod';
import { calculateTariffBill, TariffDefinition, BillingInterval } from '../../src/tariff';

export const tariffRouter = Router();

const billingIntervalSchema = z.object({
  timestamp: z.string(),
  durationHours: z.number().positive(),
  baselineGridImportKw: z.number(),
  postBessGridImportKw: z.number(),
  baselineGridImportKva: z.number().optional(),
  postBessGridImportKva: z.number().optional(),
  baselineGridExportKw: z.number().optional(),
  postBessGridExportKw: z.number().optional()
});

// Deliberately permissive on the nested TariffDefinition shape (z.custom passthrough)
// rather than re-declaring every nested union exhaustively in Zod - the tariff engine
// itself validates domain semantics (effective dates, applicability); this schema's
// job is to catch malformed JSON payloads at the API boundary, not duplicate business
// rules. Required top-level fields are still checked explicitly.
const tariffDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string(),
  version: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  jurisdiction: z.string(),
  utility: z.string().optional(),
  consumerCategory: z.string(),
  voltageLevel: z.string(),
  timezone: z.string().min(1),
  currency: z.string(),
  billingCycle: z.enum(['monthly', 'bimonthly', 'quarterly']),
  billingUnit: z.enum(['kW', 'kVA']),
  demandIntegrationWindowMinutes: z.number().positive(),
  energyCharges: z.record(z.string(), z.unknown()),
  demandCharges: z.record(z.string(), z.unknown()),
  exportRules: z.record(z.string(), z.unknown()),
  taxesAndDuties: z.array(z.record(z.string(), z.unknown())),
  lossesSurcharge: z.record(z.string(), z.unknown()).optional(),
  applicabilityConditions: z.array(z.record(z.string(), z.unknown())),
  roundingRule: z.record(z.string(), z.unknown())
}) satisfies z.ZodType<unknown>;

const tariffCalculateRequestSchema = z.object({
  tariff: tariffDefinitionSchema,
  intervals: z.array(billingIntervalSchema).min(1).max(200_000),
  existingMonthToDatePeakKw: z.number().optional(),
  existingMonthToDatePeakKva: z.number().optional(),
  ratchetLookbackPeakKw: z.number().optional(),
  ratchetLookbackPeakKva: z.number().optional(),
  asOfDate: z.string(),
  sourceCadenceMinutes: z.number().positive()
});

tariffRouter.post('/tariff/calculate', (req, res, next) => {
  try {
    const body = tariffCalculateRequestSchema.parse(req.body);
    const result = calculateTariffBill(body.tariff as unknown as TariffDefinition, {
      intervals: body.intervals as BillingInterval[],
      existingMonthToDatePeakKw: body.existingMonthToDatePeakKw,
      existingMonthToDatePeakKva: body.existingMonthToDatePeakKva,
      ratchetLookbackPeakKw: body.ratchetLookbackPeakKw,
      ratchetLookbackPeakKva: body.ratchetLookbackPeakKva,
      asOfDate: body.asOfDate,
      sourceCadenceMinutes: body.sourceCadenceMinutes
    });
    res.status(200).json({ result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
});
