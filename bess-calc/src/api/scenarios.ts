import { apiRequest } from './client';
import { Scenario } from './types';
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
