import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/errors';

const createProjectSchema = z.object({
  name: z.string().min(1),
  customerName: z.string().min(1).optional(),
  location: z.string().min(1).optional()
});

/** Persistence-backed project CRUD. Takes an injected PrismaClient so tests can point it at a test database independent of the process-wide client used by the running server. */
export function createProjectsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/projects', async (req, res, next) => {
    try {
      const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
      res.status(200).json({ result: projects, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  router.post('/projects', async (req, res, next) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await prisma.project.create({ data: body });
      res.status(201).json({ result: project, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/:id', async (req, res, next) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) {
        throw new ApiError(404, 'PROJECT_NOT_FOUND', `No project with id ${req.params.id}`);
      }
      res.status(200).json({ result: project, correlationId: req.correlationId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
