import { MulterError } from 'multer';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env';
import { ACCEPTED_IMAGE_LABEL, MAX_IMAGE_BYTES, MAX_IMAGE_FILES } from './upload';
import { HttpError } from '../shared/httpError';

/** 404 passthrough for unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'Route not found'));
};

/**
 * Multer's own limit failures into safe 4xx responses.
 *
 * Without this, a 6 MB upload would surface as an opaque 500 (and in
 * development would echo Multer's message in `detail`). The messages state the
 * RULE — how big, how many, which types — which is public information the upload
 * UI already shows. They never contain a path, a field name from the request,
 * or anything else internal.
 */
function translateMulterError(err: MulterError): HttpError {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new HttpError(
        413,
        `Each image must be ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller`,
      );
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new HttpError(
        400,
        `You can upload at most ${MAX_IMAGE_FILES} images at a time`,
      );
    default:
      return new HttpError(400, `Invalid request — images must be ${ACCEPTED_IMAGE_LABEL}`);
  }
}

/**
 * Centralized error handler — the only place that formats error responses.
 * In production, unexpected errors return a generic message; details stay in
 * the server log so stack traces / SQL never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const multerError = err instanceof MulterError ? translateMulterError(err) : null;
  const known = multerError ?? (err instanceof HttpError ? err : null);
  const status = known ? known.status : 500;

  if (status >= 500) {
    console.error('[500]', err);
  }

  res.status(status).json({
    error: {
      status,
      message: known ? known.message : 'Internal server error',
      ...(env.NODE_ENV !== 'production' && !known && { detail: err.message }),
    },
  });
};
