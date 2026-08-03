import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('POST /api/v1/import/validate', () => {
  it('validates a well-formed CSV and returns an accepted-rows summary', async () => {
    const app = createApp();
    const csvText = 'timestamp,load_kw\n2024-06-15T00:00:00Z,100\n2024-06-15T00:15:00Z,110';
    const res = await request(app).post('/api/v1/import/validate').send({ csvText, tariffTimezone: 'UTC' });
    expect(res.status).toBe(200);
    expect(res.body.result.summary.acceptedRows).toBe(2);
  });

  it('returns row errors for an invalid CSV without a 500', async () => {
    const app = createApp();
    const csvText = 'timestamp,load_kw\n,abc';
    const res = await request(app).post('/api/v1/import/validate').send({ csvText, tariffTimezone: 'UTC' });
    expect(res.status).toBe(200);
    expect(res.body.result.rowErrors.length).toBeGreaterThan(0);
  });
});
