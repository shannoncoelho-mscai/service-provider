import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError } from '../shared/httpError';
import { isRole, type Role } from '../shared/types';

/**
 * Access-token helpers (ADR-015).
 *
 * Token = proof of identity (signed with JWT_SECRET from the environment —
 * never hard-coded). It is NOT trusted for authorization state: the session
 * row and the user row are re-checked on every request by requireAuth.
 *
 * Claims: sub = user id, role = role at issuance (informational only),
 * sid = auth_sessions.id → revocation handle for logout.
 */

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  sid: string;
}

const ISSUER = 'serviceconnect';
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** JWT_EXPIRES_IN is validated as /^\\d+[smhd]$/ in config/env.ts. */
export function tokenLifetimeMs(): number {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_EXPIRES_IN);
  if (!match) {
    throw new Error(`JWT_EXPIRES_IN must look like 15m, 1h or 24h (got "${env.JWT_EXPIRES_IN}")`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ role: claims.role, sid: claims.sid }, env.JWT_SECRET, {
    subject: claims.sub,
    issuer: ISSUER,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

/** Signature + expiry + claim shape. Throws HttpError(401) — fail closed. */
export function verifyAccessToken(token: string): AccessTokenClaims {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER });
  } catch {
    // Deliberately generic — never reveal WHY a token was rejected.
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.sid !== 'string' ||
    !isRole(payload.role)
  ) {
    throw new HttpError(401, 'Invalid token');
  }
  return { sub: payload.sub, role: payload.role, sid: payload.sid };
}
