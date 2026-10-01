import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env';
import { HttpError } from '../shared/httpError';

/** 404 passthrough for unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'Route not found'));
};

/**
 * Centralized error handler — the only place that formats error responses.
 * In production, unexpected errors return a generic message; details stay in
 * the server log so stack traces / SQL never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const isKnown = err instanceof HttpError;
  const status = isKnown ? err.status : 500;

  if (status >= 500) {
    console.error('[500]', err);
  }

  res.status(status).json({
    error: {
      status,
      message: isKnown ? err.message : 'Internal server error',
      ...(env.NODE_ENV !== 'production' && !isKnown && { detail: err.message }),
    },
  });
};
