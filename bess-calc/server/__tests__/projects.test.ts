import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { hasDatabaseUrl, getTestPrismaClient, cleanupProject } from './persistenceTestSetup';

describe.runIf(hasDatabaseUrl)('persistence: /api/v1/projects', () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ prismaClient: prisma });
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      await cleanupProject(prisma, createdProjectIds.pop()!);
    }
  });

  it('creates a project and returns it with an id', async () => {
    const res = await request(app).post('/api/v1/projects').send({ name: 'Test Project', customerName: 'Acme' });
    expect(res.status).toBe(201);
    expect(res.body.result.id).toBeDefined();
    expect(res.body.result.name).toBe('Test Project');
    createdProjectIds.push(res.body.result.id);
  });

  it('rejects a project with no name', async () => {
    const res = await request(app).post('/api/v1/projects').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('retrieves a created project by id', async () => {
    const createRes = await request(app).post('/api/v1/projects').send({ name: 'Fetchable Project' });
    createdProjectIds.push(createRes.body.result.id);

    const getRes = await request(app).get(`/api/v1/projects/${createRes.body.result.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.result.name).toBe('Fetchable Project');
  });

  it('returns 404 for a nonexistent project id', async () => {
    const res = await request(app).get('/api/v1/projects/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('lists created projects', async () => {
    const createRes = await request(app).post('/api/v1/projects').send({ name: 'Listed Project' });
    createdProjectIds.push(createRes.body.result.id);

    const listRes = await request(app).get('/api/v1/projects');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.result)).toBe(true);
    expect(listRes.body.result.some((p: { id: string }) => p.id === createRes.body.result.id)).toBe(true);
  });
});
