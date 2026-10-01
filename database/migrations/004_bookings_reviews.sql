-- ============================================================
-- 004 — bookings & reviews
-- ============================================================

CREATE TABLE bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider_id      UUID NOT NULL REFERENCES provider_profiles (user_id)
                   ON DELETE CASCADE,
  service_id       UUID REFERENCES services (id) ON DELETE RESTRICT,
  status           booking_status NOT NULL DEFAULT 'PENDING',
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INT CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  address          TEXT,
  notes            TEXT,
  price_quote      NUMERIC(10, 2) CHECK (price_quote IS NULL OR price_quote >= 0),
  cancellation_reason TEXT,
  rejection_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (customer_id <> provider_id),  -- no self-bookings
  -- Rejecting/cancelling must explain why (enforced for the two terminal
  -- states where a human made the call).
  CHECK (status <> 'REJECTED'    OR rejection_reason IS NOT NULL),
  CHECK (status <> 'CANCELLED'   OR cancellation_reason IS NOT NULL),

  -- Composite keys used by reviews' composite foreign keys below:
  -- guarantee a review references the SAME customer/provider as its booking.
  UNIQUE (id, customer_id),
  UNIQUE (id, provider_id)
);

CREATE INDEX idx_bookings_customer ON bookings (customer_id, created_at DESC);
CREATE INDEX idx_bookings_provider ON bookings (provider_id, created_at DESC);
CREATE INDEX idx_bookings_schedule ON bookings (scheduled_at);

-- Anti double-booking: a customer cannot hold two live bookings for the
-- same service at the same time (history stays free for repeats later).
CREATE UNIQUE INDEX uq_bookings_live_slot
  ON bookings (customer_id, service_id, scheduled_at)
  WHERE status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS');

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  -- Composite FKs: (booking_id, customer_id) must exist in bookings —
  -- a customer cannot review a booking that belongs to someone else.
  customer_id UUID NOT NULL,
  provider_id UUID NOT NULL,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (booking_id, customer_id)
    REFERENCES bookings (id, customer_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id, provider_id)
    REFERENCES bookings (id, provider_id) ON DELETE CASCADE,

  CHECK (customer_id <> provider_id),
  CHECK (comment IS NULL OR length(trim(comment)) <= 2000)
);

CREATE INDEX idx_reviews_provider ON reviews (provider_id, created_at DESC);
CREATE INDEX idx_reviews_customer ON reviews (customer_id);

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
