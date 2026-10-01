-- ============================================================
-- 010 — bookings: problem description (booking workflow, Step 009)
-- ============================================================
-- The customer booking flow collects a "problem description" (what is wrong)
-- separately from "notes" (extra instructions for the visit). The original
-- 004 table only has `notes`, so the two would be conflated and the provider
-- would lose the most important field.
--
-- Nullable on purpose: rows seeded by `npm run seed` predate this column and
-- must remain valid. New bookings always supply it (enforced in the API
-- schema and by the length CHECK below).
--
-- The bookings table itself is REUSED as-is. Everything from 004 already
-- holds: customer/provider/service FKs, the booking_status enum, the
-- no-self-booking CHECK, the reason CHECKs for REJECTED/CANCELLED, and the
-- anti double-booking partial unique index. No duplicate tables are created.

ALTER TABLE bookings
  ADD COLUMN problem_description TEXT;

ALTER TABLE bookings
  ADD CONSTRAINT chk_bookings_problem_description
  CHECK (
    problem_description IS NULL
    OR length(trim(problem_description)) BETWEEN 3 AND 2000
  );

-- Booking inbox: providers filter their queue by status then recency.
-- idx_bookings_provider already covers (provider_id, created_at DESC); this
-- variant matches the exact queue query used by GET /api/provider/bookings.
CREATE INDEX IF NOT EXISTS idx_bookings_provider_status
  ON bookings (provider_id, status, scheduled_at DESC);

COMMENT ON COLUMN bookings.problem_description IS
  'What the customer needs fixed, 3-2000 chars. NULL only for rows seeded before Step 009.';
