import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { hasDatabaseUrl, getTestPrismaClient, cleanupProject } from './persistenceTestSetup';

const battery = { ratedPowerKw: 100, ratedEnergyKwh: 400, batteryChemistry: 'LFP' };
const tariff = { currency: '$', energyChargePerKwh: 9.5 };
const solar = { enableSolarIntegration: false };
const generator = { enableDieselDisplacement: false };
const financial = { initialCapex: 4_000_000 };
const dispatchPriorities = ['peak_shaving'];

describe.runIf(hasDatabaseUrl)('persistence: /api/v1/scenarios', () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ prismaClient: prisma });
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      await cleanupProject(prisma, createdProjectIds.pop()!);
    }
  });

  async function createProject(name: string) {
    const res = await request(app).post('/api/v1/projects').send({ name });
    createdProjectIds.push(res.body.result.id);
    return res.body.result.id as string;
  }

  it('creates a scenario under a project', async () => {
    const projectId = await createProject('Scenario Parent Project');
    const res = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
      name: 'Base Case', batteryConfig: battery, tariffConfig: tariff, solarConfig: solar,
      generatorConfig: generator, financialConfig: financial, dispatchPriorities
    });
    expect(res.status).toBe(201);
    expect(res.body.result.projectId).toBe(projectId);
    expect(res.body.result.batteryConfig).toEqual(battery);
  });

  it('returns 404 when the parent project does not exist', async () => {
    const res = await request(app).post('/api/v1/projects/00000000-0000-0000-0000-000000000000/scenarios').send({
      name: 'Orphan', batteryConfig: battery, tariffConfig: tariff, solarConfig: solar,
      generatorConfig: generator, financialConfig: financial, dispatchPriorities
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('retrieves a scenario by id', async () => {
    const projectId = await createProject('Scenario Fetch Project');
    const createRes = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
      name: 'Fetchable Scenario', batteryConfig: battery, tariffConfig: tariff, solarConfig: solar,
      generatorConfig: generator, financialConfig: financial, dispatchPriorities
    });

    const getRes = await request(app).get(`/api/v1/scenarios/${createRes.body.result.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.result.name).toBe('Fetchable Scenario');
  });

  it('returns 404 for a nonexistent scenario id', async () => {
    const res = await request(app).get('/api/v1/scenarios/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCENARIO_NOT_FOUND');
  });
});
