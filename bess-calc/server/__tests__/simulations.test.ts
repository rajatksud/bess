import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { hasDatabaseUrl, getTestPrismaClient, cleanupProject } from './persistenceTestSetup';
import { CALCULATION_ENGINE_VERSION } from '../lib/version';

const system = {
  ratedPowerKw: 100, ratedEnergyKwh: 400, batteryChemistry: 'LFP', usableDodPct: 90,
  minSocPct: 10, maxSocPct: 100, initialSocPct: 80, reserveSocPct: 15,
  chargeEfficiencyPct: 95, dischargeEfficiencyPct: 95, availabilityPct: 98,
  auxiliaryLoadKw: 2, annualDegradationPct: 2, projectLifeYears: 10, cycleLife: 6000
};
const tariff = {
  currency: '$', energyChargePerKwh: 9.5, demandChargePerKvaMonth: 450, contractDemandKva: 300,
  billingDemandWindowMinutes: 15, powerFactor: 0.9, exportCreditPerKwh: 3.5,
  minimumBillingDemandPct: 75, demandRatchetPct: 80, enableTou: false, touPeriods: []
};
const diesel = {
  enableDieselDisplacement: false, dgCapacityKva: 250, dieselPricePerLitre: 92,
  specificFuelConsumptionLitrePerKwh: 0.28, fixedFuelLitresPerHour: 5, variableFuelLitresPerKwh: 0.24,
  maintenanceCostPerRunHour: 150, outageHoursPerMonth: 0, avgOutageLoadKw: 0
};
const solar = {
  enableSolarIntegration: false, installedCapacityKwp: 0, dailySurplusSolarKwh: 0,
  exportAllowed: false, exportCreditPerKwh: 3, curtailmentEnabled: true
};
const financial = {
  initialCapex: 4_000_000, fixedAnnualOm: 200_000, variableOmPerKwhThroughput: 0.15,
  annualOmEscalationPct: 5, tariffEscalationPct: 4, dieselEscalationPct: 5,
  discountRatePct: 12, taxRatePct: 25, residualValuePct: 10
};
const dispatchPriorities = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'];
const csvText = [
  'timestamp,load_kw,solar_kw',
  '2026-01-01T00:00:00Z,180,0',
  '2026-01-01T00:15:00Z,220,0',
  '2026-01-01T00:30:00Z,260,0',
  '2026-01-01T00:45:00Z,200,0'
].join('\n');

describe.runIf(hasDatabaseUrl)('persistence: /api/v1/simulations', () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ prismaClient: prisma });
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      await cleanupProject(prisma, createdProjectIds.pop()!);
    }
  });

  async function createScenarioWithDataset(name: string) {
    const projectRes = await request(app).post('/api/v1/projects').send({ name: `${name} Project` });
    const projectId = projectRes.body.result.id as string;
    createdProjectIds.push(projectId);

    const importRes = await request(app).post('/api/v1/datasets/import').send({
      projectId, csvText, tariffTimezone: 'UTC', mode: 'permissive', allowIrregular: true
    });
    const datasetId = importRes.body.result.datasetId as string;

    const scenarioRes = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
      name, intervalDatasetId: datasetId,
      batteryConfig: system, tariffConfig: tariff, solarConfig: solar,
      generatorConfig: diesel, financialConfig: financial, dispatchPriorities
    });
    return scenarioRes.body.result.id as string;
  }

  it('runs a simulation end-to-end and returns a simulationId', async () => {
    const scenarioId = await createScenarioWithDataset('E2E Scenario');
    const res = await request(app).post('/api/v1/simulations').send({ scenarioId });
    expect(res.status).toBe(201);
    expect(res.body.result.simulationId).toBeDefined();
    expect(res.body.result.status).toBe('completed');
  });

  it('returns 404 for a nonexistent scenario', async () => {
    const res = await request(app).post('/api/v1/simulations').send({ scenarioId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCENARIO_NOT_FOUND');
  });

  it('retrieves a simulation run by id', async () => {
    const scenarioId = await createScenarioWithDataset('Run Fetch Scenario');
    const runRes = await request(app).post('/api/v1/simulations').send({ scenarioId });
    const simulationId = runRes.body.result.simulationId;

    const getRes = await request(app).get(`/api/v1/simulations/${simulationId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.result.id).toBe(simulationId);
    expect(getRes.body.result.status).toBe('completed');
  });

  it('retrieves simulation results by run id', async () => {
    const scenarioId = await createScenarioWithDataset('Results Fetch Scenario');
    const runRes = await request(app).post('/api/v1/simulations').send({ scenarioId });
    const simulationId = runRes.body.result.simulationId;

    const resultsRes = await request(app).get(`/api/v1/simulations/${simulationId}/results`);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.result.simulationRunId).toBe(simulationId);
    expect(typeof resultsRes.body.result.npv).toBe('number');
  });

  it('returns 404 for results of a nonexistent simulation', async () => {
    const res = await request(app).get('/api/v1/simulations/00000000-0000-0000-0000-000000000000/results');
    expect(res.status).toBe(404);
  });

  describe('reproducibility', () => {
    it('produces identical financial/technical results for repeated runs of the same scenario', async () => {
      const scenarioId = await createScenarioWithDataset('Reproducibility Scenario');

      const firstRun = await request(app).post('/api/v1/simulations').send({ scenarioId });
      const secondRun = await request(app).post('/api/v1/simulations').send({ scenarioId });

      const firstResults = await request(app).get(`/api/v1/simulations/${firstRun.body.result.simulationId}/results`);
      const secondResults = await request(app).get(`/api/v1/simulations/${secondRun.body.result.simulationId}/results`);

      expect(secondResults.body.result.npv).toBe(firstResults.body.result.npv);
      expect(secondResults.body.result.totalSavings).toBe(firstResults.body.result.totalSavings);
      expect(secondResults.body.result.technicalResult).toEqual(firstResults.body.result.technicalResult);
      expect(secondResults.body.result.savingsBreakdown).toEqual(firstResults.body.result.savingsBreakdown);
    });
  });

  describe('audit trail', () => {
    it('every persisted run carries engine version, timestamps, and a complete input snapshot', async () => {
      const scenarioId = await createScenarioWithDataset('Audit Scenario');
      const runRes = await request(app).post('/api/v1/simulations').send({ scenarioId });
      const simulationId = runRes.body.result.simulationId;

      const run = await prisma.simulationRun.findUnique({ where: { id: simulationId } });
      expect(run).not.toBeNull();
      expect(run!.engineVersion).toBe(CALCULATION_ENGINE_VERSION);
      expect(run!.startedAt).toBeInstanceOf(Date);
      expect(run!.completedAt).toBeInstanceOf(Date);
      expect(run!.status).toBe('completed');

      const snapshot = run!.inputSnapshot as Record<string, unknown>;
      expect(snapshot.system).toEqual(system);
      expect(snapshot.tariff).toEqual(tariff);
      expect(snapshot.dispatchPriorities).toEqual(dispatchPriorities);
    });

    it('every persisted result carries the warnings array from validation', async () => {
      const scenarioId = await createScenarioWithDataset('Warnings Audit Scenario');
      const runRes = await request(app).post('/api/v1/simulations').send({ scenarioId });
      const simulationId = runRes.body.result.simulationId;

      const result = await prisma.simulationResult.findUnique({ where: { simulationRunId: simulationId } });
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.warnings)).toBe(true);
    });
  });
});
