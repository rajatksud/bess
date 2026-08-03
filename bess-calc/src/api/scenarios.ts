import { apiRequest } from './client';
import { Scenario, ScenarioComparisonResult } from './types';
import {
  BessSystemInput,
  TariffInput,
  SolarInput,
  DieselInput,
  FinancialInput,
  DispatchPriorityType
} from '../types/bess';

export interface CreateScenarioInput {
  name: string;
  intervalDatasetId?: string;
  batteryConfig: BessSystemInput;
  tariffConfig: TariffInput;
  solarConfig: SolarInput;
  generatorConfig: DieselInput;
  financialConfig: FinancialInput;
  dispatchPriorities: DispatchPriorityType[];
}

export function createScenario(projectId: string, input: CreateScenarioInput): Promise<Scenario> {
  return apiRequest<Scenario>(`/projects/${projectId}/scenarios`, { method: 'POST', body: input });
}

export function getScenario(id: string): Promise<Scenario> {
  return apiRequest<Scenario>(`/scenarios/${id}`);
}

/**
 * Runs and compares two or more saved scenarios. Each scenario is executed through the
 * same run-and-persist pipeline as POST /simulations (server/services/runScenarioSimulation.ts),
 * so a comparison also leaves an auditable SimulationRun per scenario.
 */
export function compareScenarios(scenarioIds: string[]): Promise<ScenarioComparisonResult> {
  return apiRequest<ScenarioComparisonResult>('/scenarios/compare', { method: 'POST', body: { scenarioIds } });
}
