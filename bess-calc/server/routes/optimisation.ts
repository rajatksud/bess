import { Router } from 'express';
import { z } from 'zod';
import { runOptimisedDispatch } from '../../src/optimisation';
import { OptimisationInterval, OptimisationBatteryConfig, OptimisationOptions } from '../../src/optimisation/types';

export const optimisationRouter = Router();

const optimisationIntervalSchema = z.object({
  timestamp: z.string(),
  durationHours: z.number().positive(),
  netLoadKw: z.number(),
  importRatePerKwh: z.number(),
  exportCreditPerKwh: z.number().optional(),
  exportAllowed: z.boolean(),
  exportLimitKw: z.number().optional(),
  isOutage: z.boolean()
});

const batteryConfigSchema = z.object({
  ratedPowerKw: z.number().positive(),
  ratedEnergyKwh: z.number().positive(),
  minSocPct: z.number().min(0).max(100),
  maxSocPct: z.number().min(0).max(100),
  initialSocPct: z.number().min(0).max(100),
  reserveSocPct: z.number().min(0).max(100),
  chargeEfficiencyPct: z.number().positive().max(100),
  dischargeEfficiencyPct: z.number().positive().max(100),
  degradationCostPerKwh: z.number().min(0)
});

const optionsSchema = z.object({
  terminalSocRule: z.enum(['equal_to_initial', 'minimum_terminal_reserve', 'unconstrained']),
  minimumTerminalReserveSocPct: z.number().min(0).max(100).optional(),
  demandCharge: z.object({
    ratePerKw: z.number().min(0),
    existingMonthToDatePeakKw: z.number().min(0),
    horizonCoversFullBillingPeriod: z.boolean()
  }).optional(),
  unservedLoadPenaltyPerKwh: z.number().min(0).optional(),
  solverTimeoutMs: z.number().optional()
});

const optimisationRequestSchema = z.object({
  intervals: z.array(optimisationIntervalSchema).min(1).max(20_000),
  battery: batteryConfigSchema,
  options: optionsSchema
});

optimisationRouter.post('/optimisation/run', (req, res, next) => {
  try {
    const body = optimisationRequestSchema.parse(req.body);
    const result = runOptimisedDispatch(
      body.intervals as OptimisationInterval[],
      body.battery as OptimisationBatteryConfig,
      body.options as OptimisationOptions
    );
    res.status(200).json({ result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
});
