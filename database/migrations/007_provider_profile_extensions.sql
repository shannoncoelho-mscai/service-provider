-- ============================================================
-- 007 — provider profile extensions (onboarding fields) + public view
-- ============================================================
-- Profile now supports: business name, description, phone, location
-- (city + address), service area, experience, profile image, cover image.

ALTER TABLE provider_profiles
  ADD COLUMN phone TEXT,
  ADD COLUMN service_areas TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN profile_image_url TEXT,
  ADD COLUMN cover_image_url TEXT;

ALTER TABLE provider_profiles
  ADD CONSTRAINT chk_provider_profiles_phone
  CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{7,20}$');

ALTER TABLE provider_profiles
  ADD CONSTRAINT chk_provider_profiles_profile_image
  CHECK (profile_image_url IS NULL OR profile_image_url ~ '^https?://');

ALTER TABLE provider_profiles
  ADD CONSTRAINT chk_provider_profiles_cover_image
  CHECK (cover_image_url IS NULL OR cover_image_url ~ '^https?://');

-- Service-area based public search ("providers near me").
CREATE INDEX idx_provider_profiles_service_areas
  ON provider_profiles USING GIN (service_areas);

-- Public directory view: append the new (non-contact) columns.
-- CREATE OR REPLACE keeps the existing column order; email/phone stay
-- private — customers contact providers through bookings (ADR-018).
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
  p.created_at,
  p.service_areas,
  p.profile_image_url,
  p.cover_image_url
FROM provider_profiles p
JOIN users u ON u.id = p.user_id
WHERE p.verification_status = 'APPROVED'
  AND u.is_active;
