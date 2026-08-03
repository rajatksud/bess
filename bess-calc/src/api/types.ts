// Response shapes for the persistence-backed server routes (server/routes/{projects,scenarios,datasets,simulations}.ts).
// These mirror the Prisma models in prisma/schema.prisma at the JSON-serialisation boundary (Date -> ISO string,
// Json columns -> their TS shape from src/types/bess.ts). Kept separate from src/engine's pure types: this module
// exists purely to describe what crosses the network, and must never be imported by src/engine.

import {
  BessSystemInput,
  TariffInput,
  SolarInput,
  DieselInput,
  FinancialInput,
  DispatchPriorityType,
  SavingsBreakdown,
  TechnicalResult,
  FinancialResult,
  ValidationWarning
} from '../types/bess';
import { ImportSummary, ImportWarning, RowError } from '../import/types';
import { ScenarioComparisonResult as DomainScenarioComparisonResult } from '../scenario';

export interface Project {
  id: string;
  name: string;
  customerName: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  intervalDatasetId: string | null;
  batteryConfig: BessSystemInput;
  tariffConfig: TariffInput;
  solarConfig: SolarInput;
  generatorConfig: DieselInput;
  financialConfig: FinancialInput;
  dispatchPriorities: DispatchPriorityType[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetImportResult {
  datasetId: string;
  summary: ImportSummary;
  warnings: ImportWarning[];
  rowErrors: RowError[];
}

export type SimulationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SimulationRun {
  id: string;
  scenarioId: string;
  engineVersion: string;
  status: SimulationRunStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SimulationCreateResult {
  simulationId: string;
  status: SimulationRunStatus;
  confidenceGrade: string;
  confidenceGradeReason: string;
}

export interface SimulationResultRecord {
  id: string;
  simulationRunId: string;
  peakReductionKw: number;
  energySavings: number;
  demandSavings: number;
  arbitrageSavings: number;
  totalSavings: number;
  irr: number | null;
  npv: number;
  savingsBreakdown: SavingsBreakdown;
  technicalResult: TechnicalResult;
  financialResult: FinancialResult;
  warnings: ValidationWarning[];
  createdAt: string;
}

/**
 * Response body of POST /api/v1/scenarios/compare. Structurally identical to the domain
 * type in src/scenario — re-exported here (rather than redefined) so the wire contract
 * and the engine's own type can never silently diverge. Dates are ISO strings on both
 * sides, so no serialisation transform is needed.
 */
export type ScenarioComparisonResult = DomainScenarioComparisonResult;
export type {
  ScenarioMetrics,
  ScenarioSohSummary,
  ComparabilityAssessment,
  ScenarioRanking
} from '../scenario';
