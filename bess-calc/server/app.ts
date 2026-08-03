import express, { Express } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { correlationIdMiddleware } from './middleware/correlationId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { errorHandlerMiddleware, apiNotFoundMiddleware } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { tariffRouter } from './routes/tariff';
import { importRouter } from './routes/importValidate';
import { simulationRouter } from './routes/simulation';
import { optimisationRouter } from './routes/optimisation';
import { createProjectsRouter } from './routes/projects';
import { createScenariosRouter } from './routes/scenarios';
import { createDatasetsRouter } from './routes/datasets';
import { createSimulationsRouter } from './routes/simulations';
import { getPrismaClient } from './lib/prisma';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  /** Absolute path to the built frontend's static assets (dist/). If omitted, static frontend serving is skipped (useful for API-only tests). */
  staticDir?: string;
  requestTimeoutMs?: number;
  /**
   * Injected Prisma client, used by the persistence-backed routes
   * (projects/scenarios/datasets/simulations) only. Tests inject a client pointed at
   * a test database; production/dev falls back to the lazily-created shared client.
   * The pre-existing stateless routes (simulation/run, tariff/calculate,
   * optimisation/run) never touch this - they have no DB dependency regardless of
   * whether this option is provided.
   */
  prismaClient?: PrismaClient;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  // No app.use(cors()) - default is same-origin only. If a future deployment needs
  // cross-origin API access, that must be an explicit, reviewed allowlist addition,
  // never a wildcard.
  app.disable('x-powered-by');

  app.use(correlationIdMiddleware);
  app.use(requestLoggerMiddleware);

  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  app.use((req, res, next) => {
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(503).json({
          error: { code: 'REQUEST_TIMEOUT', message: 'Request exceeded the server timeout', details: [], correlationId: req.correlationId }
        });
      }
    });
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  const prisma = options.prismaClient ?? getPrismaClient();

  const apiRouter = express.Router();
  apiRouter.use(healthRouter);
  apiRouter.use(tariffRouter);
  apiRouter.use(importRouter);
  apiRouter.use(simulationRouter);
  apiRouter.use(optimisationRouter);
  apiRouter.use(createProjectsRouter(prisma));
  apiRouter.use(createScenariosRouter(prisma));
  apiRouter.use(createDatasetsRouter(prisma));
  apiRouter.use(createSimulationsRouter(prisma));
  apiRouter.use(apiNotFoundMiddleware);

  app.use('/api/v1', apiRouter);

  if (options.staticDir) {
    const staticDir = options.staticDir;
    // dotfiles: 'allow' is required because `send`'s default ('ignore') 404s any path
    // with a segment starting with "." - which includes this project's own checkout
    // path in some environments (e.g. under a .claude/worktrees/ directory), not just
    // genuine dotfiles inside staticDir itself.
    app.use(express.static(staticDir, { dotfiles: 'allow' }));
    // SPA fallback for non-API browser routes only - anything under /api/v1 was
    // already handled (and 404'd via apiNotFoundMiddleware) above.
    app.get(/^(?!\/api\/v1).*/, (_req, res, next) => {
      res.sendFile(join(staticDir, 'index.html'), { dotfiles: 'allow' }, (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(errorHandlerMiddleware);

  return app;
}

export const DEFAULT_STATIC_DIR = join(__dirname, '..', 'dist');
