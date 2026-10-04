-- 012 — service_images (per-service photo gallery)
-- ============================================================
-- Photos attached to an INDIVIDUAL SERVICE, as distinct from the provider's
-- overall business gallery in provider_images (003). "AC Repair" shows an AC
-- unit, a technician and a completed job; those are not business photos.
--
-- Modelled on provider_images so the two read the same way, and so the public
-- profile query and the provider's own management UI can share conventions.

CREATE TABLE service_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services (id)
             ON DELETE CASCADE,          -- deleting a service removes its photos
  url        TEXT NOT NULL CHECK (url ~ '^https?://'),
  alt_text   TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, url)  -- re-uploading the same image is a mistake
);

-- Listing a service's images is the only read pattern; this covers the
-- ORDER BY sort_order in both the owner and the public query.
CREATE INDEX idx_service_images_service ON service_images (service_id, sort_order);

-- Keeps a provider from uploading the same file twice across concurrent
-- requests, mirroring provider_images.
COMMENT ON TABLE service_images IS
  'Photos attached to a single service. Distinct from provider_images, which '
  'holds the provider''s general business gallery.';
