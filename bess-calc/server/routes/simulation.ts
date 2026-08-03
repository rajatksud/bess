import { Router } from 'express';
import { z } from 'zod';
import { runIntervalDispatch } from '../../src/engine/dispatchEngine';
import { calculateFinancialMetrics } from '../../src/engine/financialEngine';
import { validateBessConfig, validateSimulationResult } from '../../src/engine/validationEngine';
import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord,
  DispatchPriorityType
} from '../../src/types/bess';

export const simulationRouter = Router();

const intervalRecordSchema = z.object({
  intervalIndex: z.number(),
  timeLabel: z.string(),
  loadKw: z.number(),
  loadKva: z.number(),
  solarKw: z.number(),
  gridAvailable: z.boolean(),
  dgRequiredKw: z.number(),
  tariffImportRate: z.number(),
  tariffPeriod: z.string().optional(),
  bessPowerKw: z.number(),
  bessSocPct: z.number(),
  bessEnergyKwh: z.number(),
  postBessLoadKw: z.number(),
  postBessLoadKva: z.number(),
  postBessDgKw: z.number(),
  gridImportKw: z.number(),
  gridExportKw: z.number(),
  solarCurtailedKw: z.number(),
  bessAction: z.string(),
  grossSiteLoadKw: z.number(),
  solarGenerationKw: z.number(),
  solarGenerationServingLoadKw: z.number(),
  preBessGridImportKw: z.number(),
  postBessGridImportKw: z.number(),
  batteryChargeKw: z.number(),
  batteryDischargeKw: z.number(),
  gridBatteryChargeKw: z.number(),
  preBessGridImportKva: z.number().optional(),
  postBessGridImportKva: z.number().optional()
});

const simulationRequestSchema = z.object({
  system: z.record(z.string(), z.unknown()),
  tariff: z.record(z.string(), z.unknown()),
  diesel: z.record(z.string(), z.unknown()),
  solar: z.record(z.string(), z.unknown()),
  financial: z.record(z.string(), z.unknown()),
  intervals: z.array(intervalRecordSchema).min(1).max(200_000),
  dispatchPriorities: z.array(z.enum(['backup_reserve', 'peak_shaving', 'diesel_displacement', 'solar_self_consumption', 'tou_arbitrage'])),
  intervalMinutes: z.number().positive(),
  mode: z.enum(['quick', 'interval', 'legacy'])
});

simulationRouter.post('/simulation/run', (req, res, next) => {
  try {
    const body = simulationRequestSchema.parse(req.body);
    const system = body.system as unknown as BessSystemInput;
    const tariff = body.tariff as unknown as TariffInput;
    const diesel = body.diesel as unknown as DieselInput;
    const solar = body.solar as unknown as SolarInput;
    const financial = body.financial as unknown as FinancialInput;
    const intervals = body.intervals as IntervalRecord[];
    const priorities = body.dispatchPriorities as DispatchPriorityType[];

    const { warnings: configWarnings, confidenceGrade, gradeReason } = validateBessConfig(system, tariff, diesel, solar, financial, body.mode);

    const { simulatedIntervals, savings, technical, assumptions } = runIntervalDispatch(
      intervals, system, tariff, diesel, solar, financial, priorities, body.intervalMinutes
    );

    const financialResult = calculateFinancialMetrics(savings, technical, financial, system);

    const simulationWarnings = validateSimulationResult(
      simulatedIntervals, system, diesel, solar, savings, technical, financialResult, body.intervalMinutes
    );

    res.status(200).json({
      result: {
        mode: body.mode,
        confidenceGrade,
        confidenceGradeReason: gradeReason,
        savings,
        technical,
        financial: financialResult,
        warnings: [...configWarnings, ...simulationWarnings],
        assumptions,
        intervals: simulatedIntervals
      },
      correlationId: req.correlationId
    });
  } catch (err) {
    next(err);
  }
});
