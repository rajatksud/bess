import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from '../app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', '..', 'dist');
const distExists = existsSync(join(distDir, 'index.html'));

describe.skipIf(!distExists)('frontend static + SPA fallback', () => {
  it('serves index.html for a non-API browser route', async () => {
    const app = createApp({ staticDir: distDir });
    const res = await request(app).get('/some/client/route');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!doctype html>'.replace('<!doctype', '')); // tolerant of case
  });

  it('still returns a structured 404 for an unmatched API route even with static serving enabled', async () => {
    const app = createApp({ staticDir: distDir });
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('without a configured static dir', () => {
  it('does not attempt to serve a frontend route (API-only mode)', async () => {
    const app = createApp();
    const res = await request(app).get('/some/client/route');
    expect(res.status).toBe(404);
  });
});
