// Thin fetch wrapper for the server's /api/v1 routes (server/app.ts). Relative URLs only:
// in production Express serves the built frontend and the API from the same origin
// (server/app.ts DEFAULT_STATIC_DIR + apiRouter both mounted on one app.listen), and in dev
// vite.config.ts proxies /api/v1 to `pnpm dev:server`. There is never a cross-origin case to
// configure a base URL for.
//
// This module is the ONLY place in the frontend allowed to call fetch() against the BESS API.
// Keep it free of React/UI concerns so it stays trivially testable and swappable.

const API_BASE = '/api/v1';

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details: Array<{ path?: string; message: string }>;
  correlationId: string;
}

/** Thrown for any non-2xx response or network/parse failure. Carries the server's structured error envelope when one was returned. */
export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Array<{ path?: string; message: string }>;
  readonly correlationId?: string;

  constructor(statusCode: number, envelope: Partial<ApiErrorEnvelope> & { message: string }) {
    super(envelope.message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = envelope.code ?? 'UNKNOWN_ERROR';
    this.details = envelope.details ?? [];
    this.correlationId = envelope.correlationId;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Envelope shape returned by every successful route: { result, correlationId }. */
interface SuccessEnvelope<T> {
  result: T;
  correlationId: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch (networkErr) {
    throw new ApiClientError(0, {
      code: 'NETWORK_ERROR',
      message: networkErr instanceof Error ? networkErr.message : 'Network request failed'
    });
  }

  let json: unknown;
  try {
    json = response.status === 204 ? undefined : await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiClientError(response.status, { message: `Request failed with status ${response.status}` });
    }
    throw new ApiClientError(response.status, { code: 'INVALID_JSON', message: 'Server response was not valid JSON' });
  }

  if (!response.ok) {
    const envelope = (json as { error?: ApiErrorEnvelope } | undefined)?.error;
    throw new ApiClientError(response.status, envelope ?? { message: `Request failed with status ${response.status}` });
  }

  return (json as SuccessEnvelope<T>).result;
}
