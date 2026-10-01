-- ============================================================
-- 006 — auth_sessions (server-side revocation for JWTs)
-- ============================================================
-- JWTs are stateless, but logout must actually invalidate the token.
-- Each issued token carries `sid` = auth_sessions.id; requireAuth rejects
-- any token whose session row is missing, revoked or expired (ADR-015).

CREATE TABLE auth_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

-- Purge of expired sessions (runs opportunistically at login).
CREATE INDEX idx_auth_sessions_expires
  ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

-- "Sessions" page for a user / bulk revoke.
CREATE INDEX idx_auth_sessions_user
  ON auth_sessions (user_id, created_at DESC);
