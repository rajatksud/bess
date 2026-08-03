import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('GET /api/v1/health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('does not disclose secrets or environment values', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/password|secret|token/i);
  });
});

describe('GET /api/v1/version', () => {
  it('returns app, engine, and node version info', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/version');
    expect(res.status).toBe(200);
    expect(res.body.appVersion).toBeDefined();
    expect(res.body.calculationEngineVersion).toBeDefined();
    expect(res.body.nodeVersion).toMatch(/^v\d+/);
  });
});

describe('correlation ID', () => {
  it('generates a correlation ID and returns it in the response header', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('reuses an inbound correlation ID if provided', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health').set('X-Correlation-Id', 'test-correlation-123');
    expect(res.headers['x-correlation-id']).toBe('test-correlation-123');
  });
});

describe('404 for unmatched API routes', () => {
  it('returns a structured error envelope for an unknown /api/v1 route', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.correlationId).toBeDefined();
  });
});
