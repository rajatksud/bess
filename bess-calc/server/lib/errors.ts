export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function buildErrorEnvelope(code: string, message: string, details: ApiErrorDetail[], correlationId: string) {
  return {
    error: {
      code,
      message,
      details,
      correlationId
    }
  };
}
