import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('validation error envelope', () => {
  it('returns a 400 with a stable error envelope for an invalid /tariff/calculate request', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/tariff/calculate').send({ tariff: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(res.body.error.correlationId).toBeDefined();
  });

  it('rejects malformed JSON with a structured error, not an HTML error page', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/tariff/calculate')
      .set('Content-Type', 'application/json')
      .send('{ not valid json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('does not include a stack trace in a production-shaped error response', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/tariff/calculate').send({ tariff: {} });
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain('.ts:');
    expect(bodyText).not.toContain('at ');
  });
});

describe('oversized request body', () => {
  it('rejects a request body exceeding the configured 2mb limit', async () => {
    const app = createApp();
    const hugeString = 'x'.repeat(3 * 1024 * 1024);
    const res = await request(app)
      .post('/api/v1/import/validate')
      .send({ csvText: hugeString, tariffTimezone: 'UTC' });
    expect([400, 413]).toContain(res.status);
  });
});
