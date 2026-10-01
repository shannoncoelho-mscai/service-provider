# AI Decision Log — ServiceConnect

ADR-style record of architecture decisions: context, decision, alternatives,
consequences. Status: `accepted` | `superseded` | `deferred`.

---

## ADR-001 — Technology stack

**Status:** accepted · **Date:** 2026-09-30

**Context.** College project that should demonstrate production-style engineering.

**Decision.**
- Client: React + TypeScript + Vite + Tailwind CSS v4 + React Router + Lucide icons
- Server: Node.js + Express + TypeScript (strict)
- Database: PostgreSQL
- Auth: role-based JWT enforced server-side

**Alternatives.** Next.js (adds framework complexity without SSR needs),
MongoDB (relational data: users → providers → services → bookings fits SQL),
REST via Next API routes (harder to deploy/scale independently).

**Consequences.** Two separate deployables; API is reusable by any client.

---

## ADR-002 — Monorepo with npm workspaces

**Status:** accepted · **Date:** 2026-09-30

**Decision.** Single repository, root `package.json` with workspaces
`["server", "client"]`; shared `Role` types duplicated minimally (typed
constants) instead of a shared package for now.

**Alternatives.** `turbo`/`pnpm` workspaces (overkill at this size),
two repos (drift, painful onboarding), `npm` chosen because it ships with Node.

**Consequences.** One `npm install`, one CI pipeline. A `shared/` package can be
introduced later if type drift between apps becomes a real problem.

---

## ADR-003 — Authorization model: JWT + middleware, backend is the boundary

**Status:** accepted · **Date:** 2026-09-30

**Context.** Three roles (CUSTOMER, PROVIDER, ADMIN) with different permissions;
the UI must never be the only thing preventing privilege escalation.

**Decision.**
- Authenticated requests carry `Authorization: Bearer <JWT>`.
- JWT claims: `sub` (user id) + `role`.
- `requireAuth` verifies the signature and attaches `req.user`;
  `requireRole(...roles)` gates routes (e.g. `/api/admin/*` → ADMIN only).
- Frontend route guards are decorative UX; an unauthenticated direct API call
  must still be rejected.

**Alternatives.** Session cookies + server store (better for web-only, but JWT
keeps the API stateless and is a valuable learning outcome), NextAuth (couples
auth to a framework we are not using), oAuth providers (out of scope).

**Consequences.** Token revocation requires extra work (logout strategy to be
decided in the auth step — likely short expiry + refresh handling). Password
hashing (bcrypt/argon2) and login endpoints arrive in Step 3.

---

## ADR-004 — PostgreSQL access: `pg` pool + parameterized queries (ORM deferred)

**Status:** deferred · **Date:** 2026-09-30

**Decision.** Start with the official `pg` driver and hand-written SQL using
$1-style parameters. Revisit Prisma/Drizzle when migrations become complex.

**Rationale.** Explicit SQL keeps query safety visible (no accidental query
builders), avoids committing to an ORM before the schema is designed.

**Consequences.** We own migrations until then; a migration tool will be picked
in Step 2 (likely `node-pg-migrate` or plain SQL files + a runner script).

---

## ADR-005 — Tailwind CSS v4 with the Vite plugin

**Status:** accepted · **Date:** 2026-09-30

**Decision.** Use `@tailwindcss/vite` and a single `@import "tailwindcss";` in
`src/index.css` — no `tailwind.config.js` needed in v4.

**Alternatives.** Tailwind v3 (PostCSS config + `@tailwind` directives, extra
config for zero benefit now), plain CSS/Sass (poor utility consistency).

---

## ADR-006 — Dev proxy: Vite forwards `/api` to the backend

**Status:** accepted · **Date:** 2026-09-30

**Decision.** `vite.config.ts` proxies `/api → http://localhost:4000`.
Production frontend sets `VITE_API_URL` to the real API origin.
CORS is still configured on the backend from `CORS_ORIGIN` for non-proxy clients.

**Consequences.** Dev has zero CORS friction; absolute API URLs are configured
once per environment, never hard-coded in components.

---

## ADR-007 — Modular feature structure inside the Express app

**Status:** accepted · **Date:** 2026-09-30

**Decision.** Each domain (`auth`, `providers`, `bookings`, `admin`, `health`)
lives in `src/modules/<name>/` with `*.routes.ts` (+ later `*.service.ts`,
`*.repository.ts`). `app.ts` only mounts routers; controllers never talk to
`req`/`res` directly outside route files; services never touch Express types.

**Consequences.** Easy to test services in isolation; clear ownership boundaries
as the team (or AI assistant) adds code incrementally.

---

## ADR-008 — Directory naming: `client/`, `server/`, `database/`, `docs/`

**Status:** accepted · **Date:** 2026-09-30

**Context.** The scaffold initially used `frontend/` + `backend/`; the required
project layout specifies `client/`, `server/`, `docs/`, `database/`.

**Decision.** Rename `frontend/` → `client/` and `backend/` → `server/`, create
`database/` for future schema/migrations/seeds, and keep `docs/` for the four
living documents. npm workspace names and root scripts follow the same
vocabulary (`dev:client`, `dev:server`).

**Consequences.** One-time churn in paths/scripts/docs (completed in Step 002,
verified by clean reinstall + typecheck + build + runtime smoke tests). Naming
is now consistent everywhere, which matters for onboarding and grading.

## ADR-009 — Health endpoint returns a constant payload

**Status:** accepted · **Date:** 2026-09-30

**Decision.** `GET /api/health` returns exactly
`{"status":"ok","service":"ServiceConnect API"}` — no database ping, no
timestamp.

**Rationale.** A liveness probe should be fast, dependency-free and match the
specified contract exactly; DB/readiness checks belong on a separate
`/api/health/ready` endpoint if/when orchestration needs them (the
`pingDatabase()` helper is kept for that purpose).

**Consequences.** Uptime monitors get a stable contract; the API still boots
without PostgreSQL.

---

## ADR-010 — Migration tooling: plain SQL files + checksum runner (Step 003)

**Status:** accepted · **Date:** 2026-09-30 · *Refines ADR-004 (deferred)*

**Decision.** Migrations are plain SQL in `database/migrations/NNN_*.sql`,
applied in filename order by `server/src/db/migrate.ts`
(`npm run migrate --workspace server`):

- `schema_migrations` table records name + SHA-256 checksum + applied_at;
  editing an applied file is detected and refused (create a new file instead).
- Each file runs in its own transaction — failure rolls back and stops the run.
- Seeds live in TypeScript (`server/src/db/seed.ts`) with parameterized
  queries so password hashes always flow through `src/lib/password.ts`.

**Alternatives.** `node-pg-migrate` / Prisma / Knex migrations (extra deps,
abstraction over SQL we want visible for a college project), hand-run psql
(no history, no checksums, not reproducible).

**Consequences.** Zero new dependencies, full SQL transparency, reproducible
on any machine. If migrations become complex, adopting a tool later is easy
(the files are standard SQL).

## ADR-011 — Password storage: scrypt, never plaintext (Step 003)

**Status:** accepted · **Date:** 2026-09-30

**Decision.** `users.password_hash` stores only scrypt hashes produced by
`server/src/lib/password.ts`: Node's built-in `crypto.scrypt`
(N=16384, r=8, p=1, 16-byte random salt, 64-byte key), stored as
`scrypt$N$r$p$salt$hash`, compared with `timingSafeEqual`. Minimum password
length 10 enforced at hash time; the DB adds `CHECK (length(password_hash) >= 20)`.

**Alternatives.** bcrypt/argon2id (strong, but native build deps that already
caused friction — see the esbuild issue in BUILD_LOG Step 003), plain SHA-256
(trivially brute-forced — forbidden by docs/SECURITY.md).

**Consequences.** Plaintext never reaches the DB (verified: seed rows contain
`scrypt$…` and zero plaintext). The same module will verify logins in the auth
step; parameters are stored per-hash so cost can be raised later without
invalidating old hashes.

## ADR-012 — Keys, enums, and the "APPROVED = public" rule (Step 003)

**Status:** accepted · **Date:** 2026-09-30

**Decision.**
- UUID primary keys (`gen_random_uuid()`) on all entities — no guessable IDs,
  safe to expose in URLs.
- PostgreSQL **enum types** for `user_role`, `verification_status`,
  `booking_status` — invalid values are rejected by the DB, not just the app.
- `provider_profiles.is_public` is a **GENERATED column**
  (`verification_status = 'APPROVED'`) so "public" can never drift from status.
- A **partial index** `ON provider_profiles (city) WHERE verification_status =
  'APPROVED'` keeps public directory queries fast.
- The **`public_providers` view** is the single public-read entry point: only
  APPROVED providers whose user account is active, and it excludes email/phone.

**Consequences.** "Only APPROVED providers are public" is enforced at three
layers (view predicate, generated column, partial index); seed data demonstrates
11 providers where only 8 appear publicly.

## ADR-013 — Referential integrity & constraint design (Step 003)

**Status:** accepted · **Date:** 2026-09-30

**Decision.**
- `bookings` has `UNIQUE (id, customer_id)` and `UNIQUE (id, provider_id)`;
  `reviews` uses those as **composite foreign keys**, so a review's
  customer/provider must match its booking — a customer cannot review someone
  else's booking (verified by negative test).
- Partial unique index `uq_bookings_live_slot` prevents two live bookings
  (PENDING/ACCEPTED/IN_PROGRESS) for the same customer+service+slot.
- One review per booking (`reviews.booking_id UNIQUE`).
- Delete policies: `CASCADE` for user-owned data (profile, services, images,
  bookings, reviews); `RESTRICT` for reference data (categories) and for
  `admin_action_log.admin_id` so audit history cannot be deleted with a user.
- CHECKs: lowercased+valid email, unique phone when present, no self-bookings,
  REJECTED/CANCELLED require a reason, rating 1–5, price ≥ 0, one primary image
  per provider, admin decisions record `verified_by`.
- `set_updated_at()` trigger keeps `updated_at` honest DB-side.

**Consequences.** Most data-quality rules survive even a buggy or malicious
API client; every rule was exercised with positive and negative SQL tests.

## ADR-014 — Seed strategy (Step 003)

**Status:** accepted · **Date:** 2026-09-30

**Decision.** `npm run seed --workspace server` inserts deterministic,
idempotent fixtures in one transaction: 8 categories, 1 ADMIN, 2 CUSTOMERs,
11 fictional providers (8 APPROVED + PENDING/REJECTED/SUSPENDED), 19 services,
images, 7 bookings covering **all six statuses**, 2 reviews, 3 admin log rows.
Re-running skips when data exists; `-- --force` wipes and reseeds but is
refused when `NODE_ENV=production`. All dev accounts share one documented
development password (scrypt-hashed).

**Consequences.** Demo data exercises every status/constraint; reviewers can
reset with one command; production can never be accidentally wiped.

---

## ADR-015 — Auth architecture: JWT + server-side sessions (Step 004)

**Status:** accepted · **Date:** 2026-09-30 · *Implements ADR-003*

**Decision.**
- **Access token:** JWT signed with `JWT_SECRET` (env, ≥32 chars, zod-validated)
  carrying `sub` (user id), `role`, `sid` (session id), `issuer`, `exp`.
  Lifetime `JWT_EXPIRES_IN` (validated `^\d+[smhd]$`, default `1h`).
- **Server-side session row** (`auth_sessions`, migration 006): every token
  maps to `sid`; `POST /api/auth/logout` sets `revoked_at`, so logout
  invalidates the token **immediately** (stateless JWTs alone cannot log out).
- **`requireAuth` checks, fail-closed:** header → signature/expiry/issuer/claim
  shape → session live (not revoked, not expired) → user `is_active` →
  **role re-read from the database**, never from the token claim or request.
- **`requireRole(...roles)`** rejects with 401 if unauthenticated, 403 if the
  (fresh) role is not allowed. `/api/admin/*` requires ADMIN.
- Registration accepts only `CUSTOMER` or `PROVIDER` (zod enum — ADMIN is
  unreachable from the public API); new providers get `verification_status =
  PENDING`, never APPROVED.
- Opportunistic purge of expired sessions at login (indexed query).

**Alternatives.** Pure stateless JWT (no DB hit, but logout becomes theater),
server-side sessions without JWT (simpler, but re-implements what we have),
refresh-token rotation (deferred until a frontend actually needs long-lived
sessions — revisit when the SPA auth UI lands).

**Consequences.** One extra indexed PK lookup per authenticated request —
acceptable at this scale and required for real revocation, deactivation and
fresh-role enforcement.

## ADR-016 — Auth error semantics & anti-enumeration (Step 004)

**Status:** accepted · **Date:** 2026-09-30

**Decision.**
- **Login failures are always `401 "Invalid email or password"`** for unknown
  email, wrong password and deactivated accounts alike; unknown emails still
  run one scrypt verification against a dummy hash so response time does not
  reveal account existence.
- **Duplicate registration → `409 "An account with this email already
  exists"`** (maps the DB unique violation). Tradeoff: this does reveal that
  an email is taken — unavoidable for usable sign-up without an email-verification
  flow; rate limiting (SECURITY TODO) is the planned mitigation.
- **Validation errors → `400`** echoing only field/constraint names — never
  request contents beyond that, never credential data.
- **5xx → generic "Internal server error"**; details stay in server logs
  (central error handler, never exposes SQL/stack in production).
- Responses expose a `PublicUser` projection (id/email/fullName/role/phone/
  createdAt) — `password_hash` has no path out of `auth.service.ts`.

**Consequences.** Attacker cannot distinguish "no user" from "wrong password";
enumeration via login is blocked; registration flow remains usable.

## ADR-017 — Test strategy: `node:test` + `fetch`, zero new dependencies (Step 004)

**Status:** accepted · **Date:** 2026-09-30

**Decision.** Auth/RBAC tests use Node's built-in test runner
(`tsx --test src/tests/auth.test.ts`) with global `fetch` against the real
Express app on an ephemeral port and the real dev database. No Jest/Vitest/
Supertest — the stack already ships everything needed. Tests create uniquely
named accounts and delete them in `after()`; an ADMIN test account is created
directly via SQL (public registration must not mint admins).

**Consequences.** `npm test` runs true end-to-end HTTP tests (validation,
status codes, middleware, DB) with no added dependencies or mocks that could
drift from production behavior.

---

## ADR-018 — Provider profile model & self-service endpoints (Step 005)

**Status:** accepted · **Date:** 2026-09-30

**Decision.**
- Profile fields (migration 007): business name, description, **phone**,
  location (`city` + `address`), **`service_areas TEXT[]`** (GIN-indexed for
  future radius/area search), experience (`years_experience`),
  **`profile_image_url`** and **`cover_image_url`** (http(s)-only CHECKs).
- `GET/PATCH /api/providers/me` are PROVIDER-only and keyed **solely** by
  `req.user.id` — there is no `PATCH /providers/:id` route, so cross-profile
  writes are structurally impossible.
- `PATCH` uses a **strict zod schema** (unknown keys → 400) with a writable
  column whitelist in the service layer; `verificationStatus`, `isPublic`,
  `verifiedBy` are in neither → a provider can never alter their own
  verification state.
- The `public_providers` view gains the three non-contact columns; **phone
  and email stay private** — customers reach providers through bookings.

**Consequences.** Profile completeness is provider-driven; verification state
is admin-driven; the two never intersect in code paths.

## ADR-019 — Verification state machine + transactional audit (Step 005)

**Status:** accepted · **Date:** 2026-09-30

**Decision.** Admin endpoints under `/api/admin/providers` (router-level
`requireAuth + requireRole('ADMIN')`):

| Endpoint | Effect |
|---|---|
| `GET /pending` | queue of PENDING profiles (owner email included for review) |
| `GET /:id` | full detail + last 20 `admin_action_log` entries |
| `PATCH /:id/approve` | → APPROVED (optional `note`) |
| `PATCH /:id/reject` | → REJECTED, **`reason` required (min 5 chars)** |
| `PATCH /:id/suspend` | → SUSPENDED (optional reason) |

- Every decision runs in **one transaction**: `SELECT … FOR UPDATE` →
  no-op guard (`409` if already in the target state) → `UPDATE` status +
  `verified_by`/`verified_at` → `INSERT admin_action_log` with
  `previous_status`, `new_status` and reason — **a decision cannot exist
  without its audit row** (rollback on any failure).
- "Public" flips automatically: `is_public` is generated from the status, and
  the `public_providers` view filters `APPROVED AND is_active`.

**Consequences.** Auditors can reconstruct every transition; double-clicks
are idempotent-safe (409, no duplicate log rows); approval power is

---

## ADR-020 — Service management: ownership enforced in SQL, not in the route

**Context.** `GET/POST/PATCH/DELETE /api/providers/me/services[/:id]` gives
providers full control of their own catalogue. Each `:id` in the URL is an
attacker-controlled string pointing at a global row id, which is the textbook
IDOR (OWASP API1:2023) setup.

**Decision.**

1. **Ownership is a SQL predicate, never a route-level fact.** The service
   layer takes `providerId` as its first argument and *every* statement —
   `SELECT`, `UPDATE`, `DELETE` — carries `AND provider_id = $n`. The value
   always comes from `req.user.id` (resolved from the verified token), never
   from the body, query or URL. Routes cannot be re-pointed at a different
   owner because they have no owner parameter to change.
2. **404, not 403, for "exists but not yours".** A 403 would confirm the id
   exists and hand an attacker a free enumeration oracle for the whole
   catalogue. The response body is byte-identical to a genuinely unknown id.
   Note that body validation runs *before* the ownership check, so a malformed
   body returns the same 400 for foreign and unknown ids — the error channel
   leaks nothing either. (Tested: `IDOR 6`.)
3. **Ownership cannot be re-pointed via payload.** Schemas are `.strict()` and
   contain no `providerId`/`id` field, so `{"providerId": …}` is a 400, not a
   silent reassignment. The PATCH column whitelist mirrors this.
4. **Soft delete, not hard delete.** `DELETE` sets `is_active = false`.
   `bookings.service_id` is `ON DELETE RESTRICT`, so a hard delete would fail
   for any service with booking history and would destroy the meaning of
   existing bookings. Deactivation is reversible (`PATCH { isActive: true }`).
5. **Range invariant checked against stored state.** `priceTo >= priceFrom` is
   a cross-field rule; the schema can only check it when *both* values are in
   the request. `updateService` therefore loads the owned row first and
   validates the *merged* result, so `PATCH { priceTo: 1 }` on a service whose
   `priceFrom` is 150 is rejected instead of tripping a raw DB error.
6. **Validation mirrored DB-side (defence in depth).** Name 3–120 chars,
   duration 15–1440 min, price ≥ 0 with ≤ 2 decimals — enforced by zod *and*
   by `chk_services_name` / `chk_services_duration` / `chk_services_price_to`,
   so a direct DB write cannot bypass the API's rules.
7. **Postgres error codes mapped to safe 4xx.** `23505`→409, `23503`→400,
   `23514`→400. SQL text never reaches the client.

**Schema change (migration `008`).** The spec's service shape did not match
`003`: `title`→`name`, single `price`→`price_from`/`price_to` (backfilled
from the old column before it was dropped, so no data loss). The rename keeps
`UNIQUE (provider_id, name)` attached to the right column; the constraint was
merely renamed `uq_services_provider_name` for clarity. Added
`idx_services_provider_active` for the owner listing.

**Consequences.** Swapping an id in the URL is a no-op that returns 404 and
leaves the row untouched; verified against the database, not just the response
status. Per-provider name uniqueness is preserved, but two providers may still
offer identically-named services. Reactivation is possible, so "deleted"
services linger as inactive rows — intended, since bookings reference them.

---

## ADR-021 — Public provider search: view-gated, allow-listed, parameterised

**Context.** `GET /api/providers` is the marketplace's front door. It must
expose only verified providers, must not leak contact details or admin notes,
must be safe against SQL injection, and must paginate and sort without a full
table scan on every keystroke.

**Decision.**

1. **The view is the single access gate.** All reads go through
   `public_providers`, which already filters `verification_status = 'APPROVED'
   AND users.is_active`. A PENDING/REJECTED/SUSPENDED provider is therefore not
   "filtered out by the query" — it is *unreachable*, so no new code path can
   leak one by forgetting a `WHERE` clause.

2. **Response DTO is an allow-list.** `toPublicDto` copies named fields into a
   fresh object. `password_hash`, `email`, `phone`, owner `full_name`,
   `verified_by` and every `admin_action_log` field (rejection reasons,
   internal notes) are never selected. A column added to the table later cannot
   leak by accident. `address` and `hourly_rate` are also withheld — a customer
   books through the app, so there is no reason to publish either.

3. **Parameterised queries only.** Every user value is a `$n` placeholder. The
   only interpolated SQL is the `ORDER BY` fragment, chosen from a fixed
   `ORDER_BY` lookup keyed by the already-validated `sort` enum — an unlisted
   value is a 400, so no user input reaches the SQL string. `LIKE` patterns have
   `%`, `_` and `\` escaped, so a keyword of `%` is a literal, not "match
   everything".

4. **Denormalised search columns, kept honest by trigger.** `rating_avg`,
   `rating_count`, `price_min` and `active_service_count` are caches recomputed
   by `refresh_provider_search_stats` on any write to `services` or `reviews`.
   Aggregating on every request would be correct but un-indexable; the trigger
   makes the cache self-healing, and the search query still re-reads the
   authoritative `APPROVED` predicate from the view. Documented as a cache via
   `COMMENT ON COLUMN`.

5. **`availability` is scoped honestly.** It means "has ≥ 1 active service",
   not "has a free slot on date X" — real time-slot availability belongs to the
   booking feature. Stated explicitly rather than faked.

6. **Unrated providers sort last in both directions** (`NULLS LAST`). Without
   this, "cheapest first" would bury real options under every provider nobody
   has reviewed yet.

7. **Pagination is total-consistent.** `COUNT(*)` runs the same predicate as
   the page query, so `total` and the rows can never disagree. An `id` tiebreaker
   is appended to every `ORDER BY`, otherwise providers sharing a rating or price
   could repeat or vanish across pages.

8. **Unknown query parameters are a 400, not ignored.** A typo like
   `?minprice=50` failing loudly is better than silently returning unfiltered
   results to a user who believes they filtered.

**Consequences.** Search is genuinely public (no auth) but provably narrow.
`pg_trgm` GIN indexes make `ILIKE '%…%'` indexed instead of a sequential scan.
Verified by tests: nine query shapes × hidden-provider sweep, a 15-field body
scan for forbidden substrings, an exact key allow-list, and five injection
payloads that return 200-with-zero-rows or 400 while the tables stay intact.



---

## ADR-022 — Public provider profile: view-gated, allow-listed, anonymous reviews

**Context.** A marketplace profile needs far more than the search row — services,
a gallery, reviews, a booking entry point. It also has the most surface area for
leaking private data, because it is the endpoint most likely to be probed with
guessed ids.

**Inspection result.** The existing backend was **not** sufficient: `GET
/api/providers` returns list rows only, with no services, gallery or reviews.
A new endpoint was required. No migration was needed — every column already
existed.

**Decision.**

1. **`GET /api/providers/:id`, public, minimal.** Three small reads: the base
   row, then services, images and reviews in parallel. No new tables, no schema
   change.

2. **The `public_providers` view is the only gate.** The base row is read from
   the view, so a PENDING/REJECTED/SUSPENDED provider (or a deactivated user)
   has *no row* and the endpoint returns 404. This mirrors ADR-021 rather than
   re-deriving the rule in a new `WHERE` clause, which could drift.

3. **404, never 403, for unapproved providers.** A 403 would confirm "this id
   exists but is unverified" and turn the endpoint into a directory of
   unverified businesses. Non-approved and non-existent are byte-identical.

4. **The base row reuses the search allow-list.** `PUBLIC_COLUMNS` and
   `toPublicDto` are exported from the search service and reused, so a field can
   never be public in search and private on a profile. This is the main
   structural guarantee against exposure drift.

5. **Each nested collection has its own allow-list.** Services expose
   `id, name, description, priceFrom, priceTo, durationMinutes, category` — and
   **inactive services are excluded**, because a deactivated service is not
   bookable and must not be advertised. Images expose `url` + `altText` only.
   Never selected anywhere: `password_hash`, `email`, `phone`, owner
   `full_name`, `verified_by`, `hourly_rate`, street `address`, and every
   `admin_action_log` field.

6. **Reviews are public but anonymous.** The query selects `rating, comment,
   created_at` only — no `customer_id`, no `booking_id`, no name or email. A
   review tells a customer the quality of past work without exposing who wrote
   it. Capped at 20 most recent while `reviewCount` remains the true total, and
   the UI says so when it is showing a subset.

7. **Route ordering.** `/:id` is registered *after* every `/me` route, so a
   future param route can never shadow the authenticated self-service endpoints.
   The UUID is validated by the route before reaching SQL, and bound as `$1`.

8. **Booking CTA is disabled, with a reason.** Booking needs a later phase; a
   dead link or a fake form would be worse than an honest disabled control that
   says booking is not available yet.

**Consequences.** A public profile is reachable only for verified businesses,
and a caller cannot distinguish "unverified" from "does not exist" — so the
endpoint cannot be used to enumerate unverified providers. The page renders
exclusively from the response, so there is no client-side access control
pretending to be security.


---

## ADR-023 — Booking workflow: identity from the session, one transition map

**Context.** Bookings are the first feature where two different roles mutate
the *same* row. That makes them the natural place for a horizontal-privilege bug:
a provider updating someone else's job, or a customer promoting their own
request to ACCEPTED.

**Schema reuse.** The `bookings` table from migration `004` is reused entirely —
customer/provider/service FKs, the `booking_status` enum, the no-self-booking
CHECK, the REJECTED/CANCELLED reason CHECKs and the anti-double-booking partial
unique index. One column was genuinely missing: the flow collects a **problem
description** separately from **notes**, and `004` only had `notes`, so the two
would have been conflated and the most important field lost. Migration `010`
adds `problem_description` (nullable, 3–2000 char CHECK) plus a
`(provider_id, status, scheduled_at DESC)` index for the provider queue. No
duplicate table, no duplicate auth.

**Identity**

1. **The customer is always `req.user.id`** from the verified session. No
   client field can set it, and the strict schemas would reject one anyway.
2. **The provider is client-*selected*** (that is the "select provider" step)
   but is then verified: the profile must exist, belong to a `PROVIDER`-role
   user, be `APPROVED`, be active, and not be the customer. Unapproved and
   non-existent both return the same **404**, so the endpoint cannot be used to
   discover who is pending, rejected or suspended.
3. **The service is checked against the provider in one query** — exists, active,
   and `service.provider_id === booking.provider_id`. A service id from another
   provider is a 400, never an accepted pairing.
4. The provider status route reads its identity from the session, so a
   `providerId` in the body is never even considered.

**Ownership.** Every read and write goes through `loadVisibleBooking`, whose
predicate is inside the SQL and keyed on the caller's role (`b.customer_id = ?`
or `b.provider_id = ?`). Swapping the `:id` in the URL matches zero rows, and a
row the caller does not own returns the same 404 as a missing row — a 403 would
confirm the booking exists.

**State machine.** `BOOKING_TRANSITIONS` in `shared/types.ts` is the single
authority, keyed by current status, so an unlisted transition is unreachable:

```
PENDING     → ACCEPTED | REJECTED | CANCELLED
ACCEPTED    → IN_PROGRESS | CANCELLED
IN_PROGRESS → COMPLETED
REJECTED, CANCELLED, COMPLETED → (terminal)
```

`PENDING → IN_PROGRESS` and `PENDING → COMPLETED` are deliberately absent: work
cannot start on a request the provider has not accepted. The customer may only
ever request `CANCELLED`, and only from `PENDING`/`ACCEPTED` — the status
endpoint is `requireRole('PROVIDER')` and the cancel schema has no `status`
field, so there is no route by which a customer sets a provider-only status.
A provider cannot set `CANCELLED` either; that is the customer's action.

**Concurrency.** The status write is a single guarded statement —
`UPDATE ... WHERE id = $1 AND status = $current` — so two concurrent requests
cannot both read `PENDING` and both write, which would otherwise let a
double-click skip a state. A lost race returns 409, not a silent overwrite.

**Double-booking.** The `004` partial unique index is respected, not bypassed.
`23505` is translated to a human 409 ("You already have a live booking for this
service at that time"), and the test asserts the raw SQL text, the index name
and "duplicate key" never reach the client.

**Dates.** `date` (`YYYY-MM-DD`) and `time` (`HH:MM`) are validated separately,
as the flow collects them separately, and composed as **UTC** — a server-side
local-time interpretation would shift bookings by the server's timezone. The
slot must be in the future (5 minutes of clock-skew tolerance) and within a year.

**Service snapshots.** `duration_minutes` and `price_quote` are copied from the
service onto the booking at creation, so later edits to a provider's catalogue
cannot rewrite the history of a job already agreed.

cryptographically impossible for non-admins (middleware before any handler).

---

## ADR-024 — Booking frontend: a UX layer over an authoritative API

**Status:** Accepted · **Phase 11** · Relates to ADR-002, ADR-015, ADR-021, ADR-023

### Context

ADR-023 delivered the booking API. The provider profile's "Book Service" CTA
was deliberately left disabled rather than wired to a fake flow. Phase 11 turns
it on for real. The risk in a booking UI is that the browser starts behaving
like a source of truth: a customer picks "customer", a client sets the price, or
a role check in a component is mistaken for a permission.

A second, quieter problem: the frontend had **no auth state at all**. There was
no token handling and `LoginPage` was a disabled placeholder. Every booking
endpoint requires a `Bearer` token, so a working booking flow was impossible
without a minimal, real auth client first. That is the one piece of scope this
phase added beyond booking, and it is documented here because it changes the
security posture of the whole SPA.

### Decision

**1. The browser sends exactly seven fields, and never a customer.**

`createBooking` posts `providerId`, `serviceId`, `date`, `time`,
`problemDescription`, `address` and — only when non-empty — `notes`. The
`CreateBookingRequest` type has no `customerId`, `price_quote` or
`duration_minutes` field at all, so the omission is enforced by the type system
rather than by discipline. `cancelBooking` posts only `reason`; there is no code
path anywhere in the client that can put a `status` on the wire, which matters
because the customer UI must never drive the lifecycle.

**2. The provider id in the URL is only ever used to fetch.**

`/providers/:id/book` loads the public profile and then reads `provider.id`
and `provider.services` from that response. The service picker can only emit an
id that is already in that list, so a mismatched provider/service pair cannot
be constructed in the UI. The server independently re-checks that the service
belongs to the provider and is active.

**3. Client-side validation is UX, not enforcement.**

`validateBooking` mirrors the DB constraints (3–2000 problem characters, 1000
notes, 500 address, one-year horizon) so a customer is told what is wrong
without a round trip. The comments say so explicitly, and the server revalidates
everything with zod. The duplication is deliberate: it is a fast local check,
not a second rule engine.

**4. Local selections are converted to UTC before sending.**

The server composes `date` + `time` as UTC, and ADR-023 states the client owns
the timezone conversion. `localSlotToUtc` builds the selection as a *local*
`Date` and reads its UTC components back, so a customer in UTC-3 picking 14:00
gets 14:00 local rather than a booking silently shifted three hours. The date
input's `min`/`max` and the past-date check are likewise local-calendar based.

**5. Unauthenticated visitors are asked to sign in; they never get a raw 401.**

The profile CTA is one honest link for everyone, and `BookingPage` decides what
to render: a sign-in prompt when there is no session, a wrong-role notice for a
PROVIDER/ADMIN, otherwise the form. Splitting this across the two pages would
mean three divergent code paths with no way to keep them in sync, and the point
of the decision is that no unauthenticated POST is ever attempted.

**6. The access token lives in `sessionStorage`, not `localStorage`.**

The API issues a revocable bearer token over HTTP with no cookie transport, so
the browser must hold it somewhere. `sessionStorage` is tab-scoped and dies with
the tab, so a token exfiltrated by XSS stops working on close; `localStorage`
would persist it across browser restarts for no benefit. This is
defence-in-depth for token theft, **not** an auth boundary: every request
re-reads the role from the database (ADR-015) and every session is revocable
server-side. Tampering with the store yields a confusing 401, never access. No
password is ever stored.

**7. Role gates in the UI are labelled as convenience, and the navbar scopes
customer links.** "My bookings" appears only for a CUSTOMER so the provider
workflow is not cluttered, and `/bookings` re-checks the role itself. Neither is
a guard — the backend enforces ownership regardless of what is rendered.

**8. Status is never conveyed by colour alone.** Each badge pairs a distinct
Lucide icon with a text label ("Awaiting provider", "Confirmed", …), and the
service picker's selected state carries a check mark, not just a ring colour.

### Consequences

- The SPA now holds a bearer token in `sessionStorage`; sign-out revokes the
  server session *and* clears it locally, and a failed revoke still clears
  locally.
- `/login` became a real form against the existing auth endpoints. It offers
  customer registration only — provider onboarding is a later phase, and
  offering it without the admin approval workflow would be misleading.
- The client test suite now exists. Component tests render through
  `react-dom/server`, which keeps the dependency surface unchanged.
- A future cookie/`HttpOnly` migration would let `lib/auth.ts` be deleted
  without touching a single component, because nothing outside that module
  reads storage.

### Alternatives rejected

- **`localStorage` for the token** — persists across restarts; strictly larger
  blast radius for an XSS scenario with no offsetting benefit.
- **Computing the booking price in the UI** — would create a second, client-side
  source of truth for money. The provider's starting rate is shown as
  informational text and explicitly labelled as such.
- **A customer-id field in the form** — even though the server ignores it, a
  field that appears to let a customer choose their identity is a defect, and
  the type omits it so it cannot be added by accident.
- **Optimistic cancellation** — the list would show CANCELLED before the server
  agreed. Every cancellation re-fetches, so the badge always reflects server
  truth.

---

## ADR-025 — Customer dashboard: one request, derived numbers, reused components

**Status:** Accepted · **Phase 12** · Relates to ADR-002, ADR-021, ADR-023, ADR-024

### Context

Bookings were reachable, but only by navigating to `/bookings` and scrolling.
A returning customer had no single place that answered "is anything coming up?"
The obvious build is a new statistics endpoint. The cheaper and more honest one
is to recognise that the dashboard needs nothing the customer does not already
receive.

### Decision

**1. One request, no new endpoint.** The dashboard makes exactly one
`GET /api/bookings/my` call per visit. Every number on the page is derived from
that single response in pure functions (`summariseBookings`,
`partitionBookings`). There is no `/api/bookings/stats`, no second request per
card, and no derived-data round trip. A new endpoint would have to re-implement
the ownership scoping that already exists and could drift from it; deriving
locally cannot.

**2. `pagination.total` is preferred over the array length.** The endpoint caps
a page at 50, so a customer with 80 bookings would see "Total bookings 50" if we
counted the array. The response already carries the true total, so the lifetime
figure uses it and falls back to the array length only if it is absent. This is
the one number that cannot be computed from the page in hand.

**3. Upcoming/past is a split by STATUS, not by date.** `PENDING`, `ACCEPTED`
and `IN_PROGRESS` are upcoming; `COMPLETED`, `CANCELLED` and `REJECTED` are
history. A `PENDING` booking whose slot has passed is still something the
customer is waiting on and may want to cancel, so classifying it as "past"
would hide the only control that helps. The server already refuses to create a
booking in the past, so the two orders rarely disagree. Neither list is sorted
in place — the caller also needs the original array for the totals.

**4. Customer-only, but the backend stays authoritative.** An anonymous visitor
gets a sign-in prompt and **no request is made** (a guaranteed 401 is a worse
experience than being asked to sign in). A `PROVIDER` or `ADMIN` gets a clear
"customer accounts only" notice pointing at their own area. This gate is UX, and
it is labelled as such: `/bookings/my` is already scoped to the session user and
returns 401/403 regardless, so editing the browser buys nothing.

**5. The account section is a strict allow-list.** `accountView()` returns
exactly four fields: name, email, role, member-since. The `CurrentUser` object
the app already holds also carries `id` and `phone`, and the component never
reads them, so a customer id cannot reach the DOM even accidentally — a test
asserts this. Nothing sensitive is available to leak: `/api/auth/me` returns a
`PublicUser` with no password hash, session id or token, so the frontend never
holds those values in the first place. The greeting uses the **first name
only**, so a full legal name is not set in large type on a shared screen.

**6. Everything reusable is reused, not rewritten.** Upcoming rows are the
existing `BookingCard`; cancelling is the existing `CancelBookingDialog`; dates
go through the existing `formatDateTime`, so the dashboard cannot display a
time differently from the booking detail page. There is exactly one
cancellation path in the app, and it still posts `{ reason }` and never a
`status`. The history section uses a new, deliberately compact row component
because a grid of full cards is an archive, not a scannable overview — but it
carries no cancel control and no duplicated logic.

**7. No polling, ever.** The page re-fetches on navigation and on an explicit
"Refresh" press. No interval, no visibility-based auto-reload, no background
loop. A dashboard that silently re-requests forever is hard to reason about and
needlessly loads the API; an explicit button is honest and costs nothing.

**8. Lists are capped and the archive is delegated.** Four upcoming, five
recent, each with a "View all bookings" link to `/bookings`. The summary
stat-grid is hidden entirely at zero bookings, because four zero cards read as a
failure rather than as an empty account.

### Consequences

- The dashboard adds zero backend surface. The booking API is untouched.
- `listMyBookingsPage()` was added to expose the envelope; `listMyBookings()`
  is now a thin wrapper over it, so the existing callers and their tests are
  unchanged.
- A customer with more than 50 bookings sees correct totals but only the newest
  50 bookings in the lists — `/bookings` is the full history, and the API's
  pagination is the limit to lift if that ever matters.
- The customer navbar gained a Dashboard link. Providers and admins keep the
  public nav unchanged.

### Alternatives rejected

- **A `/api/bookings/stats` endpoint** — duplicates the ownership scoping that
  already works, adds a contract to keep in sync, and returns numbers derivable
  from data the client already has.
- **Counting the array length for "total"** — silently wrong above 50 bookings,
  which is exactly the kind of error a customer would not report, just distrust.
- **Auto-refresh on a timer** — unbounded API load, battery cost, and a stale
  badge that flips under the user's cursor.
- **Splitting upcoming/past by date** — would bury a past-dated `PENDING` request
  and remove the cancel control the customer needs.
- **Rendering the full booking history inline** — an archive where an overview
  belongs; slow, and unreadable past a dozen rows.

---

## ADR-026 — Provider dashboard: one queue fetch, a mirrored state machine, an honest data allow-list

**Status:** Accepted · **Phase 13** · Relates to ADR-021, ADR-023, ADR-024, ADR-025

### Context

Providers had a real booking API (`GET /api/provider/bookings`,
`PATCH /api/provider/bookings/:id/status`) and no way to use it from a browser.
The obvious build is a queue with status buttons. The risk in a provider queue is
that the UI becomes a second, looser copy of the booking state machine — one
that offers a button the API will refuse, or worse, one that offers a
transition the state machine forbids.

A second, quieter risk: a job ticket naturally wants to show "who is this
customer?" and that pressure is exactly how customer PII ends up in a provider
screen.

### Decision

**1. The UI mirrors the server's state machine rather than re-inventing it.**
`PROVIDER_TRANSITIONS` in `lib/booking-utils.ts` is a literal copy of
`BOOKING_TRANSITIONS` from `server/src/shared/types.ts` with `CANCELLED`
removed, and the card renders a button *only* for the transition that map
allows from the current status. So `PENDING -> IN_PROGRESS`,
`PENDING -> COMPLETED`, `REJECTED -> COMPLETED` and `CANCELLED -> ACCEPTED` are
not "clicked and rejected" — they are **not rendered at all**. The same table
decides the "invalid action is not offered" guarantee, and tests assert it
exhaustively, including that `CANCELLED` appears nowhere as a provider target.

A mirror can drift from its source. That is accepted deliberately: the server
remains authoritative and returns 409, and the consequence of drift is a missing
button, never an unauthorised one.

**2. One queue fetch; filtering and sorting are local.** The endpoint supports
`?status=`, and the client does **not** use it. The whole queue is fetched once
at the maximum page size, and the seven status tabs filter that array in memory.
A request per tab click would fetch data already held, and the provider queue is
small enough that this is strictly cheaper and strictly simpler. Counts come
from the same array; "Total bookings" uses the server's `pagination.total` so a
capped page cannot under-report.

**3. Every status change goes through one function and is re-read, never
patched.** `updateProviderBookingStatus` sends only `{ status }`, plus
`{ reason }` when rejecting. It has no `providerId` parameter and no such field
exists on the request, so no code path can construct one — the provider is
always the session user. After success the queue is re-fetched rather than
patched locally, so a card never shows a status the server did not actually
store. `busy` is checked before the request, so a double-click cannot fire two
PATCHes; the server's guarded `WHERE status = $current` would 409 the second one
anyway, but there is no reason to make it.

**4. Rejection requires a reason because the server requires one.**
`providerStatusSchema` demands `reason` when the target is `REJECTED` (backed by
a DB CHECK). The dialog cannot submit without one, and `validateReason` mirrors
the server's 3–500 bounds so the provider is not bounced off a 400.

**5. Customer information is a strict allow-list, and no request is made to
widen it.** The card shows exactly what `BookingDto` already carries: the
counterparty display name, the service address, the problem description and the
customer's own notes. The DTO has **no** customer email, phone, customer id,
password hash, session id or token, so the frontend never holds them and there
is nothing to leak. No "enrich the customer" call is made — the customer
booking endpoints are not used as an information source, and the provider's own
contact details are not printed next to the customer's.

**6. Verification states are stated, never explained.** `GET /api/providers/me`
returns `verificationStatus` but deliberately **no** rejection or suspension
reason. The banner therefore states the fact and points at support, and a test
asserts no fabricated cause ("because…", "due to…") appears. Inventing a
plausible-sounding reason would be telling the provider something the system does
not know. A `PENDING` provider is told they are not yet bookable rather than
being shown an empty queue as if it were normal.

**7. Role gating is UX and is labelled as such.** Anonymous visitors get a
sign-in prompt and **no provider request is made**; a CUSTOMER or ADMIN is
turned away with a link to their own area. `requireRole('PROVIDER')` plus the
ownership check inside `loadVisibleBooking` are the real boundary. A provider
cannot reach another provider's booking: it is not in their queue, so there is
no id to send.

**8. No polling.** The page re-fetches on navigation and on an explicit
"Refresh". No interval, no background loop.

### Consequences

- Adding a status to the server's state machine requires touching
  `PROVIDER_TRANSITIONS` too, or the button will not appear. Documented in the
  code so the next change does not treat the omission as a bug.
- Zero backend surface was added. The provider booking API is untouched.
- The provider navbar now shows Bookings and My profile. Customers keep their
  Dashboard/My bookings links; public and admin navigation are unchanged.
- A provider with more than 50 queue items sees the newest 50 plus the true
  total. Lifting that means server-side pagination, which the endpoint already
  supports.

### Alternatives rejected

- **Using `?status=` for the filter tabs** — one request per tab click to
  re-fetch data already in memory, and a visible flash on every switch.
- **A generic "change status" dropdown** — it would have to either allow the
  invalid transitions (and rely on a 409 to catch them) or reimplement the state
  machine in a `<select>`. Per-status buttons derived from one table are both
  simpler and safer.
- **Optimistically flipping the badge** — the card would claim `ACCEPTED` before
  the server agreed, which is exactly the "invent a status" failure this phase
  forbids.
- **Showing the customer's email or phone to the provider** — not in the DTO,
  not required to do the job, and it would mean a second request against a
  customer-scoped endpoint to obtain data the provider has no need for.
- **Building a provider profile/services editor** — out of scope; the profile
  and service APIs exist but the editor UI is a separate phase. The dashboard
  links to the public profile only.

---

## ADR-027 — Admin verification UI: a narrower action set than the API, and a hard allow-list

**Status:** Accepted · **Phase 14** · Relates to ADR-019, ADR-021, ADR-024, ADR-025, ADR-026

### Context

Provider verification has existed server-side since Phase 4: a pending queue, a
detail endpoint with an audit trail, and three explicit decision endpoints. There
was no way to use any of it from a browser.

The risk in an admin UI is not the buttons — it is the data. The admin DTO is
strictly richer than the public one (it includes the owner's email and phone,
because verifying a business genuinely requires them) and it also carries
`verifiedBy`, which is the **acting admin's user id**. A UI that renders the DTO
directly would quietly show one admin's identity to another.

### Decision

**1. A view-model, not the DTO.** `adminProviderView()` in `lib/admin-utils.ts`
is the only bridge between the admin payload and any component. It returns a
fixed 17-field shape, and the card/detail components accept that type rather
than `AdminProviderDetail`. So the allow-list is enforced by the type system: a
component *cannot* render `verifiedBy` because it was never copied out. What is
deliberately dropped, with reasons in the code:

- `verifiedBy` — an admin's user id. The server records who decided (correctly,
  for audit); showing it in the page is needless exposure.
- `userId` as visible text — it is carried as `id` for the `/admin/providers/:id`
  route parameter only, and a test asserts it appears in the `href` but never in
  the rendered copy.
- `owner.isActive` — an auth concern, not a review one.

**2. No counts the backend cannot support.** The API exposes a list endpoint for
PENDING only. So the dashboard shows "Pending providers", "With experience
listed" and "With a description" — all derived from the queue it actually
fetched — and there is deliberately **no** "Approved: N" or "Rejected: N" card. A
zero there would be a fabrication, not a measurement, and inventing a statistics
endpoint just to fill four tiles was rejected for the same reason.

**3. The action set is deliberately narrower than the server's.** The service's
state machine permits approve from REJECTED and SUSPENDED, and reject from
SUSPENDED. `ADMIN_ACTIONS` does not offer any of those: PENDING gets
Approve/Reject, APPROVED gets Suspend, and REJECTED/SUSPENDED get **nothing**.

This is a real, deliberate divergence and is called out rather than hidden. A
one-click "re-approve" on a rejected provider is a policy decision that belongs
in a deliberate admin flow, not on a review card. The server remains
authoritative, a no-op transition still returns 409, and the divergence fails in
the safe direction: a missing button, never an unauthorised one.

**4. Three endpoints, three different bodies — all read, none guessed.** This
mattered more than expected:

| Endpoint | Body | Required? |
|---|---|---|
| `PATCH /:id/approve` | `{ note? }` (2–500) | optional |
| `PATCH /:id/reject` | `{ reason }` (**5**–500) | **required** |
| `PATCH /:id/suspend` | `{ reason? }` (5–500) | optional |

The rejection minimum here is **5**, not the 3 used by the booking rejection
schema — two different schemas, both read directly rather than pattern-matched
from the booking work. All three schemas are `.strict()`, so approve and suspend
send `{}` when there is nothing to say, and a test asserts each body
field-by-field. The dialog shows a reason field for reject and suspend and
omits it entirely for approve, because that is what each endpoint actually
accepts.

**5. Never a status dropdown.** There is no control anywhere in the admin UI
that lets anyone submit a status value. The three decision endpoints are the only
way to change a provider's state, so the UI is shaped like them. A test asserts
no `<select>` and no `name="status"` input is ever rendered.

**6. Every decision re-reads; nothing is patched.** After a decision the queue
(or the detail) is re-fetched. A card never claims a status the server did not
store, and a provider leaves the queue only because the server removed it. A
`busy` guard is checked before the request so a double-click cannot fire two
PATCHes — the server's `previous === target` check would 409 the second anyway.

**7. A 409 means someone else got there first, so we refresh.** The server
answers a no-op transition with 409 ("already approved"). That is the normal
outcome of two admins racing, not an error to shout about: the page says so in
plain language and re-reads, so the second admin immediately sees the real state.

**8. The audit trail is reduced, not dumped.** `actions[].details` is a
`Record<string, unknown>` straight from the database. `auditEntries()` keeps only
a `reason` string when that is what it is and discards anything else — a JSON
blob has no business being rendered into a page.

**9. Role gating is UX and is labelled as such.** Anonymous and non-ADMIN
visitors are turned away **before any admin request is made**, and a signed-out
admin is asked to sign in rather than shown a 401. `adminRouter` applies
`requireAuth` + `requireRole('ADMIN')` before any handler runs. Nothing in the
admin client sends an admin id: the server takes the actor from the session, so
there is no field for one, and a test asserts none of `adminId`, `verifiedBy`,
`userId` or `providerId` ever appears in a request body.

**10. The detail id is never typed.** `/admin/providers/:id` is only reachable
from a link the server's own pending list rendered. There is no free-text id
field in the admin UI, so an admin cannot hand-type an id to probe the endpoint.

### Consequences

- Adding a status to the verification enum requires touching `ADMIN_ACTIONS` and
  `VERIFICATION_LABEL`, or the badge/action will not appear. Documented in the
  code.
- Zero backend surface was added and no verification endpoint was modified.
- Approved/rejected/suspended providers are reachable only by direct link from
  a decision, not by browsing a list. Lifting that needs a backend list endpoint
  with its own authorization thinking — deliberately not faked here.
- The admin navbar shows "Admin dashboard" and "Browse providers". Customer and
  provider navigation is unchanged; public navigation is unchanged.

### Alternatives rejected

- **A status dropdown** — would need a generic status endpoint to be meaningful,
  and would let an admin attempt any transition including ones the state machine
  forbids. The three explicit endpoints are the safer and simpler shape.
- **A "Revive" button for rejected providers** — permitted by the API, but it
  makes a policy decision a single click away.
- **Rendering the admin DTO directly** — simplest code, and it puts one admin's
  user id on screen for no benefit.
- **An `/api/admin/providers/stats` endpoint** — a new backend contract, guarded
  and tested, purely to populate cards whose numbers were already derivable (or,
  for the non-derivable ones, un-honest).
- **Fake approved/rejected/suspended tabs** — showing an empty list and calling
  it "no approved providers" would be a lie; the API cannot answer that question.

---

## ADR-028 — Reviews: the existing schema was already the security boundary

**Status:** Accepted · **Phase 15** · Relates to ADR-002, ADR-016, ADR-021, ADR-022, ADR-023, ADR-027

### Context

Reviews are the last major customer-facing feature and the phase brief said to
inspect the database first and reuse what exists. It turned out the `reviews`
table from migration 004 already encodes almost the entire rule set at the
storage layer — including two constraints that are easy to miss and that make
several of the brief's requirements true *by construction* rather than by
application code.

There was also an existing read path: the public provider profile already
returns anonymous reviews and a cached rating average. So the honest scope of
this phase was narrower than it first appears: add the write path, add the
customer UI, and delete nothing.

### Decision

**1. No migration. The `reviews` table was already correct.**

Migration 004 already declares:

- `booking_id UUID NOT NULL UNIQUE` — one review per booking, enforced by the DB
- `rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5)`
- `FOREIGN KEY (booking_id, customer_id) REFERENCES bookings (id, customer_id)`
- `FOREIGN KEY (booking_id, provider_id)  REFERENCES bookings (id, provider_id)`
- `CHECK (customer_id <> provider_id)`
- `CHECK (comment IS NULL OR length(trim(comment)) <= 2000)`

The two composite foreign keys are the important discovery. They make it
**impossible** to store a review whose customer or provider disagrees with the
booking, no matter what the application does. So "a customer cannot review
another customer's booking" and "the reviewed provider is derived from the
booking" are database invariants, not application promises. Adding a migration
to re-state rules the schema already enforces would have been redundant
surface area to maintain.

**2. The write path sends three fields, and the type says so.** `createReview`
posts `{ bookingId, rating }` plus `comment` when there is one. `CreateReviewRequest`
has no `customerId`, `userId`, `reviewerId` or `providerId` field at all, so the
omission is enforced by the type system. The server schema is `.strict()`, so
those keys are *rejected* rather than ignored — a client that tried to send
them gets a 400 instead of a false sense that it worked.

**3. Eligibility is 409, not 403, and a cross-customer booking is 404.**
Reviewing your own PENDING booking is a state problem, not a permission one, so
it answers 409 with "only once the provider has completed it". Another
customer's booking does not exist as far as the caller is concerned, so it
answers 404 — indistinguishable from an unknown id, which stops the endpoint
being used to probe for booking ids.

**4. Duplicates are prevented by the database, and 409 says so cleanly.**
`booking_id ... UNIQUE` is the real guard; a concurrent double submission can
only produce one row. The application check exists to return a good message, not
to be the only thing standing in the way. `23505` is translated to "You have
already reviewed this booking." and a test asserts the constraint name,
"duplicate key", "unique", "relation" and `pg_` never reach the client.

**5. The public read path was left alone, deliberately.** `GET
/api/providers/:id` already returns `PublicReviewDto` — rating, comment,
`createdAt`, and nothing else. No reviewer id, name, email or booking id. Adding
`GET /api/providers/:id/reviews` would have been a second answer to a question
the profile already answers, with a different privacy contract to keep in
sync. The rating average and count are cached columns on `provider_profiles`,
recomputed by trigger, and unrated providers report `null` rather than 0 or NaN
so the UI can honestly say "New to ServiceConnect".

**6. Comments are trimmed, blank ones become NULL.** A whitespace-only comment
trims to `''` and is stored as `NULL` rather than as a row of invisible
whitespace — which also makes `length(trim(comment))` in the CHECK meaningful.
The client omits an empty comment entirely rather than sending `''`, and the
limit is the schema's 2000, not an invented 1000.

**7. The rating control is a radio group, because a rating is one.** Five
native radios styled as stars, each with its own accessible name ("1 star" …
"5 stars"). That gives arrow-key navigation, a real form value and a
screen-reader-announced position for free; a row of clickable icons would have
to reimplement all three and probably get one of them wrong.

**8. After submission the form is replaced by the stored review.** The
"already reviewed" state renders what the server returned, so the second
submission is impossible from that page and the rating shown is the stored one
rather than whatever was last typed. The booking detail page also shows
"Leave a review" on completed cards in the list, so the entry point is
discoverable without adding review state to the dashboard.

**9. Editing and deletion are out of scope, and were not added.** One completed
booking, one review. A moderation or edit flow is a product decision, not
something to smuggle in with a feature that does not need it.

### Consequences

- Zero migration changes; the schema is untouched and still the source of truth.
- The public provider profile and its `ReviewList` needed no changes at all —
  they were already correct and already covered by existing tests.
- Adding a field to the public review DTO would be a privacy change, not a
  feature, and would need its own review.
- Review eligibility in the UI mirrors the server rule so no dead-end
  "Leave a Review" button is offered on a booking that cannot be reviewed. The
  server still re-checks; a 409 is handled with a plain-language message.

### Alternatives rejected

- **A migration tightening the rating check** — the CHECK constraint already
  exists and the tests already prove the range is enforced at the DB.
- **`GET /api/providers/:id/reviews`** — a redundant endpoint answering a
  question the profile already answers, with a second privacy contract to keep
  in sync.
- **An admin review-moderation table** — significant new surface for a
  requirement that does not exist.
- **Allowing edits or deletes** — changes "one review per booking" into a
  lifecycle, which the phase explicitly excluded.
- **Storing a blank comment as `''`** — harmless-looking, but it makes the
  CHECK's `trim()` a no-op and leaves meaningless rows behind.

---

## ADR-029 — In-app notifications: server-created, transaction-scoped, never client-addressed

**Status:** Accepted · **Phase 16** · Relates to ADR-002, ADR-015, ADR-016, ADR-023, ADR-027

### Context

Bookings move through a strict state machine, but nothing told either party
when something happened. A customer learned their booking was accepted only by
reloading a page; a provider learned about a new request only by refreshing their
queue.

The risks in a notification feature are not the UI. They are (a) a client being
able to say who gets told what, and (b) a notification existing for a booking
change that never committed.

### Decision

**1. There is no "create a notification" endpoint — at all.** The obvious design
is `POST /api/notifications`. It was rejected outright: any create endpoint is a
body in which a client could name a recipient, pick a type, and write a message.
Instead every insert is an internal function called from booking business logic,
so the recipient, type, title and message are all produced in code, from server
state. There is nothing for a client to supply. `POST /api/notifications` answers
404, and a test asserts it.

**2. Recipients come from the booking, never from the request.** Every booking
transition notifies exactly one counterparty, resolved from the booking row:
provider accepts/rejects/starts/completes -> the **customer**; customer cancels
-> the **provider**; booking created -> **both**. `counterpartyId()` reuses the
same visibility predicate as `loadVisibleBooking`, so it can only ever return
the counterparty of a booking the caller can already see. Notifications were
never sent to admins merely for being admins.

**3. Atomicity: the notification commits with the transition.** The booking
service previously used no explicit transactions — each transition was a single
guarded `UPDATE`. Notifications made that insufficient, because a state change
and its notification are two statements that must agree. Both are now inside one
`BEGIN`/`COMMIT` via `pool.connect()`, the same pattern
`admin.providers.service.ts` already uses. If the insert fails the status change
rolls back with it. A notification can therefore never describe a transition
that was rolled back, and a booking change can never commit silently un-notified.

**4. Duplicate prevention comes from the state machine, not a uniqueness
constraint.** Every transition is a guarded `UPDATE ... WHERE id = $1 AND status
= $current`. If the guard matches nothing, the function throws 409 and **never
reaches the insert**. So "exactly one notification per transition" is already
guaranteed by the row count — a repeated or raced request cannot produce a second
notification. Adding a unique index on (type, booking, recipient) was considered
and rejected: the brief explicitly warned against over-engineering, and the
invariant is structural. A test fires the same transition twice and asserts one
notification, and another asserts a *refused* transition leaves none behind.

**5. Scoping is a single-statement `WHERE id = $1 AND user_id = $2`.** Marking
read does its check and its update in ONE statement rather than a SELECT
followed by an UPDATE, so another user's notification is indistinguishable from
one that does not exist (404 either way). A SELECT-then-UPDATE would leak
existence through a different error. `read-all` is likewise scoped to
`req.user.id`, and marking an already-read notification is a harmless no-op so a
double-click cannot error.

**6. `requireAuth`, not `requireRole`.** Notifications are for every role, and
whether a user may read *their own* rows has nothing to do with what role they
hold. The scoping that matters is the `user_id` predicate on every query. The
router also registers `/read-all` before `/:id/read` so it is never captured as
an id.

**7. No polling, no WebSockets.** The unread count is fetched once per session
and refreshed on SPA navigation; opening the bell panel re-reads the list. There
is no interval and no background timer, so an idle tab costs nothing and a
duplicate timer cannot accumulate. This is "refresh-on-navigation", and it is
the right trade for a college-scale app.

**8. Notifications cannot steer the browser.** The API never returns a URL. The
client builds the route itself from `relatedBookingId` — a UUID from our own
database — so a notification cannot become an open-redirect or phishing vector. A
test asserts the route always starts with `/` and can never be absolute or
protocol-relative, including when the id is a hostile string.

**9. Reviews stay anonymous, including in notifications.** The
`REVIEW_SUBMITTED` message says "A customer left a 5-star review" and never
names the reviewer, because a notification is the one place the provider would
see it and reviews are anonymous everywhere else in the app.

**10. `read_at` rather than a boolean.** NULL means unread, and "when was it
read" is then free — which the panel's relative timestamps and any future
first-read analytics need. The length CHECKs on title and message are a hard
backstop against a notification being used to store request payloads.

### Consequences

- `bookings.service.ts` and `reviews.service.ts` now use explicit transactions.
  This is the one behavioural change outside the new module, and it was required
  by the atomicity requirement rather than chosen for style. All 115 pre-existing
  tests passed unchanged through that change.
- Notification types are duplicated in three places (the Postgres enum, the
  server's `NOTIFICATION_TYPES`, the client's copy). That is the project's
  established pattern (ADR-002) and is checked by tests on both sides, but it is
  a real thing to remember when adding an eighth type.
- A customer sees a `BOOKING_REJECTED` notification containing the provider's
  rejection reason. That reason is already shown to the customer on the booking
  detail page, so it is not new disclosure — but it is worth knowing.
- There is no email or push. This is in-app only, which is what was asked for.

### Alternatives rejected

- **`POST /api/notifications`** — the single easiest way to ship a
  recipient-selection vulnerability.
- **A best-effort insert after the state change** — a notification could then
  exist for a rolled-back transition, or be silently lost, with no way to tell.
- **A unique index on (type, booking, recipient)** — redundant; the guarded
  UPDATE already makes duplicates impossible, and the index would need
  de-duplication logic for rows created before it existed.
- **WebSockets or 5-second polling** — disproportionate here, and polling an
  idle tab forever is a cost with no user-visible benefit.
- **Letting the API return a `url` field** — a stored-XSS/open-redirect vector for
  no benefit; the client can derive the route from the booking id itself.

---

## ADR-030 — Indian localisation and role-aligned onboarding: one formatter, one role table, and no new architecture

**Context.** Phase 18 re-targeted ServiceConnect at the Indian market and asked for the
three role journeys to be legible end to end. The application was otherwise complete:
auth, the booking state machine, provider verification, reviews and notifications were
all built and tested. The question this ADR answers is what to change — and, more
importantly, what to leave alone.

**Decision. Reuse the existing architecture almost entirely.** Six targeted changes:

1. One currency formatter at the display boundary.
2. Indian demo fixtures in the seed file only.
3. Provider registration fields extended (phone, service areas, years of experience) —
   still landing PENDING by column default.
4. A role→route table and a role→links table in the client.
5. A "My business" page exposing endpoints that already existed.
6. One server fix so those endpoints were actually reachable from a UI.

---

### 1. USD -> INR: format at the boundary, store plain numbers

`lib/format.ts` had exactly one price formatter, `` `$${amount.toFixed(0)}` ``, and all
eight price-rendering surfaces already delegated to it. So the currency change was a
single function, not a sweep.

```ts
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});
```

**Why `en-IN` and not `en-US` with `currency: 'INR'`.** They are not the same string.
`en-IN` applies Indian digit grouping: 123456 becomes `₹1,23,456`, where `en-US` gives
`₹123,456`. For an Indian audience the lakh grouping is the expected form, and a price
above ₹1,00,000 is entirely ordinary here. This was verified before writing any code
rather than assumed.

**Why the symbol is never stored.** A `₹` character in a `NUMERIC(10,2)` column is
impossible anyway, but the deeper point is that a symbol in storage poisons sorting,
filtering, aggregation and any future currency change. The symbol is a *rendering*
concern, so it lives in exactly one function and nowhere else. Registration and service
prices are accepted as plain numbers, and the tests assert the stored value matches
`/^[0-9.]+$/`.

**Rejected:**
- **Storing a formatted string** — breaks the numeric columns and every price filter.
- **A hand-rolled `₹${n.toLocaleString()}` in each component** — the exact bug this
  phase fixes. `currency.test.ts` now asserts no component hand-rolls a price string,
  so it cannot come back.
- **A global locale switch** — no requirement for a second currency, and one locale
  switch adds a knob nobody would turn.

**Also raised the `hourlyRate` ceiling** from `10_000` to `10_000_000`. The old cap
implied a maximum of ₹10,000, which a realistic Indian business rate exceeds; leaving it
would have made the new registration field reject valid input. The database constraint is
only `> 0` with no upper bound, so this aligns the API with reality rather than inventing
a new rule.

### 2. Demo data: Goa, and only the demo data

The seed fixtures described San Antonio, Houston and Dallas with USD prices. They are
replaced with Goa cities (Panaji, Mapusa, Margao, Ponda, Porvorim, Vasco da Gama),
Goan/Indian business names, `+91` phone numbers and rupee-scale prices.

**Why Goa specifically** — a coherent, recognisable regional market makes the fixtures
read as real rather than random, and gives `serviceAreas` meaningful neighbouring towns
(Panjim beside Panaji, Margao beside Madgaon).

**What deliberately did not change:** the database schema, the currency columns, the
`service_areas` type, and every migration. Indian-ness is data, not architecture. The
`NUMERIC(10,2)` columns, `TEXT[]` areas and the ₹-agnostic query layer are exactly what
makes this a seed-only change.

Prices were re-scaled rather than merely re-symboled: `₹450` for a plumbing call-out
reads as implausible in this market, so fixtures sit between ₹1,500 and ₹85,000.
Internally the seed file's `rate` field is an advertised starting price, not an hourly
rate; the UI labels it "from", so nothing on screen claims a misleading unit.

### 3. Provider registration: extend the fields, keep the gate

`registerSchema` already accepted `role: 'PROVIDER'` and required `provider` details —
the backend was ready and the **frontend simply never offered it** (`LoginPage`
hard-coded `role: 'CUSTOMER'` with a comment saying provider onboarding "is a later
phase"). That comment was the actual defect. So this phase added the UI rather than
building a registration system.

Newly accepted at sign-up: `phone`, `serviceAreas`, `yearsExperience`. Business name and
city stay required; the rest are optional and editable later via `PATCH /providers/me`,
which already accepted all of them. Requiring everything would make sign-up a wall for a
provider who is not ready to write a description.

**The security-critical part is unchanged and deliberate.** The INSERT omits
`verification_status`, so the column `DEFAULT 'PENDING'` applies. There is no code path —
and now provably no request body — that can make a new provider APPROVED. `auth.service.ts`
says so at the INSERT, and a test posts a hand-crafted `verificationStatus: 'APPROVED'`
and asserts the outcome is PENDING and non-public.

**Rejected:** auto-approving providers who "look legitimate", a separate
`/providers/register` endpoint, and an admin pre-approval or invite step. All three
either weaken the verification gate that makes the marketplace trustworthy, or duplicate
an endpoint that already works.

### 4. Role routing: a table driven by the server's answer

`homeForRole(role)` maps CUSTOMER/PROVIDER/ADMIN to `/dashboard`, `/provider/dashboard`,
`/admin/dashboard`. The input is always the role the **server returned** in the auth
response, never a form selection — the `role` a user picks at sign-up decides what the
server is asked to create, not where they land. Previously `LoginPage` always navigated
to `/bookings`, which sent every provider and admin to a customer screen.

Navigation mirrors this with an exported `ROLE_LINKS` table so the contract is
assertable in tests rather than buried in JSX.

**This is UX routing, not authorization.** Every route still re-reads the role from the
database through `requireAuth`/`requireRole`; hiding a link stops nobody who edits the
browser. The tests assert the tables are correct and that admin links never appear in
another role's list — documentation of intent, not a security control.

**Rejected:** client-side route guards described as protection, and trusting a role
supplied by the user in a query parameter.

### 5. Two pre-existing link bugs, fixed

`Navbar` and `ProviderDashboardPage` both pointed "my profile" at `/providers` — the
**public search directory**. A provider clicking "my profile" was shown a list of other
people's businesses. Both now point at `/provider/business`. A source-level regression
test asserts no self-referential provider link targets `/providers`, since the failure
mode is invisible until someone uses the app.

### 6. The one genuine server bug

`POST /providers/me/services` requires a `categoryId` (a UUID), but
`GET /providers/categories` returned only `{ slug, name, providerCount }`. **Provider
service creation was therefore unreachable from any UI** — the endpoints existed, were
tested, and could not be driven end to end. Adding `id` to that response is the fix.

The alternative — accepting a category *slug* on write — was rejected: it would make two
different identifiers address the same row depending on which endpoint you used, and the
slug is the mutable, user-facing one. A category UUID is shared reference data carrying
no account or provider information, so exposing it is not a disclosure change.

---

### What was explicitly not done

No new database tables, columns or migrations. No new endpoints beyond exposing category
`id`. No rewrite of the auth, booking, verification or admin architecture. No payment,
chat or notification-channel work. No second currency, and no i18n framework for a
single-locale app.