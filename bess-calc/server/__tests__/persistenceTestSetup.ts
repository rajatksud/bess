// Shared setup for persistence-backed route tests (projects/scenarios/datasets/
// simulations). These tests need a real reachable Postgres - in CI that's the
// ephemeral service container (see .github/workflows/ci.yml); locally it's the
// staging tunnel via `node scripts/composeDatabaseUrl.mjs staging app -- npm test`.
// If DATABASE_URL isn't set, these tests are skipped (not failed) so `npm test`
// still works for a contributor with no DB access - the other 179+ engine/tariff/
// optimisation/import tests have no such dependency and always run.
import { PrismaClient } from '@prisma/client';

export const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

let testClient: PrismaClient | undefined;

export function getTestPrismaClient(): PrismaClient {
  if (!testClient) {
    testClient = new PrismaClient();
  }
  return testClient;
}

/** Deletes every row created by a test's project (cascading through scenarios/datasets/runs/results), keeping the shared staging/CI database clean between test runs. */
export async function cleanupProject(prisma: PrismaClient, projectId: string): Promise<void> {
  const scenarios = await prisma.scenario.findMany({ where: { projectId } });
  for (const scenario of scenarios) {
    const runs = await prisma.simulationRun.findMany({ where: { scenarioId: scenario.id } });
    for (const run of runs) {
      await prisma.simulationResult.deleteMany({ where: { simulationRunId: run.id } });
    }
    await prisma.simulationRun.deleteMany({ where: { scenarioId: scenario.id } });
  }
  await prisma.scenario.deleteMany({ where: { projectId } });

  const datasets = await prisma.intervalDataset.findMany({ where: { projectId } });
  for (const dataset of datasets) {
    await prisma.intervalRecord.deleteMany({ where: { datasetId: dataset.id } });
  }
  await prisma.intervalDataset.deleteMany({ where: { projectId } });

  await prisma.project.delete({ where: { id: projectId } });
}
