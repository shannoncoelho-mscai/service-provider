-- ============================================================
-- 009 — public provider search: denormalized stats + indexes
-- ============================================================
-- Search needs to filter and SORT on rating, price and recency. Aggregating
-- reviews/services on every request is correct but slow and un-indexable, so
-- we maintain the aggregates as columns, refreshed by trigger. Sorting then
-- becomes an index scan instead of a full aggregate + sort.
--
-- The columns are a *cache*, never the source of truth: the trigger
-- recomputes them from `services` and `reviews` on every write, and the
-- search API re-verifies `verification_status = 'APPROVED'` in the query.

-- Trigram matching gives indexed, typo-tolerant keyword search. Without it,
-- `business_name ILIKE '%x%'` is an unindexed sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --- availability ---------------------------------------------------------
-- Scoped interpretation of "availability" for the search step: a provider is
-- available when they currently offer at least one ACTIVE service. Real
-- time-slot availability belongs to the booking feature (ADR-021).
ALTER TABLE provider_profiles
  ADD COLUMN active_service_count INT NOT NULL DEFAULT 0,
  ADD COLUMN rating_avg    NUMERIC(3, 2),
  ADD COLUMN rating_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN price_min     NUMERIC(10, 2);

ALTER TABLE provider_profiles
  ADD CONSTRAINT chk_provider_profiles_rating_avg
    CHECK (rating_avg IS NULL OR rating_avg BETWEEN 0 AND 5),
  ADD CONSTRAINT chk_provider_profiles_rating_count
    CHECK (rating_count >= 0),
  ADD CONSTRAINT chk_provider_profiles_active_service_count
    CHECK (active_service_count >= 0),
  ADD CONSTRAINT chk_provider_profiles_price_min
    CHECK (price_min IS NULL OR price_min >= 0);

-- --- recompute function ---------------------------------------------------
-- Single source of recomputation, shared by the services and reviews
-- triggers, so the two can never drift apart.
CREATE OR REPLACE FUNCTION refresh_provider_search_stats(p_provider_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE provider_profiles p
     SET active_service_count = COALESCE(s.svc_count, 0),
         price_min            = s.price_min,
         rating_avg           = r.rating_avg,
         rating_count         = COALESCE(r.rating_count, 0)
    FROM (SELECT count(*)::int AS svc_count,
                 min(price_from) AS price_min
            FROM services
           WHERE provider_id = p_provider_id
             AND is_active) s,
         (SELECT round(avg(rating), 2) AS rating_avg,
                 count(*)::int        AS rating_count
            FROM reviews
           WHERE provider_id = p_provider_id) r
   WHERE p.user_id = p_provider_id;
END;
$$ LANGUAGE plpgsql;

-- AFTER triggers. A trigger's argument list may only contain literals, so
-- `NEW.provider_id` is not allowed as an argument — the id is extracted
-- inside the function instead, where NEW/OLD are in scope.
CREATE OR REPLACE FUNCTION refresh_search_stats_trigger()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_provider_search_stats(OLD.provider_id);
  ELSE
    PERFORM refresh_provider_search_stats(NEW.provider_id);
    -- An UPDATE that moves a row between providers must refresh both.
    IF TG_OP = 'UPDATE' AND OLD.provider_id IS DISTINCT FROM NEW.provider_id THEN
      PERFORM refresh_provider_search_stats(OLD.provider_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_services_refresh_stats
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION refresh_search_stats_trigger();

CREATE TRIGGER trg_reviews_refresh_stats
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_search_stats_trigger();


-- Backfill existing rows.
UPDATE provider_profiles p
   SET active_service_count = COALESCE(s.svc_count, 0),
       price_min            = s.price_min,
       rating_avg           = r.rating_avg,
       rating_count         = COALESCE(r.rating_count, 0)
  FROM (SELECT provider_id, count(*)::int AS svc_count, min(price_from) AS price_min
          FROM services WHERE is_active GROUP BY provider_id) s
  FULL JOIN (SELECT provider_id, round(avg(rating), 2) AS rating_avg,
                    count(*)::int AS rating_count
               FROM reviews GROUP BY provider_id) r
    ON r.provider_id = s.provider_id
 WHERE s.provider_id = p.user_id OR r.provider_id = p.user_id;

-- --- search indexes (partial: only APPROVED providers are ever searched) --
-- Rating: unrated providers sort last rather than dominating a DESC scan.
CREATE INDEX idx_provider_profiles_public_rating
  ON provider_profiles (rating_avg DESC NULLS LAST, created_at DESC)
  WHERE verification_status = 'APPROVED';

CREATE INDEX idx_provider_profiles_public_price
  ON provider_profiles (price_min)
  WHERE verification_status = 'APPROVED' AND price_min IS NOT NULL;

CREATE INDEX idx_provider_profiles_public_newest
  ON provider_profiles (created_at DESC)
  WHERE verification_status = 'APPROVED';

CREATE INDEX idx_provider_profiles_public_available
  ON provider_profiles (active_service_count)
  WHERE verification_status = 'APPROVED' AND active_service_count > 0;

-- Keyword search.
CREATE INDEX idx_provider_profiles_business_trgm
  ON provider_profiles USING GIN (business_name gin_trgm_ops);
CREATE INDEX idx_provider_profiles_description_trgm
  ON provider_profiles USING GIN (description gin_trgm_ops);

-- --- extend the public view with the searchable columns -------------------
-- CREATE OR REPLACE VIEW may only APPEND columns, which is exactly what we
-- want: the existing public column list and its ordering are preserved.
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
  p.cover_image_url,
  p.active_service_count,
  p.rating_avg,
  p.rating_count,
  p.price_min
FROM provider_profiles p
JOIN users u ON u.id = p.user_id
WHERE p.verification_status = 'APPROVED'
  AND u.is_active;

COMMENT ON COLUMN provider_profiles.price_min IS
  'Search cache: lowest price_from across ACTIVE services. Recomputed by trigger; never authoritative.';
COMMENT ON COLUMN provider_profiles.rating_avg IS
  'Search cache: mean review rating, NULL when unreviewed. Recomputed by trigger.';
