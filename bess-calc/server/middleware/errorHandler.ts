import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError, buildErrorEnvelope } from '../lib/errors';
import { logger } from '../lib/logger';

/** Express 4-arg error handler. Must be registered last. Never includes a stack trace in the response body. */
export function errorHandlerMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.correlationId ?? 'unknown';

  if (err instanceof ApiError) {
    logger.warn('api_error', { correlationId, code: err.code, statusCode: err.statusCode, message: err.message });
    res.status(err.statusCode).json(buildErrorEnvelope(err.code, err.message, err.details, correlationId));
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    logger.warn('validation_error', { correlationId, details });
    res.status(400).json(buildErrorEnvelope('VALIDATION_ERROR', 'Input data is invalid', details, correlationId));
    return;
  }

  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400 && 'body' in err) {
    // Malformed JSON body (thrown by express.json()).
    logger.warn('malformed_json', { correlationId });
    res.status(400).json(buildErrorEnvelope('MALFORMED_JSON', 'Request body is not valid JSON', [], correlationId));
    return;
  }

  if (err instanceof Error && err.name === 'PayloadTooLargeError') {
    logger.warn('payload_too_large', { correlationId });
    res.status(413).json(buildErrorEnvelope('PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum allowed size', [], correlationId));
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('unhandled_error', { correlationId, message, stack: err instanceof Error ? err.stack : undefined });
  // Deliberately omit `message`/stack details from the client-facing response - only
  // the server-side log line above carries them.
  res.status(500).json(buildErrorEnvelope('INTERNAL_ERROR', 'An unexpected error occurred', [], correlationId));
}

/** Catches unmatched API routes under /api/v1 with the standard error envelope instead of Express's default HTML 404. */
export function apiNotFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json(buildErrorEnvelope('NOT_FOUND', `No route matches ${req.method} ${req.path}`, [], req.correlationId ?? 'unknown'));
}
