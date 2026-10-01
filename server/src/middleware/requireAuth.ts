import type { RequestHandler } from 'express';
import { getActiveSessionUser } from '../lib/sessions';
import { verifyAccessToken } from '../lib/token';
import { HttpError } from '../shared/httpError';

/**
 * Authentication middleware (reusable — see ADR-015).
 *
 * Order of checks, all fail-closed:
 *   1. `Authorization: Bearer <token>` header present
 *   2. JWT signature, expiry, issuer and claim shape valid (lib/token)
 *   3. Session row live (not revoked/expired) + user still active,
 *      role re-read FROM THE DATABASE — the token's role claim and anything
 *      the frontend sends are never trusted for authorization.
 *
 * On success: req.user = { id, role, sessionId }.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Authentication required');
    }

    const claims = verifyAccessToken(header.slice('Bearer '.length).trim());

    const user = await getActiveSessionUser(claims.sid);
    if (!user) {
      // Covers logout (revoked), expiry, deleted and deactivated accounts.
      throw new HttpError(401, 'Session expired or revoked');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
