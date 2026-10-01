-- ============================================================
-- 002 — users & provider_profiles (identity)
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Emails are normalized to lowercase by the app and enforced here so the
  -- UNIQUE constraint gives case-insensitive uniqueness.
  email         TEXT NOT NULL
                CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- Never plaintext: scrypt/argon2/bcrypt formatted hash (see docs/SECURITY.md).
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
  full_name     TEXT NOT NULL CHECK (length(trim(full_name)) >= 2),
  phone         TEXT,
  role          user_role NOT NULL DEFAULT 'CUSTOMER',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,   -- soft ban/disable flag
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

-- Optional phone uniqueness: only when a phone is provided.
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_role ON users (role);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE provider_profiles (
  -- 1:1 with users; the PK is also the FK to keep identity and profile atomic.
  user_id             UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  business_name       TEXT NOT NULL CHECK (length(trim(business_name)) >= 2),
  description         TEXT,
  city                TEXT NOT NULL,
  address             TEXT,
  years_experience    INT NOT NULL DEFAULT 0 CHECK (years_experience >= 0),
  hourly_rate         NUMERIC(10, 2) CHECK (hourly_rate IS NULL OR hourly_rate > 0),
  verification_status verification_status NOT NULL DEFAULT 'PENDING',
  -- Generated column: "public" is derived, so it can never drift from status.
  is_public           BOOLEAN GENERATED ALWAYS AS
                      (verification_status = 'APPROVED') STORED,
  verified_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An admin decision must record who made it.
  CHECK (verified_at IS NULL OR verified_by IS NOT NULL)
);

-- Public directory reads: only APPROVED providers, fast lookup by city.
CREATE INDEX idx_provider_profiles_public_city
  ON provider_profiles (city)
  WHERE verification_status = 'APPROVED';

CREATE INDEX idx_provider_profiles_status ON provider_profiles (verification_status);

CREATE TRIGGER trg_provider_profiles_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
