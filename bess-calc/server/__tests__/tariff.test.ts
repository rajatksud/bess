import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const flatTariff = {
  id: 'test-flat',
  name: 'Test Flat Tariff',
  source: 'test',
  version: '1.0.0',
  effectiveFrom: '2024-01-01',
  jurisdiction: 'TEST',
  consumerCategory: 'Test',
  voltageLevel: 'LT',
  timezone: 'UTC',
  currency: '$',
  billingCycle: 'monthly',
  billingUnit: 'kW',
  demandIntegrationWindowMinutes: 15,
  energyCharges: { type: 'flat', flatRatePerKwh: 10 },
  demandCharges: { basis: 'measured_maximum', ratePerKw: 400 },
  exportRules: { policy: 'prohibited' },
  taxesAndDuties: [],
  applicabilityConditions: [],
  roundingRule: { mode: 'none', decimals: 2 }
};

describe('POST /api/v1/tariff/calculate', () => {
  it('calculates a bill and returns netAvoidedCost for a valid request', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/tariff/calculate').send({
      tariff: flatTariff,
      intervals: [
        { timestamp: '2024-06-15T00:00:00.000Z', durationHours: 0.25, baselineGridImportKw: 300, postBessGridImportKw: 200 }
      ],
      asOfDate: '2024-06-15',
      sourceCadenceMinutes: 15
    });
    expect(res.status).toBe(200);
    expect(res.body.result.netAvoidedCost).toBeGreaterThan(0);
    expect(res.body.correlationId).toBeDefined();
  });
});
