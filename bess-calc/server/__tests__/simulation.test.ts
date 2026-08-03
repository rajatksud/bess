import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

function makeInterval(overrides: Record<string, unknown> = {}) {
  return {
    intervalIndex: 0,
    timeLabel: '00:00',
    loadKw: 100,
    loadKva: 110,
    solarKw: 0,
    gridAvailable: true,
    dgRequiredKw: 0,
    tariffImportRate: 9.5,
    tariffPeriod: 'Standard',
    bessPowerKw: 0,
    bessSocPct: 80,
    bessEnergyKwh: 200,
    postBessLoadKw: 100,
    postBessLoadKva: 110,
    postBessDgKw: 0,
    gridImportKw: 100,
    gridExportKw: 0,
    solarCurtailedKw: 0,
    bessAction: 'Idle',
    grossSiteLoadKw: 100,
    solarGenerationKw: 0,
    solarGenerationServingLoadKw: 0,
    preBessGridImportKw: 100,
    postBessGridImportKw: 100,
    batteryChargeKw: 0,
    batteryDischargeKw: 0,
    gridBatteryChargeKw: 0,
    ...overrides
  };
}

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

describe('POST /api/v1/simulation/run', () => {
  it('runs a simulation and returns technical/financial results', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/simulation/run').send({
      system, tariff, diesel, solar, financial,
      intervals: [makeInterval()],
      dispatchPriorities: ['peak_shaving'],
      intervalMinutes: 15,
      mode: 'interval'
    });
    expect(res.status).toBe(200);
    expect(res.body.result.technical).toBeDefined();
    expect(res.body.result.financial).toBeDefined();
    expect(res.body.result.confidenceGrade).toBeDefined();
  });
});
