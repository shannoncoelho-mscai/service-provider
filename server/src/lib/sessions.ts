import { pool } from '../config/database';
import { isRole, type Role } from '../shared/types';
import { tokenLifetimeMs } from './token';

/**
 * Server-side session store backing JWT revocation (ADR-015).
 * A valid token always maps to a live session row; logout flips revoked_at.
 */

export interface SessionUser {
  id: string;
  role: Role;
  sessionId: string;
}

export async function createSession(
  userId: string,
  userAgent: string | null,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + tokenLifetimeMs());
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, user_agent, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, userAgent ? userAgent.slice(0, 255) : null, expiresAt],
  );
  return { id: res.rows[0].id, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [sessionId],
  );
}

/**
 * ONE lookup answers everything requireAuth needs:
 * session exists + not revoked + not expired + user active — and returns the
 * role FRESH from the database so revoked privileges apply immediately
 * (the JWT's role claim is never trusted for authorization).
 */
export async function getActiveSessionUser(sessionId: string): Promise<SessionUser | null> {
  const res = await pool.query<{ id: string; role: string }>(
    `SELECT u.id, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active = TRUE`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row || !isRole(row.role)) return null; // fail closed
  return { id: row.id, role: row.role, sessionId };
}

/** Opportunistic cleanup of expired sessions (cheap, indexed). */
export async function purgeExpiredSessions(): Promise<void> {
  await pool.query('DELETE FROM auth_sessions WHERE expires_at < now()');
}
