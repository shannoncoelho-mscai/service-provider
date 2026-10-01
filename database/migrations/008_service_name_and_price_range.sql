-- ============================================================
-- 008 — services: spec naming + price range
-- ============================================================
-- Spec: a service contains "name", "priceFrom", "priceTo", "duration",
-- "active". The original table used a single `price` and `title`.

-- 1) price range --------------------------------------------------------
ALTER TABLE services ADD COLUMN price_from NUMERIC(10, 2);
ALTER TABLE services ADD COLUMN price_to   NUMERIC(10, 2);

-- Backfill existing rows from the legacy single-price column, then lock it.
UPDATE services SET price_from = price WHERE price_from IS NULL;

ALTER TABLE services
  ALTER COLUMN price_from SET NOT NULL,
  ADD CONSTRAINT chk_services_price_from CHECK (price_from >= 0),
  ADD CONSTRAINT chk_services_price_to   CHECK (price_to IS NULL OR price_to >= price_from);

ALTER TABLE services DROP COLUMN price;

-- 2) title → name (spec vocabulary) -------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'services'::regclass AND conname = 'services_title_check'
  ) THEN
    ALTER TABLE services DROP CONSTRAINT services_title_check;
  END IF;
END $$;

ALTER TABLE services RENAME COLUMN title TO name;

-- 3) constraints that read better under the new names ---------------------
-- Name: 3..120 chars after trimming (mirrors the API's zod rule).
ALTER TABLE services
  ADD CONSTRAINT chk_services_name CHECK (length(trim(name)) >= 3 AND length(name) <= 120);

-- The UNIQUE (provider_id, title) constraint survives the column rename
-- (constraints follow column attachment); only its name was stale.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'services'::regclass
       AND conname = 'services_provider_id_title_key'
  ) THEN
    ALTER TABLE services
      RENAME CONSTRAINT services_provider_id_title_key TO uq_services_provider_name;
  END IF;
END $$;

-- Tighter duration bounds than 003 (> 0). The API layer enforces the same
-- 15..1440 range; this is defence in depth for direct DB writes (ADR-020).
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_duration_minutes_check;
ALTER TABLE services
  ADD CONSTRAINT chk_services_duration
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 15 AND 1440);

-- "my services" listing: index already covers provider_id, this one also
-- orders/filter by active flag without a sort.
CREATE INDEX IF NOT EXISTS idx_services_provider_active
  ON services (provider_id, is_active, name);
