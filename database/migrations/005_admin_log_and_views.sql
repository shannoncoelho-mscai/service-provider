-- ============================================================
-- 005 — admin_action_log & public_providers view
-- ============================================================

CREATE TABLE admin_action_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT (not CASCADE): audit rows must survive; deleting an admin
  -- account that has audit history is forbidden.
  admin_id       UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  action         TEXT NOT NULL
                 CHECK (length(trim(action)) >= 3),
  target_type    TEXT NOT NULL
                 CHECK (target_type IN ('USER', 'PROVIDER_PROFILE', 'SERVICE', 'BOOKING')),
  target_id      UUID NOT NULL,
  previous_status TEXT,     -- e.g. previous verification_status
  new_status      TEXT,     -- e.g. new verification_status
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_log_target   ON admin_action_log (target_type, target_id);
CREATE INDEX idx_admin_log_admin    ON admin_action_log (admin_id, created_at DESC);
CREATE INDEX idx_admin_log_action   ON admin_action_log (action, created_at DESC);

-- ------------------------------------------------------------
-- PUBLIC DIRECTORY RULE: only APPROVED providers are visible.
-- Every public-facing query should read from this view (or repeat the
-- verification_status = 'APPROVED' predicate — never trust the client).
-- Contact details (email/phone) are deliberately excluded.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public_providers AS
SELECT
  p.user_id            AS id,
  p.business_name,
  p.description,
  p.city,
  p.address,
  p.years_experience,
  p.hourly_rate,
  p.verified_at,
  p.created_at
FROM provider_profiles p
JOIN users u ON u.id = p.user_id
WHERE p.verification_status = 'APPROVED'
  AND u.is_active;
