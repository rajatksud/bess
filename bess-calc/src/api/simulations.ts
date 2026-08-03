import { apiRequest } from './client';
import { SimulationCreateResult, SimulationRun, SimulationResultRecord } from './types';

export function createSimulation(scenarioId: string): Promise<SimulationCreateResult> {
  return apiRequest<SimulationCreateResult>('/simulations', { method: 'POST', body: { scenarioId } });
}

export function getSimulation(id: string): Promise<SimulationRun> {
  return apiRequest<SimulationRun>(`/simulations/${id}`);
}

export function getSimulationResults(id: string): Promise<SimulationResultRecord> {
  return apiRequest<SimulationResultRecord>(`/simulations/${id}/results`);
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Polls GET /simulations/:id until status leaves 'pending'/'running'. The current engine runs
 * synchronously within the POST /simulations request (see server/routes/simulations.ts), so in
 * practice this resolves on the first poll - but the route contract (a status field, a separate
 * results endpoint) is written for a future async/queued engine, and the frontend should not
 * assume synchronous completion.
 */
export async function waitForSimulation(id: string): Promise<SimulationRun> {
  const startedAt = Date.now();
  for (;;) {
    const run = await getSimulation(id);
    if (run.status === 'completed' || run.status === 'failed') {
      return run;
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`Simulation ${id} did not complete within ${POLL_TIMEOUT_MS}ms (last status: ${run.status})`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
