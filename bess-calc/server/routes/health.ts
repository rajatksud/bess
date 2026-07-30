import { Router } from 'express';
import { APP_VERSION, CALCULATION_ENGINE_VERSION, GIT_COMMIT_SHA } from '../lib/version';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptimeSeconds: process.uptime() });
});

healthRouter.get('/version', (_req, res) => {
  res.status(200).json({
    appVersion: APP_VERSION,
    calculationEngineVersion: CALCULATION_ENGINE_VERSION,
    gitCommitSha: GIT_COMMIT_SHA,
    nodeVersion: process.version
  });
});
