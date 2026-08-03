import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { hasDatabaseUrl, getTestPrismaClient, cleanupProject } from './persistenceTestSetup';

const baseSystem = {
  ratedPowerKw: 100, ratedEnergyKwh: 400, batteryChemistry: 'LFP', usableDodPct: 90,
  minSocPct: 10, maxSocPct: 100, initialSocPct: 80, reserveSocPct: 15,
  chargeEfficiencyPct: 95, dischargeEfficiencyPct: 95, availabilityPct: 98,
  auxiliaryLoadKw: 2, annualDegradationPct: 2, projectLifeYears: 10, cycleLife: 6000
};
const baseTariff = {
  currency: '$', energyChargePerKwh: 9.5, demandChargePerKvaMonth: 450, contractDemandKva: 1000,
  billingDemandWindowMinutes: 15, powerFactor: 1, exportCreditPerKwh: 3.5,
  minimumBillingDemandPct: 0, demandRatchetPct: 80, enableTou: false, touPeriods: []
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
const baseFinancial = {
  initialCapex: 4_000_000, fixedAnnualOm: 200_000, variableOmPerKwhThroughput: 0.15,
  annualOmEscalationPct: 5, tariffEscalationPct: 4, dieselEscalationPct: 5,
  discountRatePct: 12, taxRatePct: 25, residualValuePct: 10
};
const dispatchPriorities = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'];
const csvText = [
  'timestamp,load_kw,solar_kw',
  '2026-01-01T00:00:00Z,180,0',
  '2026-01-01T00:15:00Z,600,0',
  '2026-01-01T00:30:00Z,260,0',
  '2026-01-01T00:45:00Z,200,0'
].join('\n');

describe.runIf(hasDatabaseUrl)('persistence: POST /api/v1/scenarios/compare', () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ prismaClient: prisma });
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      await cleanupProject(prisma, createdProjectIds.pop()!);
    }
  });

  /** Creates one project + dataset, then N scenarios all attached to that SAME dataset. */
  async function createComparableScenarios(
    specs: Array<{ name: string; system?: Record<string, unknown>; tariff?: Record<string, unknown>; financial?: Record<string, unknown> }>
  ): Promise<{ projectId: string; datasetId: string; scenarioIds: string[] }> {
    const projectRes = await request(app).post('/api/v1/projects').send({ name: 'Comparison Project' });
    const projectId = projectRes.body.result.id as string;
    createdProjectIds.push(projectId);

    const importRes = await request(app).post('/api/v1/datasets/import').send({
      projectId, csvText, tariffTimezone: 'UTC', mode: 'permissive', allowIrregular: true
    });
    const datasetId = importRes.body.result.datasetId as string;

    const scenarioIds: string[] = [];
    for (const spec of specs) {
      const res = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
        name: spec.name,
        intervalDatasetId: datasetId,
        batteryConfig: { ...baseSystem, ...spec.system },
        tariffConfig: { ...baseTariff, ...spec.tariff },
        solarConfig: solar,
        generatorConfig: diesel,
        financialConfig: { ...baseFinancial, ...spec.financial },
        dispatchPriorities
      });
      scenarioIds.push(res.body.result.id as string);
    }
    return { projectId, datasetId, scenarioIds };
  }

  it('compares two designs on the same dataset and returns a ranked result', async () => {
    const { scenarioIds } = await createComparableScenarios([
      { name: 'Small', system: { ratedPowerKw: 60, ratedEnergyKwh: 150 }, financial: { initialCapex: 2_000_000 } },
      { name: 'Large', system: { ratedPowerKw: 250, ratedEnergyKwh: 700 }, financial: { initialCapex: 6_000_000 } }
    ]);

    const res = await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds });

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBeTruthy();
    expect(res.body.result.scenarios).toHaveLength(2);
    expect(res.body.result.comparability.comparable).toBe(true);
    expect(res.body.result.ranking).not.toBeNull();
    expect(res.body.result.ranking.recommendedScenarioId).toBe(res.body.result.ranking.byNpv[0]);

    for (const metrics of res.body.result.scenarios) {
      expect(typeof metrics.capex).toBe('number');
      expect(typeof metrics.npv).toBe('number');
      expect(typeof metrics.lcosPerKwh).toBe('number');
      expect(typeof metrics.peakReductionKw).toBe('number');
      expect(metrics.batterySoh).not.toBeNull();
      expect(metrics.batterySoh.endOfProjectSohPct).toBeLessThanOrEqual(100);
    }
  }, 60_000);

  it('runs the same persistence pipeline as POST /simulations, leaving an auditable run per scenario', async () => {
    const { scenarioIds } = await createComparableScenarios([
      { name: 'A', system: { ratedEnergyKwh: 300 } },
      { name: 'B', system: { ratedEnergyKwh: 600 } }
    ]);

    await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds });

    for (const scenarioId of scenarioIds) {
      const runs = await prisma.simulationRun.findMany({ where: { scenarioId }, include: { result: true } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('completed');
      expect(runs[0].result).not.toBeNull();
    }
  }, 60_000);

  it('withholds the ranking but still returns per-scenario metrics when the tariffs differ', async () => {
    const { scenarioIds } = await createComparableScenarios([
      { name: 'Cheap', tariff: { energyChargePerKwh: 5 } },
      { name: 'Expensive', tariff: { energyChargePerKwh: 15 } }
    ]);

    const res = await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds });

    expect(res.status).toBe(200);
    expect(res.body.result.comparability.comparable).toBe(false);
    expect(res.body.result.comparability.reasons.join(' ')).toContain('different energy charges');
    expect(res.body.result.ranking).toBeNull();
    expect(res.body.result.scenarios).toHaveLength(2);
  }, 60_000);

  it('rejects fewer than two scenario ids with a structured validation error', async () => {
    const { scenarioIds } = await createComparableScenarios([{ name: 'Only one' }]);
    const res = await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  }, 30_000);

  it('rejects a non-uuid scenario id rather than querying with it', async () => {
    const res = await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds: ['not-a-uuid', 'also-not'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects the same scenario supplied twice', async () => {
    const { scenarioIds } = await createComparableScenarios([{ name: 'Solo' }]);
    const res = await request(app).post('/api/v1/scenarios/compare').send({ scenarioIds: [scenarioIds[0], scenarioIds[0]] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DUPLICATE_SCENARIO');
  }, 30_000);

  it('404s when one of the scenarios does not exist', async () => {
    const { scenarioIds } = await createComparableScenarios([{ name: 'Real' }]);
    const res = await request(app).post('/api/v1/scenarios/compare').send({
      scenarioIds: [scenarioIds[0], '00000000-0000-4000-8000-000000000000']
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCENARIO_NOT_FOUND');
  }, 30_000);

  it('422s when a scenario in the comparison has no interval dataset attached', async () => {
    const projectRes = await request(app).post('/api/v1/projects').send({ name: 'No Dataset Project' });
    const projectId = projectRes.body.result.id as string;
    createdProjectIds.push(projectId);

    const withoutDataset = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
      name: 'Detached', batteryConfig: baseSystem, tariffConfig: baseTariff, solarConfig: solar,
      generatorConfig: diesel, financialConfig: baseFinancial, dispatchPriorities
    });
    const other = await request(app).post(`/api/v1/projects/${projectId}/scenarios`).send({
      name: 'Also detached', batteryConfig: baseSystem, tariffConfig: baseTariff, solarConfig: solar,
      generatorConfig: diesel, financialConfig: baseFinancial, dispatchPriorities
    });

    const res = await request(app).post('/api/v1/scenarios/compare').send({
      scenarioIds: [withoutDataset.body.result.id, other.body.result.id]
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_DATASET');
  }, 30_000);
});
