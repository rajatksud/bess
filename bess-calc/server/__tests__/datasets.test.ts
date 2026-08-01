import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { hasDatabaseUrl, getTestPrismaClient, cleanupProject } from './persistenceTestSetup';

const csvText = 'timestamp,load_kw,solar_kw\n2026-01-01T00:00:00Z,100,0\n2026-01-01T00:15:00Z,120,0\n2026-01-01T00:30:00Z,90,10\n';

describe.runIf(hasDatabaseUrl)('persistence: /api/v1/datasets/import', () => {
  const prisma = getTestPrismaClient();
  const app = createApp({ prismaClient: prisma });
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      await cleanupProject(prisma, createdProjectIds.pop()!);
    }
  });

  async function createProject(name: string) {
    const res = await request(app).post('/api/v1/projects').send({ name });
    createdProjectIds.push(res.body.result.id);
    return res.body.result.id as string;
  }

  it('imports a CSV and persists an IntervalDataset with bulk-inserted records', async () => {
    const projectId = await createProject('Dataset Import Project');
    const res = await request(app).post('/api/v1/datasets/import').send({
      projectId, csvText, tariffTimezone: 'UTC', mode: 'permissive', allowIrregular: true
    });
    expect(res.status).toBe(201);
    expect(res.body.result.datasetId).toBeDefined();
    expect(res.body.result.summary.acceptedRows).toBe(3);

    const records = await prisma.intervalRecord.findMany({ where: { datasetId: res.body.result.datasetId } });
    expect(records).toHaveLength(3);
  });

  it('returns 404 when the project does not exist', async () => {
    const res = await request(app).post('/api/v1/datasets/import').send({
      projectId: '00000000-0000-0000-0000-000000000000', csvText, tariffTimezone: 'UTC'
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('returns a validation error for a malformed request body', async () => {
    const projectId = await createProject('Dataset Validation Project');
    const res = await request(app).post('/api/v1/datasets/import').send({ projectId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
