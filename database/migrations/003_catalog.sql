-- ============================================================
-- 003 — service_categories, services, provider_images (catalog)
-- ============================================================

CREATE TABLE service_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE
              CHECK (length(trim(name)) >= 2),
  slug        TEXT NOT NULL UNIQUE
              CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_service_categories_updated_at
  BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      UUID NOT NULL REFERENCES provider_profiles (user_id)
                   ON DELETE CASCADE,
  category_id      UUID NOT NULL REFERENCES service_categories (id)
                   ON DELETE RESTRICT,   -- categories are stable reference data
  title            TEXT NOT NULL CHECK (length(trim(title)) >= 3),
  description      TEXT,
  price            NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  price_type       TEXT NOT NULL DEFAULT 'FIXED'
                   CHECK (price_type IN ('FIXED', 'HOURLY')),
  duration_minutes INT CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, title)   -- no duplicate service names per provider
);

CREATE INDEX idx_services_category ON services (category_id, is_active);
CREATE INDEX idx_services_provider ON services (provider_id);

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE provider_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles (user_id)
              ON DELETE CASCADE,
  url        TEXT NOT NULL CHECK (url ~ '^https?://'),
  alt_text   TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, url)   -- same image uploaded twice is a mistake
);

CREATE INDEX idx_provider_images_provider ON provider_images (provider_id);

-- Exactly one primary image per provider (0..1 by convention).
CREATE UNIQUE INDEX uq_provider_images_primary
  ON provider_images (provider_id)
  WHERE is_primary;
