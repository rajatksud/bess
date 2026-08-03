import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

const REQUEST_HEADER = 'x-correlation-id';
const RESPONSE_HEADER = 'x-correlation-id';

/** Reuses an inbound X-Correlation-Id if present (and looks plausible), otherwise mints a new UUID. */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_HEADER);
  const id = inbound && /^[\w-]{1,128}$/.test(inbound) ? inbound : randomUUID();
  req.correlationId = id;
  res.setHeader(RESPONSE_HEADER, id);
  next();
}
