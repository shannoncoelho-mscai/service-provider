# database/

PostgreSQL schema, migrations and seed data for ServiceConnect.
**Implemented in Step 003 — see `docs/AI_DECISION_LOG.md` (ADR-010…ADR-014).**

## Quick start

```bash
docker compose up -d                                # start PostgreSQL 16
npm run migrate                                     # apply database/migrations/*.sql
npm run seed                                        # development fixtures (once)
npm run seed --workspace server -- --force          # wipe & reseed (dev only)
```

## Layout

```
database/
├── migrations/
│   ├── 001_extensions_enums_triggers.sql   # enum types + set_updated_at()
│   ├── 002_identity.sql                    # users, provider_profiles
│   ├── 003_catalog.sql                     # service_categories, services, provider_images
│   ├── 004_bookings_reviews.sql            # bookings, reviews
│   └── 005_admin_log_and_views.sql         # admin_action_log, public_providers view
└── seeds/                                  # (docs only — seeds run from server/src/db/seed.ts)
```

Migrations are **append-only** and checksum-tracked (`schema_migrations`);
editing an applied file is refused by the runner — add a new numbered file.

## Schema overview

| Table | Key constraints / indexes |
|---|---|
| `users` | UUID PK; `email` UNIQUE + lower/regex CHECK; `phone` partial UNIQUE; `role` enum; `password_hash` CHECK ≥20 chars (scrypt only); `is_active`; timestamps |
| `provider_profiles` | PK = FK → `users` 1:1; `verification_status` enum; **generated** `is_public`; partial index on `(city) WHERE APPROVED`; `verified_by` FK + CHECK; profile fields: phone (regex CHECK), `service_areas TEXT[]` (GIN), `profile_image_url`/`cover_image_url` (http CHECK); **search caches** `rating_avg`/`rating_count`/`price_min`/`active_service_count` (trigger-maintained, ADR-021) |
| `service_categories` | UUID PK; `name`/`slug` UNIQUE; `is_active`; timestamps |
| `services` | UUID PK; FK provider (CASCADE), FK category (RESTRICT); `UNIQUE (provider_id, name)`; price range CHECK (`price_to >= price_from`); duration CHECK 15–1440; index `(category_id, is_active)` + `(provider_id, is_active, name)` for owner listings |
| `provider_images` | FK provider (CASCADE); `UNIQUE (provider_id, url)`; partial UNIQUE primary image |
| `bookings` | 6-value status enum; composite `UNIQUE (id, customer_id)/(id, provider_id)`; partial UNIQUE live-slot index (anti double-booking); CHECKs: no self-booking, REJECTED/CANCELLED need reasons, `problem_description` 3–2000 chars (010); indexes on customer/provider/schedule + `(provider_id, status, scheduled_at DESC)` for the provider queue |
| `reviews` | `booking_id` UNIQUE (one per booking); composite FKs → bookings; rating CHECK 1–5 |
| `notifications` | `user_id` FK CASCADE; `type` enum (`notification_type`, 7 values); title/message length CHECKs; `related_booking_id` nullable FK CASCADE; `read_at` NULL = unread; indexes `(user_id, created_at DESC)`, partial `(user_id, created_at DESC) WHERE read_at IS NULL`, `(created_at DESC)` (011) |
| `admin_action_log` | FK admin **RESTRICT** (audit rows survive); `target_type` CHECK; indexes on target, admin+time, action+time |

**Public visibility rule:** only `verification_status = 'APPROVED'` providers
belong in public results — read them via the `public_providers` view (excludes
email/phone), never via raw `provider_profiles`.

## Passwords

`users.password_hash` contains only scrypt hashes produced by
`server/src/lib/password.ts` — **plaintext is never stored**
(verified in BUILD_LOG Step 003 tests).

## Seed data (development)

- 8 service categories
- 1 ADMIN, 2 CUSTOMERs, 11 fictional PROVIDERs:
  8 APPROVED (public) + 1 PENDING + 1 REJECTED + 1 SUSPENDED
- 19 services, 11 images, 7 bookings (all six statuses), 2 reviews, 3 admin logs
- Shared dev password `Password123!` (scrypt-hashed) — **development only**

Deterministic UUIDs (`00000000-0000-4000-8000-…`) keep fixtures referenceable.
The seeder skips if data exists; `--force` is refused when `NODE_ENV=production`.

## Conventions

- UUID PKs via `gen_random_uuid()` (PostgreSQL ≥ 13, no extension needed).
- `created_at`/`updated_at timestamptz DEFAULT now()`; `updated_at` maintained
  by trigger, not by application code.
- All application queries use parameters (`$1`, `$2`, …) — never string
  concatenation.
- Local credentials live only in `server/.env` (git-ignored), matching
  `docker-compose.yml`.
