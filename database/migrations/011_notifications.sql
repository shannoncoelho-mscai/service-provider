-- ============================================================
-- 011 — in-app notifications (Phase 16)
-- ============================================================
-- Bookings already move through a strict state machine (004), and three
-- audiences need to learn about those moves: the customer who made the
-- booking, the provider who has to do the work, and (for verification)
-- admins. Until now the only way to find out was to reload a page and look.
--
-- This adds a generic, database-backed notification table. It is deliberately
-- NOT a second source of booking truth: `related_booking_id` points at the
-- booking that caused it and the bookings table stays authoritative. Every row
-- is created by server-side business logic inside the same transaction as the
-- state change that caused it, so a notification can never describe a
-- transition that did not happen.
--
-- PRIVACY. A notification is a short, user-facing sentence. Nothing here stores
-- an email, phone number, address, password, hash, token or session id. The
-- title/message length CHECKs are a hard backstop against a notification being
-- used as a dumping ground for request payloads.
--
-- The type is an enum rather than free TEXT so an unknown kind cannot be
-- introduced by a careless INSERT, and so the client can rely on a closed set
-- when deciding how to link a notification.

CREATE TYPE notification_type AS ENUM (
  'BOOKING_CREATED',     -- customer: request sent;  provider: new request
  'BOOKING_ACCEPTED',    -- customer
  'BOOKING_REJECTED',    -- customer
  'BOOKING_CANCELLED',   -- provider
  'BOOKING_IN_PROGRESS', -- customer
  'BOOKING_COMPLETED',   -- customer
  'REVIEW_SUBMITTED'     -- provider: a rating was left
);

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A notification belongs to exactly ONE user. CASCADE (not RESTRICT, unlike
  -- admin_action_log) because a notification is meaningless once its recipient
  -- is gone, and a user must stay deletable without leaving orphans.
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type              notification_type NOT NULL,
  title             TEXT NOT NULL
                      CHECK (length(trim(title)) BETWEEN 1 AND 120),
  message           TEXT NOT NULL
                      CHECK (length(trim(message)) BETWEEN 1 AND 300),
  -- Nullable on purpose: not every notification has a booking behind it (a
  -- future system announcement, for example). ON DELETE CASCADE so deleting a
  -- booking does not leave a dangling reference.
  related_booking_id UUID REFERENCES bookings (id) ON DELETE CASCADE,
  -- NULL means unread. read_at rather than a boolean so "when was it read" is
  -- answerable for free, which the panel's relative timestamps need.
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The list query: "my notifications, newest first, optional unread filter".
-- user_id + created_at DESC serves both the filter and the ordering, so this is
-- the index that matters most.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- The unread count and the unread filter. A partial index keeps it small: a
-- user with 900 read notifications still has only their unread rows here.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Retention sweeps and any future cross-user (admin) reporting.
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);

COMMENT ON TABLE notifications IS
  'In-app notifications. Created ONLY by server-side business logic, inside the transaction of the booking state change that caused them. Never contains credentials, contact details or session data.';

COMMENT ON COLUMN notifications.related_booking_id IS
  'The booking this notification is about. NULL for non-booking notifications. The client links to it via a route it builds itself, never to a URL supplied by this table.';

COMMENT ON COLUMN notifications.read_at IS
  'NULL = unread. Set once, by the owner of the notification, always scoped by user_id.';
