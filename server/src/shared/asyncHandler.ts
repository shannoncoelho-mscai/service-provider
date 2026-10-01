import type { RequestHandler } from 'express';

/**
 * Wraps async route handlers so rejections reach the error handler.
 * Required on Express 4 (it only forwards synchronous throws automatically).
 */
export function asyncHandler(
  fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res)).catch(next);
  };
}
