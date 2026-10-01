import type { AuthUser } from './types';

/**
 * Makes req.user visible on every Express request type.
 * Populated exclusively by the requireAuth middleware — never by the client.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
