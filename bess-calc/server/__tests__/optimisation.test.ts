import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const battery = {
  ratedPowerKw: 100, ratedEnergyKwh: 400, minSocPct: 10, maxSocPct: 100,
  initialSocPct: 50, reserveSocPct: 0, chargeEfficiencyPct: 95, dischargeEfficiencyPct: 95,
  degradationCostPerKwh: 0.1
};

describe('POST /api/v1/optimisation/run', () => {
  it('runs an optimisation and returns a structured result with solverStatus', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/optimisation/run').send({
      intervals: [
        { timestamp: '2024-06-15T00:00:00.000Z', durationHours: 1, netLoadKw: 80, importRatePerKwh: 10, exportAllowed: false, isOutage: false }
      ],
      battery,
      options: { terminalSocRule: 'unconstrained' }
    });
    expect(res.status).toBe(200);
    expect(res.body.result.solverStatus).toBe('optimal');
    expect(res.body.result.dispatchIntervals.length).toBe(1);
  });

  it('falls back to heuristic and still returns 200 with a structured result for an infeasible model', async () => {
    const app = createApp();
    const infeasibleBattery = { ...battery, minSocPct: 90, maxSocPct: 10 };
    const res = await request(app).post('/api/v1/optimisation/run').send({
      intervals: [
        { timestamp: '2024-06-15T00:00:00.000Z', durationHours: 1, netLoadKw: 50, importRatePerKwh: 10, exportAllowed: false, isOutage: false }
      ],
      battery: infeasibleBattery,
      options: { terminalSocRule: 'unconstrained' }
    });
    expect(res.status).toBe(200);
    expect(res.body.result.solverStatus).toBe('infeasible');
    expect(res.body.result.dispatchIntervals.every((di: { mode: string }) => di.mode === 'heuristic')).toBe(true);
  });
});
