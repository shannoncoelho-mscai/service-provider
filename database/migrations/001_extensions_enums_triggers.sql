-- ============================================================
-- 001 — Extensions, enum types, updated_at trigger
-- ============================================================
-- Enum types give us database-level enforcement of the roles/statuses
-- required by the spec. Application code must insert the string labels;
-- PostgreSQL validates them. New values require a new migration.

CREATE TYPE user_role AS ENUM ('CUSTOMER', 'PROVIDER', 'ADMIN');

CREATE TYPE verification_status AS ENUM
  ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

CREATE TYPE booking_status AS ENUM
  ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED');

-- gen_random_uuid() is built into PostgreSQL >= 13 (no extension needed).

-- Keep updated_at honest: maintained by the database, not the client.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
