import type { RequestHandler } from 'express';
import { HttpError } from '../shared/httpError';
import type { Role } from '../shared/types';

/**
 * Server-side role gate. Always pair with requireAuth in front of it.
 *
 *   router.delete('/bookings/:id', requireAuth, requireRole('ADMIN'), handler);
 *
 * Fails closed: no user on the request → 401; role not allowed → 403.
 * Hiding UI elements is NOT authorization — this middleware is.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  if (allowed.length === 0) {
    throw new Error('requireRole requires at least one role');
  }
  return (req, _res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'Authentication required'));
    }
    if (!allowed.includes(req.user.role)) {
      return next(new HttpError(403, 'Insufficient permissions'));
    }
    next();
  };
}
