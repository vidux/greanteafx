import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  AssetNotFoundError,
  AudioDecodeError,
  DomainError,
  RenderFailedError,
  ServerBusyError,
  ValidationError,
} from '@/domain/errors';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * The one place that knows how domain failures become HTTP status codes. Anything
 * unrecognised is logged and reported as a 500 with a generic message — internal details
 * (stack traces, filesystem paths) never reach the client.
 */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return json(400, 'VALIDATION_ERROR', 'Request body failed validation.', error.issues);
  }

  if (error instanceof ValidationError) {
    return json(400, error.code, error.message, error.details);
  }

  if (error instanceof AssetNotFoundError) {
    return json(404, error.code, error.message);
  }

  if (error instanceof AudioDecodeError) {
    // The bytes the client sent are not decodable — that is a client-side problem.
    return json(415, error.code, error.message);
  }

  if (error instanceof ServerBusyError) {
    return json(503, error.code, error.message, undefined, { 'Retry-After': '5' });
  }

  if (error instanceof RenderFailedError) {
    return json(500, error.code, error.message);
  }

  if (error instanceof DomainError) {
    return json(400, error.code, error.message);
  }

  console.error('[greanteafx] unhandled error', error);
  return json(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

function json(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers: Record<string, string> = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}
