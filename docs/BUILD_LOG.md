# Build Log — ServiceConnect

Chronological journal of every build step: what was created, why, and how it was
verified. Newest entries at the bottom. Every entry must state **verification**
results — "it compiles" is not the same as "it works".

---

## Step 001 — Project scaffolding (2026-09-30)

> **Note:** files under `backend/` and `frontend/` listed below were later
> renamed to `server/` and `client/` — see Step 002.

**Goal.** Establish the production-style skeleton only: repository layout,
documentation, environment configuration, and a runnable hello-world for both
apps. **No feature logic, no auth implementation, no database schema yet.**

### Created

**Root**

- `README.md` — overview, setup, commands, roadmap
- `.env.example` — env var reference for backend + frontend (no secrets)
- `.gitignore` — excludes `node_modules`, `dist`, `.env*` (keeps `*.env.example`)
- `docker-compose.yml` — PostgreSQL 16 for local development
- `package.json` — npm workspaces (`backend`, `frontend`) + convenience scripts

**docs/**

- `docs/BUILD_LOG.md` (this file)
- `docs/AI_DECISION_LOG.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`

**backend/** (Node.js + Express + TypeScript, strict mode)

- `package.json`, `tsconfig.json`, `.env.example`
- `src/index.ts` — boots the server, graceful shutdown (SIGINT/SIGTERM), closes pg pool
- `src/app.ts` — helmet, CORS (env allow-list), JSON body parsing, module routers, 404 + error handler
- `src/config/env.ts` — zod-validated environment; refuses to boot on invalid config
- `src/config/database.ts` — `pg` connection pool
- `src/middleware/errorHandler.ts` — 404 passthrough + centralized error responses
- `src/middleware/requireAuth.ts` — verifies JWT Bearer tokens, attaches `req.user`
- `src/middleware/requireRole.ts` — role gate (`requireRole('ADMIN')` …) enforced server-side
- `src/shared/httpError.ts`, `src/shared/types.ts`, `src/shared/express.d.ts`
- `src/modules/health/health.routes.ts` — `GET /api/health` (reports DB reachability)
- `src/modules/{auth,providers,bookings,admin}/…` — mounted routers returning
  `501 Not Implemented` (module boundaries exist, logic arrives in later steps)

**frontend/** (React + TypeScript + Vite + Tailwind CSS v4)

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.example`
- `src/main.tsx`, `src/App.tsx` — router + shared layout shell
- `src/index.css` — Tailwind v4 entry (`@import "tailwindcss"`)
- `src/pages/{HomePage,LoginPage,NotFoundPage}.tsx` — placeholders; login form is
  explicitly disabled (no fake client-side security theater)
- `src/lib/api.ts` — typed fetch client reading `VITE_API_URL`
- `src/types/index.ts` — shared `Role` union mirroring the backend
- `src/vite-env.d.ts`

### Verification

- `npm install` at the repo root succeeded (workspaces: backend + frontend).
- `npm run typecheck` — passes for both packages.
- `npm run build` — backend `tsc` → `dist/`, frontend `tsc && vite build` → `dist/` succeed.
- Backend booted and `GET http://localhost:4000/api/health` returned `200` with
  `{"status":"ok", ...}` (database reported `down` at that moment because no
  PostgreSQL container was running — expected and handled gracefully).
- No secrets are present in any committed file; `.env` files are git-ignored.

### Not done (intentionally)

Database schema/migrations, auth endpoints, password hashing, any provider,
booking or admin logic, tests. See README roadmap.

---

## Step 002 — Restructure + UI skeleton (2026-09-30)

**Goal.** Align the repository with the required layout (`client/`, `server/`,
`docs/`, `database/`), satisfy the exact health contract, and ship the initial
frontend skeleton: landing page + responsive navigation. Still **no
authentication**.

### Changes

**Structure**

- Renamed `frontend/` → `client/`, `backend/` → `server/` (folder moves only;
  root workspaces and scripts updated: `dev:client`, `dev:server`,
  `start:server`; package names → `serviceconnect-client` / `serviceconnect-server`).
- Created `database/` with `README.md`, `migrations/README.md`,
  `seeds/README.md` (schema itself deferred to the next step).
- Updated all path references across README, `.env.example`, `docker-compose.yml`,
  `docs/*`.

**Server**

- `GET /api/health` now returns the exact contract
  `{"status":"ok","service":"ServiceConnect API"}` (DB ping removed from the
  response so the payload is constant and monitor-friendly).
- Centralized error handling, zod env validation and modular routing
  (`src/modules/*`) unchanged from Step 001.

**Client**

- Added `lucide-react` (^1.49.0) for icons.
- New `src/components/Navbar.tsx`: sticky header, desktop links (≥md), mobile
  hamburger menu with `Menu`/`X` icons, `aria-expanded`/`aria-controls`,
  closes on navigation. UX only — no auth logic.
- `App.tsx` now renders `<Navbar />` and adds the `/providers` route.
- `HomePage.tsx` rewritten as the landing page placeholder: hero, "How it
  works" steps, role cards (Lucide icons), live API-status widget adapted to
  the new health payload.
- New `src/pages/ProvidersPage.tsx` placeholder directory page.

### Verification

- Clean reinstall after the rename (lockfile regenerated; workspaces resolve
  to `server`/`client`).
- `npm run typecheck` — passes for both packages.
- `npm run build` — server `tsc` → `dist/`, client `tsc && vite build` → `dist/` succeed.
- Runtime: server booted; `GET /api/health` returned exactly
  `{"status":"ok","service":"ServiceConnect API"}`; protected `/api/admin/ping`
  returned `401` without a token (RBAC intact); stubbed auth route returned `501`.
- Client dev server served the landing page (HTTP 200) and the `/api` proxy
  reached the server.

### Not done (intentionally)

Authentication (explicitly out of scope for this step), database schema,
tests beyond typecheck/build/runtime smoke checks.

---

## Step 003 — Database layer (2026-09-30)

**Goal.** PostgreSQL schema for all eight entities with relationships,
constraints, indexes, timestamps; migrations; development seeds (8 categories,
8+ fictional providers); password hashes only — **no frontend work**.

### Created

**Migrations** (`database/migrations/`, applied by `npm run migrate`):

- `001_extensions_enums_triggers.sql` — enums `user_role`,
  `verification_status`, `booking_status`; `set_updated_at()` trigger.
- `002_identity.sql` — `users` (email unique + lowercased CHECK, phone partial
  unique, password_hash CHECK, role enum, is_active, timestamps) and
  `provider_profiles` (1:1 PK-FK, verification status, **generated**
  `is_public`, `verified_by/verified_at` w/ CHECK, partial index for public
  directory).
- `003_catalog.sql` — `service_categories` (name/slug unique),
  `services` (UNIQUE provider+title, price CHECK, FK RESTRICT to category),
  `provider_images` (UNIQUE provider+url, partial unique primary image).
- `004_bookings_reviews.sql` — `bookings` (6-status enum, composite uniques,
  anti double-booking partial index, reason CHECKs, self-booking CHECK) and
  `reviews` (one per booking, composite FKs to enforce matching
  customer/provider, rating 1–5).
- `005_admin_log_and_views.sql` — `admin_action_log` (admin FK RESTRICT for
  audit retention, target indexes) and the **`public_providers` view**
  (APPROVED + active users only, no contact info).

**Code** (`server/src/`):

- `db/migrate.ts` — checksum (SHA-256) migration runner, per-file
  transactions, refuses edits of applied migrations.
- `db/seedData.ts` — deterministic seed fixtures (fixed UUIDs).
- `db/seed.ts` — idempotent seeder; `--force` refused when
  `NODE_ENV=production`; one transaction; prints summary.
- `lib/password.ts` — scrypt hashing/verification (`scrypt$N$r$p$salt$hash`,
  timing-safe compare, min length 10). **Plaintext is never stored.**
- `package.json` scripts: `migrate`, `seed` (+ root aliases `npm run migrate`,
  `npm run seed`).

**Docs**: ADR-010…ADR-014 in `docs/AI_DECISION_LOG.md`; `database/README.md`
rewritten; SECURITY/DEPLOYMENT/README updated.

### Seeds

8 categories · 14 users (1 ADMIN, 2 CUSTOMER, 11 PROVIDER) · 11 provider
profiles (**8 APPROVED**/1 PENDING/1 REJECTED/1 SUSPENDED) · 19 services ·
11 images · 7 bookings covering **all six statuses** · 2 reviews · 3 admin
action logs. Shared dev password `Password123!` (scrypt-hashed, documented).

### Verification (live PostgreSQL 16 in Docker)

| # | Test | Result |
|---|------|--------|
| 1 | `npm run migrate` — 5 files applied | ✅ |
| 2 | Re-run migrate — all `skip` (checksums match) | ✅ idempotent |
| 3 | `npm run seed` — counts: 8/11(8 approved)/19/7/2 | ✅ |
| 4 | Re-run seed — "Seed skipped" | ✅ idempotent |
| 5 | `public_providers` view count = 8 (only APPROVED) | ✅ |
| 6 | All 6 booking statuses present | ✅ |
| 7 | `password_hash` prefix `scrypt$`, plaintext search = 0 rows | ✅ |
| 8 | Stored hash verifies `Password123!` (true) / rejects wrong (false) | ✅ |
| 9 | Duplicate/mixed-case email rejected (unique + CHECK) | ✅ rejected |
| 10 | Invalid `verification_status` / `role` rejected (enums) | ✅ rejected |
| 11 | Live double-booking rejected (`uq_bookings_live_slot`) | ✅ rejected |
| 12 | Review by wrong customer rejected (composite FK) | ✅ rejected |
| 13 | Self-booking rejected; REJECTED w/o reason rejected (CHECKs) | ✅ rejected |
| 14 | `updated_at` trigger fires on UPDATE | ✅ |
| 15 | `npm run typecheck` + `npm run build` | ✅ pass |

### Issues encountered

- **Docker Desktop daemon was not running** (CLI present, engine down) and not
  at the default install path — started it from
  `%LOCALAPPDATA%\Programs\DockerDesktop`.
- **`tsx` failed: `@esbuild/win32-x64` missing** — npm failed to resolve the
  optional platform binary for esbuild 0.28.2 (lockfile references it but the
  tree lacks it; `npm install --include=optional` did not repair it). Fixed
  locally with `npm install @esbuild/win32-x64@0.28.2 --no-save`. If it
  recurs on a fresh clone: run the same command (or delete `node_modules` +
  `package-lock.json` and reinstall).

### Not done (intentionally)

Auth endpoints (registration/login/JWT), provider availability, frontend
features — DB layer only, per instructions.

---

## Step 004 — Secure authentication (2026-09-30)

**Goal.** Customer + provider registration, login, logout, current-user
endpoint, password hashing, `requireAuth`/`requireRole` middleware, role
protection, input validation, safe errors, expiry/revocation — plus tests.

### Created / changed

**Migration**

- `database/migrations/006_auth_sessions.sql` — `auth_sessions` table
  (user FK CASCADE, `expires_at`, `revoked_at`, purge/user indexes): every JWT
  carries `sid`; logout revokes it server-side (ADR-015).

**Server** (`server/src/`)

- `lib/token.ts` — JWT sign/verify (`JWT_SECRET` env only; claims
  `sub`/`role`/`sid`/`issuer`/`exp`; `JWT_EXPIRES_IN` validated `^\d+[smhd]$`).
- `lib/sessions.ts` — create/revoke session, single-query
  "session live + user active + **fresh role from DB**" lookup, purge.
- `modules/auth/auth.schemas.ts` — zod: email/password/fullName/phone,
  `role: CUSTOMER|PROVIDER` (ADMIN impossible), provider details required for
  provider sign-up and forbidden for customers.
- `modules/auth/auth.service.ts` — register (scrypt hash, transaction:
  user + PENDING provider profile, 23505→409), login (generic 401 +
  dummy-hash timing equalization), logout, getMe; `PublicUser` projection
  (**no `password_hash` anywhere in responses**).
- `modules/auth/auth.routes.ts` — real endpoints replacing the 501 stub:
  `POST /api/auth/register` (201), `POST /api/auth/login` (200),
  `POST /api/auth/logout` (requireAuth, revokes session),
  `GET /api/auth/me` (requireAuth, reads DB).
- `middleware/requireAuth.ts` — rewritten: header → JWT verify → session
  live + user active + role from DB; fail-closed at every step.
- `middleware/requireRole.ts` — unchanged (401/403, fails closed); now
  exercised by tests against `/api/admin/*`.
- `shared/validate.ts` (`parseBody` → safe 400s), `shared/asyncHandler.ts`
  (Express 4 async error forwarding), `AuthUser.sessionId` added to types,
  `config/env.ts` regex-validates `JWT_EXPIRES_IN`.

**Tests** — `server/src/tests/auth.test.ts` (11 tests; Node built-in
`node:test` + `fetch`, zero new dependencies — ADR-017).
Scripts: `npm test` (root) / `npm test --workspace server`.

**Docs** — ADR-015/016/017; SECURITY.md controls & TODOs updated; README
roadmap + test command.

### Verification

| # | Test | Result |
|---|------|--------|
| 1 | `npm run migrate` — 006 applied, 001–005 skipped (checksums) | ✅ |
| 2 | `npm run typecheck` + `npm run build` (server + client) | ✅ pass |
| 3 | `npm test` — **11/11 pass** (see list below) | ✅ |
| 4 | Compiled `dist/` server: admin login → `/me` → `/api/admin/ping` (200) | ✅ |
| 5 | Compiled server: logout → same token now 401 | ✅ |
| 6 | Compiled server: wrong password → 401 | ✅ |
| 7 | Test cleanup: 0 leftover `auth-%` users, 0 orphan sessions | ✅ |

Test coverage (required scenarios in **bold**): **successful registration** ·
**duplicate email → 409** · **invalid login (unknown email & wrong password →
identical 401)** · **protected endpoints without token → 401** · **customer →
admin 403** · **provider → admin 403** · admin → admin 200 · role=ADMIN
registration rejected · input validation (short password, missing provider
details) · logout revokes token · provider sign-up creates non-public PENDING
profile.

### Issues encountered

- TS inference: `parseBody<T>(schema: ZodType<T>, …)` failed for
  `z.preprocess` outputs (`unknown`) — fixed by keying off `S['_output']`.
- No other blockers; first full run of the suite passed.

### Not done (intentionally)

Frontend auth UI (login/register pages wired to these endpoints), rate
limiting/lockout, refresh tokens, admin-account provisioning flow — tracked in
docs/SECURITY.md.

---

## Step 005 — Provider onboarding & verification workflow (2026-09-30)

**Goal.** Register → PENDING → invisible → admin reviews → approve/reject/
suspend → approved becomes publicly searchable. Full provider profile
(business name, description, phone, location, service area, experience,
profile + cover image) with `GET/PATCH /api/providers/me`, admin endpoints,
`AdminActionLog` on every decision, and authorization tests.

### Created / changed

**Migration** — `007_provider_profile_extensions.sql`: adds `phone`,
`service_areas TEXT[]` (GIN index), `profile_image_url`, `cover_image_url`
with CHECKs; appends the three non-contact columns to `public_providers`
(email/phone remain private).

**Provider self-service** (`modules/providers/`)
- `providers.schemas.ts` — strict `PATCH` schema (unknown keys → 400),
  admin-decision body schemas, UUID param guard (reused by admin routes).
- `providers.service.ts` — DTO mapper, `getMyProfile`, `updateMyProfile`
  with **writable-column whitelist** (verification columns absent by design).
- `providers.routes.ts` — `GET/PATCH /me` behind
  `requireAuth + requireRole('PROVIDER')`; other paths still 501.

**Admin** (`modules/admin/`)
- `admin.providers.service.ts` — `listPending`, `getDetail` (+ decision
  history), `decide()` = single transaction: `SELECT … FOR UPDATE` → no-op
  409 guard → status update (`verified_by/at`) → `admin_action_log` insert.
- `admin.providers.routes.ts` — `GET /pending`, `GET /:id`,
  `PATCH /:id/approve|reject|suspend` (reject requires `reason`), mounted at
  `/api/admin/providers` under the existing ADMIN guard.

**Tests** — `src/tests/provider.test.ts` (8 tests). Suite now runs both files
(`npm test`).

**Docs** — ADR-018, ADR-019; SECURITY.md controls; README endpoints/roadmap.

### Verification

| # | Test | Result |
|---|------|--------|
| 1 | `npm run migrate` — 007 applied, 001–006 skipped | ✅ |
| 2 | `npm run typecheck` + `npm run build` | ✅ pass |
| 3 | `npm test` — **19/19** (11 auth + 8 workflow) | ✅ |
| 4 | Cleanup: 0 leftover users; admin_action_log back to 3 seeded rows | ✅ |

Workflow test coverage: **register → PENDING → not in `public_providers`** ·
profile PATCH updates fields but `verificationStatus`/foreign `userId`
smuggling → 400 with DB unchanged · **customer → admin endpoints 403** ·
**provider self-approve → 403 (status unchanged)** · provider B → provider A's
admin routes 403 · pending queue + detail (+400 non-UUID, +404 unknown) ·
reject **with reason** → REJECTED + exactly 1 audit row with reason ·
approve → APPROVED → **row appears in `public_providers`** · suspend → gone
from public view · full transition set logged `PENDING→REJECTED`,
`REJECTED→APPROVED`, `APPROVED→SUSPENDED` · no-op decision → 409 · reject
without reason → 400 · provider B remains untouched.

### Issues encountered

None — migration, typecheck, build and the full suite passed first try
(the `tokenB` unused-local was caught pre-run by reusing it for an extra
cross-provider assertion).

### Not done (intentionally)

Public provider search endpoints (`GET /api/providers` — returns 501 stub),

---

## Step 006 — Provider service management (IDOR-safe CRUD)

### Files

**New**
- `database/migrations/008_service_name_and_price_range.sql`
- `server/src/modules/providers/services.schemas.ts`
- `server/src/modules/providers/services.service.ts`
- `server/src/tests/services.test.ts`

**Changed**
- `server/src/shared/validate.ts` — added `parseParams`
- `server/src/modules/providers/providers.routes.ts` — 4 service routes
- `server/package.json` — test script includes `services.test.ts`
- `docs/AI_DECISION_LOG.md` (ADR-020), `docs/SECURITY.md`,
  `database/README.md`, `README.md`

### Schema (migration 008)

The spec's service shape didn't match `003`, so: `title` → `name`, and single
`price` → `price_from` + `price_to`. Existing rows were **backfilled** from
the old column before `price` was dropped (no data loss). The
`UNIQUE (provider_id, title)` constraint survived the rename by column
attachment and was renamed `uq_services_provider_name` for clarity. Added
`chk_services_name` (3–120), `chk_services_duration` (15–1440) and
`idx_services_provider_active`.

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/providers/me/services` | PROVIDER | Own catalogue, active first |
| POST | `/api/providers/me/services` | PROVIDER | `201 { service }` |
| PATCH | `/api/providers/me/services/:id` | PROVIDER | Partial update, ≥1 field |
| DELETE | `/api/providers/me/services/:id` | PROVIDER | Soft delete (`isActive:false`) |

A service carries category, name, description, `priceFrom`/`priceTo`, estimated
duration and active status. Category name/slug are joined into the response so
the UI needs no second call.

### Ownership enforcement (the point of the task)

- `providerId` is taken **only** from `req.user.id` (verified token) — never
  from body/query/URL.
- Every `SELECT`/`UPDATE`/`DELETE` carries `AND provider_id = $n`. The
  ownership predicate lives in the SQL, so it cannot be bypassed by a route.
- Schemas are `.strict()` with no `providerId`/`id` field → payload
  reassignment is a 400, not a silent hijack.
- Foreign id → **404** (identical to a non-existent id) so 403s can't be used
  as an existence oracle.
- `priceTo >= priceFrom` is re-checked against the *stored* row on partial
  updates, not just against the request body.
- PG `23505/23503/23514` → `409/400/400`; no SQL text in responses.

### Verification

`npm run migrate` (008 applied, 001–007 checksum-skipped) · `npm run
typecheck` ✅ · `npm test` → **27/27** (11 auth + 8 provider workflow + 8
service) · `npm run build` ✅ · live `dist/` smoke test ✅.

| Test | Covers |
|---|---|
| create/edit/list/deactivate | Happy path; soft delete leaves the row |
| validation (13 cases) | name, price range/decimals/ceiling, duration, description, category, empty PATCH, inverted partial update, 409 duplicate name |
| IDOR 1 | Listing returns only the caller's rows (DB-verified) |
| IDOR 2 | B PATCHes A's id → 404, A's row unchanged |
| IDOR 3 | B DELETEs A's id → 404, service still active |
| IDOR 4+5 | `providerId`/`provider_id`/`id`/`userId` in body → 400 |
| IDOR 6 | Foreign id, unknown id and bad body are indistinguishable |
| rule 7 | Anonymous 401 / customer 403 / admin 403 on all four methods |

Also verified out-of-band: direct `psql` INSERTs violating the price range,
name length and duration bounds are all rejected by the DB itself.

Cleanup verified: 0 leftover test users, 0 orphaned services.

### Issues hit

- `chk_services_name` was declared twice in 008 (two sections) → migration
  aborted on the duplicate; the per-file transaction rolled back cleanly and
  the duplicate was removed before re-running.
- A line-based insert landed mid-function in `services.service.ts` and
  `services.test.ts`, truncating code → repaired and re-verified with
  `tsc --noEmit` before running tests.
- Two of my own assertions were wrong: `providerId` isn't part of the service
  DTO (checked ownership in the DB instead), and a `{ name: 'x' }` body failed
  the 3-char minimum so it never reached the ownership check (used a valid
  body). Both were test bugs, not API bugs.
- PowerShell's `docker exec` appends `\r`; trimmed before sending a UUID to
  the API.

### Not done (intentionally)

Public search endpoints, image uploads, admin moderation UI, booking flows.


---

## Step 007 — Public provider search

### Files

**New**
- `database/migrations/009_public_provider_search.sql`
- `server/src/modules/providers/search.schemas.ts`
- `server/src/modules/providers/search.service.ts`
- `server/src/tests/search.test.ts`

**Changed**
- `server/src/modules/providers/providers.routes.ts` — `GET /` + `GET /categories`
- `server/package.json` — test script includes `search.test.ts`
- `docs/AI_DECISION_LOG.md` (ADR-021), `docs/SECURITY.md`,
  `database/README.md`, `README.md`

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/providers` | — | Public search + pagination |
| GET | `/api/providers/categories` | — | Filter options with provider counts |

**Query parameters** (all validated, unknown keys → 400):

| Param | Type | Notes |
|---|---|---|
| `keyword` | string ≤120 | business name, description, service names; trigram-indexed |
| `category` | slug | matches any active service in that category |
| `location` | string ≤120 | city or advertised service area |
| `minPrice` / `maxPrice` | decimal ≥0 | budget band (min matches *any* qualifying service) |
| `rating` | 0–5 | minimum average; excludes unrated |
| `availability` | true/false | has ≥ 1 active service |
| `sort` | `rating` \| `price` \| `newest` | default `newest` |
| `order` | `asc` \| `desc` | default `desc` |
| `page` / `pageSize` | int | pageSize capped at 50 |

### Schema (migration 009)

Added `rating_avg`, `rating_count`, `price_min`, `active_service_count` to
`provider_profiles` as **search caches**, recomputed by
`refresh_provider_search_stats` (triggered by any write to `services` or
`reviews`) and backfilled for existing rows. Enabled `pg_trgm` with GIN indexes
on `business_name`/`description`. Added four partial indexes scoped to
`verification_status = 'APPROVED'`. Extended `public_providers` with the new
columns.

### Security

- **Only APPROVED** — the view is the gate; PENDING/REJECTED/SUSPENDED rows are
  unreachable rather than merely filtered.
- **Allow-list DTO** — 15 named fields, nothing else can leak.
- **Parameterised SQL** — all values bound; only the `ORDER BY` is
  interpolated, from a fixed lookup keyed by a validated enum.
- **`LIKE` wildcards escaped** — `?keyword=%` returns 0 results, not everything.
- **Withheld**: password hashes, email, phone, owner name, `verified_by`,
  `admin_action_log` reasons/notes, street address, hourly rate.

### Verification

`npm run migrate` (009 applied, 001–008 skipped) · `npm run typecheck` ✅ ·
`npm test` → **41/41** (11 auth + 8 provider + 8 services + **14 search**) ·
`npm run build` ✅ · live `dist/` smoke test ✅.

| Search test | Covers |
|---|---|
| unfiltered = APPROVED set | Result set equals `public_providers` exactly |
| PENDING/REJECTED/SUSPENDED hidden | 9 query shapes swept + exact-name search |
| exposure | 15 forbidden substrings, exact key allow-list, no phone/address |
| keyword | business name, service name, case-insensitive, no-match |
| category | every slug returns only matching providers; unknown → empty |
| location | city, partial, service-area array |
| price/rating/availability | each filter verified against the DB, plus combinations |
| availability trigger | deactivating services decrements the count one by one |
| pagination | metadata, non-overlap, full coverage, past-the-end, defaults |
| sorting | rating/price/newest asc+desc, NULLS LAST, real recency ordering |
| validation | 18 invalid params + unknown key → 400 |
| injection | 5 payloads × 3 params; tables verified intact afterwards |
| public access | 200 with and without a (bogus) token |

Also confirmed: no residual test users, 0 inactive services, 0 stray
`service_areas`, and the suite is **idempotent** (41/41 on two consecutive runs).

### Issues hit

- **Postgres forbids `NEW.x` in trigger arguments** — moved the id extraction
  into the function body and used `TG_OP` to distinguish DELETE.
- A `CREATE OR REPLACE VIEW` from an earlier failed run bound the old column
  list; cleaned up the partial state manually before re-running the migration.
- `test.serial` does not exist in `node:test` — the correct lever is
  `describe(..., { concurrency: 1 })`, since these tests mutate seeded rows.
- `minPrice=0` was rejected because the bound required `> 0`; zero is a
  legitimate lower bound, so the schema now allows it.
- Two column-name mistakes in test fixtures (`provider_profiles.id` vs
  `user_id`, and `public_providers` aliasing `user_id` as `id`).
- Several line-based inserts landed mid-function again; repaired and
  re-verified with `tsc --noEmit` before running.

### Not done (intentionally)

Provider profile detail page (`GET /api/providers/:id`), map/geolocation
search, fuzzy typo tolerance beyond trigram matching, cursor pagination,
caching. Frontend search UI not started.



---

## Step 008 — Public provider profile

### Backend inspection (as instructed)

Checked before writing any code. `GET /api/providers` returns **list rows only**
— no services, no gallery, no reviews — so it could not back a profile page.
Confirmed with `psql` that every needed column already existed
(`services`, `provider_images`, `reviews`), so **no migration was required**.

### Files

**New (6)**
- `server/src/modules/providers/profile.service.ts` — the public profile query
- `server/src/tests/profile.test.ts` — 13 tests
- `client/src/pages/ProviderProfilePage.tsx` — page + states
- `client/src/components/providers/ImageGallery.tsx`
- `client/src/components/providers/ServiceList.tsx`
- `client/src/components/providers/ReviewList.tsx`

**Changed (5)**
- `server/src/modules/providers/search.service.ts` — exported `PUBLIC_COLUMNS`,
  `toPublicDto`, `ProviderRow` so the profile reuses the search allow-list
- `server/src/modules/providers/providers.routes.ts` — `GET /:id`, registered
  after every `/me` route
- `client/src/types/index.ts` — `PublicService`, `PublicImage`, `PublicReview`,
  `PublicProviderProfile`
- `client/src/lib/api.ts` — `getProviderProfile`
- `client/src/App.tsx` — `/providers/:id` route
- `client/src/components/providers/ProviderCard.tsx` — "View Profile" is now a
  real link (the endpoint exists); "Book Service" stays disabled

`index.css` was **not** touched — the page uses the existing design system only.

### Endpoint

`GET /api/providers/:id` → `200 { provider: {...} }`

Base row comes from `public_providers` (the APPROVED gate), then services,
images and reviews load in parallel.

### Verification

`npm run migrate` → no-op (no migration) · `npm test` → **54/54** (13 new) ·
`npm run typecheck` → **0** · `npm run build` → **0** (342 kB JS / 44 kB CSS).

**Live status-code matrix** (all 11 seeded providers exercised):

| Case | Result |
|---|---|
| APPROVED × 8 | **200** |
| PENDING | **404** |
| REJECTED | **404** |
| SUSPENDED | **404** |
| unknown UUID | **404** |
| malformed id | **400** |
| `GET /api/providers/me` | **401** — not shadowed by `/:id` |

**Payload inspection** (reviewed provider, 1089 bytes):
- Top level: exactly 18 keys = the 15 search allow-list fields + `services`,
  `images`, `reviews`
- Service keys: `id, name, description, priceFrom, priceTo, durationMinutes, category`
- Review keys: `rating, comment, createdAt` — no reviewer identity
- **Leak scan: CLEAN — 0 of 13** forbidden fields present (`password`, `scrypt`,
  `email`, `phone`, `fullName`, `verifiedBy`, `hourlyRate`, `address`,
  `is_active`, `reason`, `customer_id`, `booking_id`, `admin`)

**Automated tests (13)** cover: APPROVED payload · each non-approved status →
404 · rejected still hidden from search · deactivated user → 404 · unknown vs
rejected indistinguishable · malformed → 400 · public without auth · 21-field
leak scan · real phone number not published · exact top-level allow-list ·
service allow-list + deactivating services removes them · image keys ·
review anonymity · aggregates match the DB.

**Frontend states (26 SSR assertions)**: the page mounts and shows the loading
skeleton with `aria-busy` at all six URLs (approved/pending/rejected/suspended/
unknown/malformed), plus the 8 shared format-helper edge cases.

**Responsive**: single column below `lg`; `lg:grid-cols-[1fr_20rem]` with a
sticky booking sidebar above. Cover `h-40 → h-56`, avatar pulled up with
`-mt-14 sm:-mt-16` and reset on desktop.

### Issues hit

- Several line-based inserts landed mid-statement and scrambled three files
  (`profile.test.ts`, `ProviderProfilePage.tsx`). Repaired by truncating to the
  last known-good line and re-appending, verifying with `tsc --noEmit` and a
  brace-depth count after each pass.
- The test harness failed to compile twice under `tsx` because `import.meta.env`
  is a Vite construct; re-run through `vite build --ssr` (jsdom is not
  installed). Harness and `dist-ssr` removed afterwards.
- A PowerShell helper function named `gc` collided with the built-in
  `Get-Content` alias; renamed to `Get-HttpCode`.

### Honest limitations

- The profile page is a client-rendered SPA, so `/providers/:id` always serves
  HTTP 200 for the shell; the not-found vs. error decision is made client-side
  from the API status (404 → "not available", anything else → "could not
  load"). Verified via the status matrix and the SSR mount test rather than a
  rendered DOM.
- Pixel-level layout at specific breakpoints was not visually confirmed.


---

## Step 009 — Booking system (real workflow, not a placeholder)

### Inspection (done first, as required)

Read `004_bookings_reviews.sql`, the `bookings` 501 stub, `requireAuth` /
`requireRole`, the service-management module and the provider-profile endpoint.
Conclusion: the **`bookings` table is complete and strong enough to reuse** —
customer/provider/service FKs, the `booking_status` enum, the no-self-booking
CHECK, the REJECTED/CANCELLED reason CHECKs and the anti-double-booking partial
unique index. Exactly **one** thing was genuinely missing: the flow collects a
*problem description* separately from *notes*, and `004` only had `notes`.

### Files

**New (5)**
- `database/migrations/010_booking_problem_description.sql`
- `server/src/modules/bookings/bookings.schemas.ts`
- `server/src/modules/bookings/bookings.service.ts`
- `server/src/modules/bookings/provider.bookings.routes.ts`
- `server/src/tests/bookings.test.ts` — 27 tests

**Changed (5)**
- `server/src/modules/bookings/bookings.routes.ts` — was a 501 stub, now the
  four customer routes
- `server/src/shared/types.ts` — status enum + `BOOKING_TRANSITIONS` map
- `server/src/app.ts` — mounted `/api/provider`
- `server/package.json` — test script + `--test-concurrency=1`
- `docs/AI_DECISION_LOG.md` (ADR-023), `docs/BUILD_LOG.md`, `README.md`,
  `database/README.md`

### Database changes

One migration, `010`: `bookings.problem_description TEXT` (nullable — seeded
rows predate it — with a 3–2000 char CHECK) and
`idx_bookings_provider_status (provider_id, status, scheduled_at DESC)` for the
queue. **No new tables; the `bookings` table from `004` is reused as-is.**

### Endpoints

| Method | Path | Role |
|---|---|---|
| POST | `/api/bookings` | CUSTOMER |
| GET | `/api/bookings/my` | CUSTOMER |
| GET | `/api/bookings/:id` | CUSTOMER |
| PATCH | `/api/bookings/:id/cancel` | CUSTOMER |
| GET | `/api/provider/bookings` | PROVIDER |
| PATCH | `/api/provider/bookings/:id/status` | PROVIDER |

### State transitions

```
PENDING     → ACCEPTED | REJECTED | CANCELLED
ACCEPTED    → IN_PROGRESS | CANCELLED
IN_PROGRESS → COMPLETED
REJECTED / CANCELLED / COMPLETED → terminal
```

Customer: only `CANCELLED`, only from `PENDING`/`ACCEPTED`. Provider:
`ACCEPTED`/`REJECTED`/`IN_PROGRESS`/`COMPLETED` only. Writes are guarded
(`WHERE status = $current`) so a concurrent double-click cannot skip a state.

### Security / ownership controls

- Customer identity **always** from `req.user.id`; `customerId` in a body is
  rejected by the strict schema.
- Provider verified on every create: exists → `PROVIDER` role → `APPROVED` →
  active → not the customer. Unapproved and non-existent both return **404**.
- Service verified in one query: exists, active, **and owned by that provider**.
- `loadVisibleBooking` scopes every read/write by role in the SQL; a foreign
  booking is an indistinguishable **404**.
- Route-level `requireAuth` + `requireRole` before any handler; the provider
  status route has no customer-reachable path.
- 13 forbidden fields asserted absent from every booking payload.

### Tests — `npm test` → **81/81** (27 new, covering all 22 required scenarios)

| # | Scenario | Result |
|---|---|---|
| 1 | valid booking created (PENDING, snapshots applied) | ✅ |
| 2 | unauthenticated attempt on all 6 routes | ✅ 401 |
| 2b | wrong role on every route | ✅ 403 |
| 3 | customer lists own bookings | ✅ |
| 4 | customer cannot view another's booking | ✅ 404 |
| 5 | customer cannot cancel another's booking | ✅ 404, row untouched |
| 6 | provider sees assigned queue | ✅ |
| 7 | provider cannot see another's queue | ✅ |
| 8 | provider accepts PENDING | ✅ |
| 9 | provider rejects with reason | ✅ |
| 9b | reject without reason refused | ✅ 400 |
| 10 | provider starts ACCEPTED | ✅ |
| 11 | provider completes IN_PROGRESS | ✅ |
| 12 | invalid transitions (skip states + terminal) | ✅ 409 |
| 12b | COMPLETED→CANCELLED, IN_PROGRESS cancel refused | ✅ 409 |
| 12c | customer CAN cancel PENDING and ACCEPTED | ✅ |
| 13 | customer cannot set provider-only statuses | ✅ 400/403 |
| 14 | provider cannot touch another's booking | ✅ 404, untouched |
| 15 | inactive service | ✅ 400 |
| 16 | non-existent service | ✅ 404 |
| 17 | service of another provider | ✅ 400 |
| 18 | unapproved provider (PENDING/REJECTED/SUSPENDED) | ✅ 404 |
| 19 | self-booking refused by role **and** by the DB CHECK | ✅ |
| 20 | 13 invalid date/time/field cases | ✅ 400 |
| 21 | duplicate slot → safe 409, slot freed after cancel | ✅ |
| 22 | payload allow-list + no leak to customer B or provider B | ✅ |

**Live endpoint check:** `POST /api/bookings` → 401, `GET /api/bookings/my` →
401, `GET /api/provider/bookings` → 401, `/api/health` → 200.

### Issues encountered

1. **`before` hook failed** — `provider_profiles_check` requires `verified_by`
   whenever `verified_at` is set; the fixture set only the latter. Fixed by
   attributing verification to the seeded admin.
2. **Real bug: `missing FROM-clause entry for table "b"`** — the provider-queue
   COUNT query used the `b` alias without a JOIN. Rewritten with bare column
   names. Caught by the tests, not by review.
3. **Cross-file test interference** — booking test 19 inserted an APPROVED
   profile row that leaked into `public_providers` and broke
   `search.test.ts` (9 ≠ 8), because `node --test` runs files in parallel
   processes against one database. Two fixes, both correct: the fixture now
   deletes its row in a `finally`, and the runner uses
   `--test-concurrency=1` since these suites genuinely share one database.
4. Several line-based inserts again landed mid-statement; each file was
   truncated to its last known-good line and re-appended, verified with
   `tsc --noEmit` and a brace-depth count.

### Not done (explicitly out of scope)

Booking **frontend** — the "Book Service" CTA stays disabled until Phase 11.
No dashboards, image uploads or auth UI.

file uploads for images (URLs only), admin UI, booking flows.

---

## Step 010 — Customer booking frontend

**Status:** Complete · **Phase 11** · ADR-024 · Builds on Step 009 (ADR-023)

The provider profile's "Book Service" CTA was disabled with an honest tooltip
("Booking opens in a later phase"). It is now a real link into a working
customer booking flow, backed entirely by the endpoints that already existed.

### Routes added

| Route | Page | Endpoint |
|---|---|---|
| `/providers/:id/book` | `BookingPage` | `GET /api/providers/:id`, `POST /api/bookings` |
| `/bookings` | `MyBookingsPage` | `GET /api/bookings/my` |
| `/bookings/:id` | `BookingDetailPage` | `GET /api/bookings/:id`, `PATCH /api/bookings/:id/cancel` |

`/login` was also filled in (it was a disabled placeholder) because every
booking endpoint requires a bearer token.

### UX flow

1. Open a provider profile, click **Book a service**
2. `BookingPage` loads the public profile, then branches:
   - no session -> sign-in / create-account prompt, naming the provider
   - PROVIDER or ADMIN -> "Customer accounts only" notice
   - CUSTOMER -> the form
3. Pick a service (radio cards with name, description, price range, duration)
4. Describe the problem (3–2000 chars), pick a date and time, enter the address,
   add optional notes
5. A live "Review your request" panel mirrors the selection as it is made
6. Submit -> `POST /api/bookings` -> confirmation screen with provider, service,
   date, time, address and a PENDING badge
7. Confirmation offers **View my bookings** and **Back to provider** only — the
   form is replaced, never reset, so a refresh cannot double-book

### Authentication behaviour

The CTA is a single link for everyone; the booking page owns the decision. No
unauthenticated POST is ever attempted, so nobody gets a raw 401 after filling
in a form. Role gates are UX only and are labelled as such in the code — the
backend re-reads the role from the database and re-checks ownership on every
request. The access token is kept in `sessionStorage` (tab-scoped, dropped on
close) and attached per request; sign-out revokes the server session and clears
it locally, and still clears locally if the revoke fails.

### Form validation

Client-side only, to save a round trip; the server revalidates everything.
Mirrors the DB constraints exactly — problem 3–2000 chars, notes ≤1000,
address ≤500 — plus a not-in-the-past check, a 30-minute minimum lead time and
the one-year horizon. Errors render per field with `aria-invalid` and
`aria-describedby`, and focus moves to the first invalid control. Submission is
blocked on obvious errors, the button is disabled while in flight
("Submitting booking..."), and a second submit is ignored outright.

Dates and times are captured in the visitor's local calendar and converted to
UTC by `localSlotToUtc` before sending, because the server composes the two as
UTC. Without this a customer in UTC-3 choosing 14:00 would be stored at 14:00
UTC and shown back to them as 11:00.

### Cancellation

The cancel action is rendered only for `PENDING` and `ACCEPTED` (ADR-023).
Clicking it opens a focus-trapped confirmation dialog with an optional reason
and an Escape/click-outside dismiss. It calls `PATCH /api/bookings/:id/cancel`
with `{ reason }` and nothing else — there is no code path in the client that
can send a `status`. After success the list is **re-fetched** rather than
patched optimistically, so the badge always reflects server truth.

### Error handling

Every API-driven page covers loading, success, empty, unauthorized, forbidden,
not found, conflict and unexpected error. `ApiError` carries a status, and each
failure maps to copy written for a customer ("That time slot has just been
taken..."). No SQL, table name or stack trace is ever rendered; the server
already returns safe messages and the client adds a second filter on top.

### Responsive design

Reused the existing tokens, `.card`/`.btn` classes, shadows and Lucide icon set
— no new design system. Desktop gets two columns (form left, provider summary
and live review right, sticky). Below `lg` it collapses to one column with the
summary first. Inputs carry a 44px minimum height for touch targets, service
cards go two-up from `sm`, and the nav gains a "My bookings" link for
customers only.

### Accessibility

Native radio inputs for service selection (arrow-key navigation, announced as a
group), real `date`/`time` inputs, `<label>` on every control, `aria-invalid` +
`aria-describedby` on errors, `role="alert"` on error boxes, `aria-busy` while
submitting, visible focus rings from the existing base styles, and status
conveyed by icon **and** text rather than colour alone.

### Tests performed

Added a client test suite (the project had none), using `tsx --test` to match
the server and `react-dom/server` to avoid new dependencies.

- `client/src/tests/booking-api.test.ts` (12) — asserts what actually goes on
  the wire: no `customerId`, no `price_quote`/`duration_minutes`, cancel sends
  only `reason` and never a `status`, blank notes are omitted, 409/400/404 map
  to safe messages
- `client/src/tests/booking.test.tsx` (53) — UTC conversion round-trip and its
  rejection of impossible dates; every validation rule; service picker
  including the no-services empty state; status badges; booking card showing and
  hiding cancel; confirmation contents and its single-submit guarantee; form
  rendering with a labelled control per field and no customer-id input

**Results:** server `npm test` 81/81 (unchanged), client `npm test` 65/65,
`npm run typecheck` exit 0, `npm run build` exit 0. No existing test was
weakened; the root `npm test` now runs both suites via `--workspace`.

### Issues encountered

1. **No frontend auth existed.** Every booking endpoint needs a bearer token and
   `LoginPage` was a disabled placeholder, so a minimal real auth client
   (`lib/auth.ts`, `lib/auth-context.tsx`, a working `/login`) was required
   before any booking UI could function. Documented as ADR-024.
2. **`import.meta.env` is Vite-only** — the module threw on import under
   `tsx --test`. Fixed with an optional chain so the base URL falls back to
   `/api` outside a Vite build.
3. **esbuild's platform binary was pruned** by a workspace-scoped `npm install`.
   Restored from the workspace root.
4. **Mid-file inserts landed inside functions twice** (a missing brace in
   `booking-utils.ts`, a dropped `Gate` component), both caught immediately by
   `tsc --noEmit` rather than at runtime.

### Not done (explicitly out of scope)

Provider dashboard, admin UI, reviews UI, Phase 12. No booking backend changes
were needed — the API contract matched on first inspection.

---

## Step 011 — Customer dashboard

**Status:** Complete · **Phase 12** · ADR-025 · Builds on Step 010 (ADR-024)

Bookings were reachable, but only by navigating to `/bookings` and scrolling.
The customer dashboard is the one place that answers "is anything coming up?"
without hunting. **No booking backend code was changed** — the API contract
matched on first inspection.

### Route added

| Route | Page | Endpoint |
|---|---|---|
| `/dashboard` | `DashboardPage` | `GET /api/bookings/my` (once per visit) |

Added a "Dashboard" link to the customer navbar. Public, provider and admin
navigation is untouched.

### Data source and summary counts

One `GET /api/bookings/my` call per visit; every number is derived from it in
pure functions in `lib/booking-utils.ts`. No statistics endpoint, no per-card
request, no polling.

- **Total bookings** prefers the API's `pagination.total` over the array length.
  The endpoint caps a page at 50, so counting the array would report "50" to a
  customer who has 80. This is the one figure that cannot be computed from the
  page in hand.
- **Upcoming** = `PENDING` + `ACCEPTED` + `IN_PROGRESS`
- **Pending** = `PENDING` only
- **Completed** = `COMPLETED` only

Splitting is by **status, not by date**: a `PENDING` booking whose slot has
passed is still something the customer is waiting on and may want to cancel, so
dating it into "past" would hide the only control that helps. Upcoming sorts
soonest-first; history sorts most-recent-first. Neither list is sorted in
place, so the totals still see the original array.

### Access behaviour

| Situation | What happens |
|---|---|
| Signed out | Sign-in prompt, and **no request is made** |
| `PROVIDER` / `ADMIN` | "Customer accounts only", pointing at their own area |
| Expired session (401) | Re-authentication prompt |
| 403 / 404 | "Not available for this account" |
| Network / 500 | Error state with a manual Retry |

The role gate is UX only and is labelled as such in the code: `/bookings/my` is
already scoped to the session user, so editing the browser buys nothing.

### Sections

1. **Greeting** — "Good morning/afternoon/evening, {first name}". First name
   only, never a full legal name in large type on a shared screen.
2. **Actions** — Refresh (explicit, user-initiated) and New booking -> /providers.
3. **Summary cards** — the four counts, with an `sr-only` label after each
   numeral so a screen reader does not read four disconnected numbers. Hidden
   entirely at zero, because four zero cards read as a failure.
4. **Upcoming bookings** — the existing `BookingCard` (so each row keeps its
   View details and Cancel controls), capped at 4 with a "View all" link.
5. **Recent bookings** — a new compact row list for history, capped at 5. No
   cancel control, since none of those statuses are cancellable.
6. **Next appointment** — the soonest open booking, in the sticky side column.
7. **Account** — name, email, account type, member since. Strict allow-list.

### Cancellation

Reuses the existing `CancelBookingDialog` verbatim — there is exactly one
cancellation path in the app, and it still posts `{ reason }` and never a
`status`. After success the dashboard re-fetches rather than patching
optimistically, so the counts, the badges and the "next appointment" card all
reflect the server.

### Account data and security

`accountView()` returns exactly four fields. The `CurrentUser` object the app
holds also carries `id` and `phone`; the component never reads them, so a
customer id cannot reach the DOM — asserted by test. Nothing sensitive is
available to leak: `/api/auth/me` returns a `PublicUser` with no password hash,
session id or token, so the frontend never holds those values at all. No
profile-edit form was added: that capability does not exist, and inventing one
would be scope creep.

### Responsive design

Desktop is a `1.7fr / 1fr` grid (content left, sticky sidebar right). The
summary cards run two-up on mobile and four-up from `lg`. Upcoming bookings go
two-up from `sm`; history rows stack with the badge and link wrapping below the
text on narrow screens. Reused the existing `.card`/`.btn` classes, tokens,
shadows, Lucide icons and the existing focus-ring styles — no new UI library.

### Date/time handling

All times go through the existing `formatDateTime`, the same helper the booking
detail page uses, so the dashboard cannot display a slot differently from the
detail view. No second conversion system was introduced, and no stored booking
time is transformed on the way out.

### Tests performed

`client/src/tests/dashboard.test.tsx` (31 tests):
- `partitionBookings` — each status lands in the right bucket; soonest-first
  and most-recent-first ordering; a past-dated `PENDING` stays upcoming; the
  input array is not mutated
- `summariseBookings` — a mixed 8-booking history produces the right four
  numbers; a capped 50-row page with `total: 80` reports 80
- `nextAppointment`, `greetingFor`, `firstNameOf`
- `accountView` — exactly four keys, and neither the id nor the phone is present
- `SummaryCards` — all four labels render with sr-only companions; nothing
  renders for an empty history
- `AccountCard` — shows name/email/role; the customer id, the phone, and any
  password/token/session/hash string are absent from the DOM
- `RecentBookings` — rows link to details, show status badges, offer **no**
  cancel action, and show an empty state
- list limits cap the rendered rows while keeping the data intact

**Results:** server `npm test` **81/81** (unchanged baseline), client
**96/96** (65 baseline + 31 new), `npm run typecheck` exit 0, `npm run build`
exit 0. No existing test was weakened or modified.

### Issues encountered

1. **A bulk edit removed `maxBookableDate`** from `booking-utils.ts` while adding
   the dashboard helpers. Caught by `tsc --noEmit` on the next run and restored.
2. **A duplicate type import** in the same file (`Booking`, `CurrentUser`
   imported twice) — `tsc` caught it; removed the redundant line.
3. **Shell output capture intermittently returned nothing** for long test runs,
   so results were re-verified by writing to a file and reading the exit code
   explicitly. Test outcomes were confirmed, not assumed.

### Not done (explicitly out of scope)

Provider dashboard, admin dashboard, reviews UI, profile editing. Phase 13 not
started.

---

## Step 012 — Provider dashboard

**Status:** Complete · **Phase 13** · ADR-026 · Builds on Step 011 (ADR-025)

Providers had a real booking API and no way to use it from a browser. This phase
adds the provider-only queue. **No booking backend code was changed** — the API
contracts were read from the server and implemented exactly as found.

### Route added

| Route | Page | Endpoints |
|---|---|---|
| `/provider/dashboard` | `ProviderDashboardPage` | `GET /api/providers/me`, `GET /api/provider/bookings`, `PATCH /api/provider/bookings/:id/status` |

The provider navbar now shows **Bookings** and **My profile**. Customer
navigation (Dashboard / Find a pro / My bookings) and public navigation are
unchanged; admin keeps the public nav.

### Access behaviour

| Situation | What happens |
|---|---|
| Signed out | Sign-in prompt, and **no provider request is made** |
| `CUSTOMER` | "Provider accounts only", link to their own dashboard |
| `ADMIN` | Same gate, link to home |
| 401 | Re-authentication prompt |
| 403 / 404 | Profile-unavailable notice |
| Network / 500 | Error state with a manual Retry |

The gate is UX only. `requireRole('PROVIDER')` and the ownership check inside
`loadVisibleBooking` are the real boundary.

### Verification states

Read from `ProviderProfileDto.verificationStatus` via `GET /api/providers/me`:

- **PENDING** — "Awaiting verification", explicitly says customers cannot find or
  book them yet, and that requests will appear once approved
- **APPROVED** — short positive confirmation
- **REJECTED** — states the fact and points at support
- **SUSPENDED** — states the fact and points at support

**No reasons are invented.** The API exposes no rejection or suspension reason
to the provider, so the banner does not state one; a test asserts no fabricated
cause ("because…", "due to…", "violation…") appears in the output.

### Booking status workflow

`PROVIDER_TRANSITIONS` mirrors the server's `BOOKING_TRANSITIONS` with
`CANCELLED` removed. A button is rendered only for the transition that map
allows from the current status:

| From | Offered action | Sends |
|---|---|---|
| `PENDING` | Accept / Reject | `{ status: 'ACCEPTED' }` / `{ status: 'REJECTED', reason }` |
| `ACCEPTED` | Start service | `{ status: 'IN_PROGRESS' }` |
| `IN_PROGRESS` | Mark completed | `{ status: 'COMPLETED' }` |
| `REJECTED` / `CANCELLED` / `COMPLETED` | *nothing* | — |

So `PENDING -> IN_PROGRESS`, `PENDING -> COMPLETED`, `REJECTED -> COMPLETED` and
`CANCELLED -> ACCEPTED` are not rendered at all, and no provider path can send
`CANCELLED` (a provider does not cancel — the customer does). Rejecting opens a
dialog that **cannot submit without a reason**, because the server's
`providerStatusSchema` requires one and a DB CHECK backs it.

After every successful action the queue is **re-fetched**, never patched, so a
card never shows a status the server did not actually store. A `busy` flag is
checked before the request so a double-click cannot fire two PATCHes.

### Customer information shown

Strict allow-list, and **no request is made to widen it**: counterparty display
name, service address, problem description, customer notes, requested date/time
and service. That is exactly what `BookingDto` carries. The DTO has no customer
email, phone, customer id, password hash, session id or token, so the frontend
never holds them; a test asserts none of those strings appear in the rendered
card. The customer booking endpoints are not used as an information source.

### Counts, filtering, sorting

- One `GET /api/provider/bookings` per visit (max page size). The `?status=`
  server filter is deliberately **not** used — the whole queue is in memory, so
  a request per tab click would be wasted.
- Seven summary cards: Pending requests, Accepted, In progress, Completed,
  Rejected, Cancelled by customer, Total bookings. They render at zero (unlike
  the customer dashboard) because a provider with an empty queue should see
  explicit zeros, not a blank area.
- "Total bookings" uses the server's `pagination.total`, so a capped page cannot
  under-report.
- Seven status tabs (All/Pending/Accepted/In progress/Completed/Rejected/
  Cancelled) filter in memory; each shows its count.
- Sort order: `PENDING` -> `ACCEPTED` -> `IN_PROGRESS` -> closed work, newest
  activity first within each group. Pure — the API response array is not
  mutated, and a test asserts it.

### Empty states

- No bookings at all (and approved) — onboarding message pointing at the public
  profile. No fake bookings.
- No pending requests — "No pending booking requests", explaining that new
  requests will appear as they arrive.
- A filter with no matches — "No bookings match this filter".

### Responsive design

Summary cards run two-up on mobile, four-up from `lg`; the queue is one column
until `xl`, then two. Long addresses and problem descriptions use
`break-words` + `whitespace-pre-wrap` so nothing overflows horizontally. Action
buttons are `min-h-10` with `flex-wrap`, so they stay tappable and wrap rather
than shrinking on narrow screens. Reused the existing `.card`/`.btn` classes,
tokens, shadows, `BookingStatusBadge`, `LoadingState`/`ErrorState` and Lucide
icons — no new UI library.

### Tests performed

`client/src/tests/provider-api.test.ts` (13) — **wire-level contract**:
- accept sends exactly `{ status: 'ACCEPTED' }`
- start sends `{ status: 'IN_PROGRESS' }`; complete sends `{ status: 'COMPLETED' }`
- reject sends the **mandatory** `reason`, trimmed
- an empty reason is omitted rather than sent as `''`
- **no** `providerId` / `userId` / `customerId` / `bookingId` ever appears in the
  body
- the list call never sends `?status=`
- 403/404/409 surface as `ApiError` without leaking internals

`client/src/tests/provider-dashboard.test.tsx` (37):
- the transition table: exactly three legal moves, `CANCELLED` never a target,
  every terminal status has no action, and the forbidden shortcuts are absent
- `requiresReason` true only for REJECTED; `validateReason` bounds
- counts across a mixed queue, and the server-total preference
- sort ordering plus non-mutation of the input array
- filtering, and the seven documented tabs
- the card shows service/customer/address/problem/notes
- Accept+Reject only for PENDING, **only** Start service for ACCEPTED, **only**
  Mark completed for IN_PROGRESS, and **zero buttons** for terminal statuses
- no Cancel control anywhere; spinner + `disabled` while in flight
- no password/token/session/hash/email string in the rendered card
- summary cards show all seven labels and render at zero
- each verification state renders, and REJECTED/SUSPENDED contain no invented
  reason

**Results:** server `npm test` **81/81** (baseline preserved), client
**146/146** (96 baseline + 50 new), `npm run typecheck` exit 0, `npm run build`
exit 0. No existing test was weakened or modified.

### Issues encountered

1. **A bulk edit truncated the header of the existing `booking-api.test.ts`**
   (the customer contract tests) when I intended to add a new file. Detected by
   the test run, fully restored from the known-good content, and re-verified —
   the 96-test baseline passes unchanged.
2. **A line-based insert split a `describe` block** in the new provider API test
   file, leaving an orphaned test body and causing cascading "did not finish"
   failures. Repaired by restoring the block boundary; found by running the
   tests, not by reading.
3. **A PowerShell-written `.tsx` picked up a UTF-8 BOM**, which made subsequent
   text edits fail to match. Stripped explicitly and the file re-written without
   a BOM.
4. Two unused imports (`Loader2`, `Wrench`) left over from a restructure in the
   dashboard page were caught by `tsc --noEmit` and removed.

### Not done (explicitly out of scope)

Admin dashboard, reviews UI, provider profile/service **editor** (the APIs exist;
the editing UI is a separate phase — the dashboard links to the public profile),
pagination UI for queues over 50 items. Phase 14 not started.

---

## Step 013 — Admin dashboard and provider verification UI

**Status:** Complete · **Phase 14** · ADR-027 · Builds on Step 012 (ADR-026)

Provider verification existed server-side since Phase 4 but had no UI. This phase
adds the admin frontend. **No backend file was modified** — every contract below
was read from `admin.providers.routes.ts`, `admin.providers.service.ts` and
`providers.schemas.ts` before any code was written.

### Routes added

| Route | Page | Endpoints |
|---|---|---|
| `/admin/dashboard` | `AdminDashboardPage` | `GET /api/admin/providers/pending`, the three decision PATCHes |
| `/admin/providers/:id` | `AdminProviderPage` | `GET /api/admin/providers/:id`, the three decision PATCHes |

Admin navbar: **Admin dashboard** + **Browse providers**. Customer, provider and
public navigation unchanged.

### Access behaviour

| Situation | What happens |
|---|---|
| Signed out | Sign-in prompt, and **no admin request is made** |
| `CUSTOMER` | "Admin accounts only" -> their own dashboard |
| `PROVIDER` | "Admin accounts only" -> provider dashboard |
| 401 | Re-authentication prompt |
| 403 / 404 | Admin-access-required notice |
| Network / 500 | Error state with a manual Retry |

`adminRouter` applies `requireAuth` + `requireRole('ADMIN')` before any handler.
Nothing in the admin client sends an admin id — the server takes the actor from
the session, so no such field exists.

### Summary cards — only honest ones

Three cards, all derived from the pending queue: **Pending providers**,
**With experience listed**, **With a description**.

There is deliberately **no** "Approved" / "Rejected" / "Suspended" card. The
backend exposes a list endpoint for PENDING only, so those numbers would be
fabricated rather than measured, and no statistics endpoint was created to
manufacture them.

### Provider detail

`GET /api/admin/providers/:id` returns the full profile plus the owner's contact
details and the last 20 audit rows. The page renders business name, owner name
and email, phone, city, business address, service areas, years of experience,
submission date and the decision history.

### Data allow-list

`adminProviderView()` is the only bridge from the admin DTO to the UI, and it
returns a fixed 17-field shape that components accept *instead of* the DTO.
Deliberately dropped:

- **`verifiedBy`** — the acting admin's user id. The server records it for audit;
  rendering it would show one admin's identity to another.
- **`userId` as text** — carried as `id` for the route parameter only; a test
  asserts it appears in the `href` but never in the rendered copy.
- **`owner.isActive`** — an auth concern, not a review one.

`actions[].details` is reduced to a `reason` string when it is one and discarded
otherwise, so no JSON blob from the database is dumped into the page.

### Verification states and available actions

| Current status | Actions offered | Body sent |
|---|---|---|
| `PENDING` | Approve provider / Reject provider | `{}` / `{ reason }` |
| `APPROVED` | Suspend provider | `{}` or `{ reason }` |
| `REJECTED` | *none* | — |
| `SUSPENDED` | *none* | — |

**This is deliberately narrower than the server's state machine.** The service
permits approve from REJECTED/SUSPENDED and reject from SUSPENDED; the UI offers
none of those, because re-approving a rejected provider is a policy decision that
should not be one click away. The divergence is documented in ADR-027 and fails
in the safe direction — a missing button, never an unauthorised one.

There is **no status dropdown anywhere** in the admin UI. A test asserts no
`<select>` and no `name="status"` input is ever rendered.

### Approve / Reject / Suspend contracts

Read from `providers.schemas.ts`; all three are `.strict()`:

| Endpoint | Schema | Body | Required |
|---|---|---|---|
| `PATCH /:id/approve` | `approveSchema` | `{ note? }` 2–500 | optional |
| `PATCH /:id/reject` | `rejectSchema` | `{ reason }` **5**–500 | **required** |
| `PATCH /:id/suspend` | `suspendSchema` | `{ reason? }` 5–500 | optional |

The rejection minimum is **5**, not the 3 used by the booking rejection schema —
two different schemas, both read directly rather than pattern-matched from the
booking work. Approve and suspend send `{}` when there is nothing to say, because
an empty string would be a 400 under `.strict()`.

The dialog shows a reason field for reject and suspend and omits it for approve.
Rejection **cannot submit empty**; suspension may.

### State and refresh

- After a decision, the queue (or detail) is **re-fetched**, never patched. A
  card never shows a status the server did not store, and a provider leaves the
  queue only because the server removed it.
- A `busy` guard is checked before the request, so a double-click cannot fire
  two PATCHes. Buttons show "Working...", are disabled, and carry `aria-busy`.
- **409 handling**: the server answers a no-op transition with 409 when two
  admins race. That is not an error to shout about — the page explains it in
  plain language and re-reads, so the second admin immediately sees the truth.
- 400/401/403/404/500 each map to their own copy. No SQL, table name or raw
  server text is ever shown.

### Empty and loading states

Clear-queue state ("Queue is clear"), per-card loading, page-level error with
retry, and a manual **Refresh** button. No polling, no auto-refresh timer.

### Responsive design and accessibility

Queue is one column, two from `md`, three from `xl`. Long business names,
addresses, descriptions and service areas use `break-words` /
`whitespace-pre-wrap`, so nothing overflows horizontally. Decision buttons are
`min-h-10`/`min-h-11` and wrap. Status is carried by an **icon plus a text
label**, never colour alone. Dialogs take focus on open, close on Escape and on
click-outside, and the textarea wires `aria-invalid` / `aria-describedby` to its
error. Reused the existing `.card`/`.btn` classes, tokens, shadows and Lucide
icons — distinct by layout and hierarchy, not by a new theme.

### Tests performed

`client/src/tests/admin-api.test.ts` (25) — **wire-level contract**:
- approve sends exactly `{}`; a supplied note is trimmed and included
- reject sends exactly `{ reason }`, trimmed — no status, no admin id
- suspend sends `{}` with no reason, `{ reason }` with one
- **no** `adminId` / `admin_id` / `verifiedBy` / `userId` / `providerId` ever
  appears in a body
- 400/401/403/404/409/500 all surface as `ApiError`; a deliberately
  DB-flavoured server message is not what the user is shown
- the pending list and the detail endpoint GET the right URLs

`client/src/tests/admin-dashboard.test.tsx` (34):
- `ADMIN_ACTIONS`: PENDING gets Approve+Reject, APPROVED gets only Suspend,
  REJECTED and SUSPENDED get nothing; `PENDING` and `CANCELLED` are never targets
- `validateAdminReason`: required vs optional, the 5-char minimum, the 500 max
- `adminProviderView`: exactly the allow-listed keys, **no `verifiedBy`**, **no
  `isActive`**, `serviceAreas` copied not aliased
- `auditEntries`: `details` reduced to a reason; a non-reason blob discarded
- `queueSummary`: derived counts, and a blank description is not counted
- `DecisionButtons`: exact button counts per status, none for terminal ones, no
  `<select>`/`name="status"`, both buttons disabled while busy
- `ProviderReviewCard`: renders what a reviewer needs, links with the id, and
  the id is absent from visible text; **no** `verifiedBy`, password, token,
  session, hash or `isActive` anywhere in the markup

**Results:** server `npm test` **81/81** (baseline preserved), client
**205/205** (146 baseline + 59 new), `npm run typecheck` exit 0, `npm run build`
exit 0. No existing test was weakened or modified.

### Issues encountered

1. **A card was written with a placeholder `href`** (`/admin/providers/${... ? '' : ''}`)
   while I was still deciding how the id should reach the detail page. Fixed
   properly by adding `id` to the view model with a comment that it is a route
   parameter only, plus a test asserting it is not printed as text.
2. **A missing `id` in the view model was a real design gap**, not just a
   compile error: the review card cannot link anywhere without it. Resolved by
   making it an explicit, documented field rather than reintroducing the raw DTO.
3. **A PowerShell-written `.tsx` picked up a UTF-8 BOM** again, breaking text
   edits on the same line. Stripped with an explicit `TrimStart([char]0xFEFF)`.
4. One unused import (`ADMIN_REASON_MIN` in `DecisionDialog.tsx`) caught by
   `tsc --noEmit` and removed.

### Not done (explicitly out of scope)

Reviews UI, any backend change, approved/rejected/suspended list endpoints or
tabs, provider service management UI. Phase 15 not started.

---

## Step 014 — Reviews and ratings

**Status:** Complete · **Phase 15** · ADR-028 · Builds on Step 013 (ADR-027)

Reviews were the last major customer feature. The brief said to inspect the
database first and reuse what exists — and the `reviews` table from migration 004
already encoded most of the rule set. **No migration was created, and no server
file was modified beyond the new module and its tests.**

### What already existed (and was left alone)

- `reviews` table with `booking_id ... UNIQUE`, `CHECK (rating BETWEEN 1 AND 5)`,
  `CHECK (comment IS NULL OR length(trim(comment)) <= 2000)`, `CHECK (customer_id
  <> provider_id)`, and **composite foreign keys** `(booking_id, customer_id)` and
  `(booking_id, provider_id)` against `bookings`
- `GET /api/providers/:id` returning anonymous `PublicReviewDto` (rating, comment,
  createdAt only) plus cached `rating` / `reviewCount` columns on
  `provider_profiles`, recomputed by trigger
- The client `ReviewList` component and the profile page's Reviews section

So the real work was the **write path** and the **customer UI**.

### API routes added

| Route | Purpose |
|---|---|
| `POST /api/reviews` | Review a COMPLETED booking — CUSTOMER only |
| `GET /api/reviews/my` | The authenticated customer's own reviews — CUSTOMER only |

`requireAuth` + `requireRole('CUSTOMER')` are applied at the router, matching the
bookings module. `GET /api/providers/:id/reviews` was deliberately NOT created —
the provider profile already answers that question with a stricter privacy
contract.

### Eligibility

A review is accepted only when the booking is the caller's **and** its status is
`COMPLETED`. Everything else is refused:

| Situation | Response |
|---|---|
| Unauthenticated | 401 |
| PROVIDER / ADMIN | 403 |
| Another customer's booking | 404 (indistinguishable from unknown) |
| PENDING / ACCEPTED / IN_PROGRESS / REJECTED / CANCELLED | 409 |
| Already reviewed | 409 |
| Unknown booking id | 404 |

409 (not 403) for a not-yet-completed booking: the caller *does* own it, they
are simply early.

### Rating and comment validation

- `rating`: integer 1–5. `0`, `6`, negatives, decimals, numeric strings, `null`
  and missing are all 400.
- `comment`: optional, trimmed, max **2000** (the schema's limit, not an invented
  1000). A whitespace-only comment is stored as `NULL`. Exactly 2000 is
  accepted; 2001 is 400.
- The body is `.strict()`: `customerId`, `providerId`, `userId`, `reviewerId` and
  `customer_id` are all **rejected** with 400 rather than ignored.

### Ownership derivation

The reviewer is always `req.user.id`. The reviewed provider is always the
booking's `provider_id` — the INSERT selects both from the `bookings` row, and
the composite FKs then refuse to store a mismatched pair even if the service had
a bug.

### Duplicate protection

`booking_id ... UNIQUE` is the real guard. A test inserts a second row directly
via SQL, bypassing the API, and asserts Postgres rejects it with `23505`. A
concurrent test fires three simultaneous requests and asserts exactly one 201,
two 409s, and one row. The 409 message is checked to contain no constraint
name, "duplicate key", "unique", "relation" or `pg_`.

### Public behaviour

The provider profile and `ReviewList` needed **no changes** — they were already
correct. Public reviews expose exactly `rating`, `comment`, `createdAt`; a test
asserts the key set is exactly that and that no customer id, email, password,
token or booking id appears. A provider with zero reviews reports `rating: null`
(never NaN) so the UI says "New to ServiceConnect".

### Booking UI

- **Booking detail** (`/bookings/:id`): a review section renders only for a
  COMPLETED booking. No review yet -> the form. Review exists -> the stored
  rating, comment and date, read-only, and the form is gone. Anything else ->
  nothing at all.
- **Booking cards**: a "Leave a review" pill appears only on COMPLETED bookings,
  so the entry point is discoverable from the list and dashboard. No review
  state was added to the dashboard itself, per the brief.
- The form submits `{ bookingId, rating, comment? }` only; the client sends no
  customer or provider id, and a test asserts the exact wire body.

### Accessibility and design

Five native radio inputs styled as stars, in a `radiogroup` with
`aria-label="Your rating out of 5"`; each star has an `sr-only` label ("1 star" …
"5 stars"). That gives arrow-key navigation and a real form value for free.
44px touch targets, `aria-invalid`/`aria-describedby` wired to field errors,
`aria-busy` while submitting, a live character counter, and a visible
explanation that reviews are shown without the customer's name. Reused the
existing `.card`/`.btn` classes, tokens and accent star colour.

### Tests performed

**Server — `server/src/tests/reviews.test.ts` (34)**
- 401 unauthenticated, 403 for provider, 403 for provider listing
- 404 cross-customer, 404 unknown id (indistinguishable)
- 409 for PENDING / ACCEPTED / IN_PROGRESS / REJECTED / CANCELLED
- 201 for COMPLETED
- every integer 1–5 accepted; `0`, `6`, `-3`, `4.5`, `"5"`, `null`, missing all 400
- comment optional, stored, trimmed, whitespace-only -> `null`, 2000 ok, 2001 400
- duplicate -> 409 with no SQL leakage
- **database** refuses a duplicate via direct SQL insert
- **concurrent** triple submit -> exactly one review
- `/reviews/my` returns only the caller's; empty array for none; no identity leak
- public profile: rating average/count rise; review keys are exactly
  rating/comment/createdAt; no PII; zero-review provider is `null` not NaN;
  unknown provider 404; public read needs no auth

**Client — 40 new (`reviews-api.test.ts` 14 + `reviews.test.tsx` 26)**
- wire body is exactly bookingId/rating/comment; no customerId/providerId ever
- blank comment omitted; comment trimmed; 409/400/404 surface as ApiError
- `canReview` is true only for COMPLETED
- `validateReview` covers null, 0, 6, -1, 4.5, 2.1, and the 2000 boundary
- the form renders 5 radios in a radiogroup, with per-star labels, one submit
  button, and **no** customer/provider id input
- the section renders nothing for non-completed, the form for unreviewed, and
  the stored review (not the form) once reviewed
- `BookingCard` offers "Leave a review" only on COMPLETED
- public `ReviewList` zero-state, comment, no-comment note, truncation note, and
  anonymity

**Results:** server `npm test` **115/115** (81 baseline + 34 new), client
**245/245** (205 baseline + 40 new), `npm run typecheck` exit 0, `npm run build`
exit 0. No existing test was weakened or modified.

### Issues encountered

1. **Test fixture paths were wrong.** The suite's `base` already includes
   `/api`, so every path I wrote with a second `/api` prefix 404'd. Fixed by
   removing the prefix — found by reading the actual error, not by guessing.
2. **Wrong admin credentials.** I first assumed a seeded admin account.
   Registration deliberately cannot mint an ADMIN (ADR-016), so the fixture admin
   is inserted directly with a hashed password — the approach `auth.test.ts`
   already uses. Also corrected the import from `../lib/password` after a wrong
   path.
3. **Service creation needed a real category.** The service schema requires
   `categoryId` and a numeric `priceFrom`; the table is `service_categories`,
   not `categories`. Both were read from the schema and the migration rather
   than assumed.
4. **Cleanup tripped a real schema interaction.** `provider_profiles.verified_by`
   is `ON DELETE SET NULL`, so deleting the fixture admin blanked `verified_by`
   on a profile that still had a `verified_at`, violating
   `CHECK (verified_at IS NULL OR verified_by IS NOT NULL)`. The cleanup now
   deletes audit rows, then profiles, then users — with the reason recorded in a
   comment, since it will bite anyone writing a similar fixture.
5. **Leftover rows from failed runs polluted `search.test.ts`.** My earlier
   broken runs had left 17 users and 40 bookings in the shared database, which
   broke an unrelated price-sort assertion. Cleaned the residue and re-ran;
   the full suite passes. This is the same cross-file interference the booking
   phase documented, and it is why the suites share one database.
6. A PowerShell here-string replacement dropped backticks from a SQL literal and
   merged two lines; both were caught by `tsc --noEmit` and repaired.

### Not done (explicitly out of scope)

Provider replies, review moderation, editing or deleting reviews, review
filtering/search. Phase 16 not started.

---

## Step 015 — In-app notifications

**Status:** Complete · **Phase 16** · ADR-029 · Builds on Step 014 (ADR-028)

Bookings already moved through a strict state machine, but neither party was
told when something happened. This phase adds a database-backed notification
system, wired into the existing booking transitions.

### Migration

`database/migrations/011_notifications.sql` — a `notification_type` enum and a
`notifications` table. Applied successfully and is idempotent (re-running skips
it via the migration runner's checksum tracking).

| Column | Notes |
|---|---|
| `id` | UUID PK, `gen_random_uuid()` — consistent with the project |
| `user_id` | NOT NULL, `ON DELETE CASCADE` — one notification, one user |
| `type` | the `notification_type` enum, NOT NULL |
| `title` / `message` | NOT NULL, `length(trim(...))` CHECKs (1–120 / 1–300) |
| `related_booking_id` | **nullable**, FK `bookings` `ON DELETE CASCADE` |
| `read_at` | nullable; NULL = unread |
| `created_at` | NOT NULL, default `now()` |

Indexes, chosen for the actual query patterns:

- `idx_notifications_user_created (user_id, created_at DESC)` — the list query
  and its ordering
- `idx_notifications_user_unread (user_id, created_at DESC) WHERE read_at IS NULL`
  — a **partial** index, so a user with 900 read notifications still has only
  their unread rows in it
- `idx_notifications_created (created_at DESC)` — retention sweeps

`user_id` uses CASCADE (unlike `admin_action_log`, which uses RESTRICT): a
notification is meaningless once its recipient is gone, and a user must stay
deletable without leaving orphans.

### Notification types

`BOOKING_CREATED`, `BOOKING_ACCEPTED`, `BOOKING_REJECTED`, `BOOKING_CANCELLED`,
`BOOKING_IN_PROGRESS`, `BOOKING_COMPLETED`, `REVIEW_SUBMITTED` — an enum in the
database, mirrored in `server/src/shared/types.ts` and the client's types.

### API

| Route | Purpose |
|---|---|
| `GET /api/notifications` | Own list. `?page`, `?pageSize`, `?unreadOnly` (strict schema) |
| `GET /api/notifications/unread-count` | `{ count }` |
| `PATCH /api/notifications/:id/read` | Mark one read, scoped to the caller |
| `PATCH /api/notifications/read-all` | Mark all of the **caller's** read |

`requireAuth` only — not `requireRole`. Notifications are for every role, and
whether you may read your own rows has nothing to do with your role. The
scoping that matters is `req.user_id` on every query.

**There is deliberately no create endpoint.** `POST /api/notifications` is a
404. Every insert is an internal function called from booking logic, so no client
body can ever name a recipient, type, title or message.

### Events and recipients

| Event | Notified | Type |
|---|---|---|
| Booking created | customer **and** provider | `BOOKING_CREATED` x2 |
| Provider accepts | customer | `BOOKING_ACCEPTED` |
| Provider rejects | customer (message includes the provider's reason) | `BOOKING_REJECTED` |
| Customer cancels | provider | `BOOKING_CANCELLED` |
| Provider starts | customer | `BOOKING_IN_PROGRESS` |
| Provider completes | customer | `BOOKING_COMPLETED` |
| Review submitted | provider (anonymously) | `REVIEW_SUBMITTED` |

Every recipient is the booking's counterparty, resolved server-side. Admins are
never notified merely for being admins.

### Atomicity

This was the significant design decision. The booking service previously used **no
explicit transactions** — each transition was a single guarded `UPDATE`, which is
atomic in itself. Notifications made that insufficient, because a state change
and its notification are two statements that must agree.

All three transition points (`createBooking`, `cancelBooking`,
`updateBookingStatusByProvider`) plus `createReview` now wrap the write and its
notification(s) in `BEGIN`/`COMMIT`/`ROLLBACK` via `pool.connect()` — the same
pattern `admin.providers.service.ts` already uses. If the insert fails the status
change rolls back with it.

### Duplicate prevention

No uniqueness constraint was added. Every transition is a guarded
`UPDATE ... WHERE id = $1 AND status = $current`; if the guard matches nothing
the function throws 409 **before** the insert is reached. "Exactly one
notification per transition" is therefore structural. Tests assert a repeated
transition yields one notification, and that a *refused* transition leaves none
behind.

### Authorization

- Every read and write is `WHERE user_id = <session>`.
- Marking read checks and updates in ONE statement, so another user's
  notification is indistinguishable from a nonexistent one (404 either way).
- `read-all` is scoped to the caller.
- `?userId=...` in the query string is rejected by the strict schema (400).
- Tests assert a customer cannot see a provider's notifications, a provider
  cannot see a customer's, one customer cannot see another's, an admin sees none
  by default, and a cross-user mark-read returns 404 **and does not mark it**.

### Frontend

- **Navbar bell** with an unread badge (`null` at zero, plain number 1–99,
  `99+` above), an `aria-expanded` toggle and an accessible label that reads
  "none unread" at zero. Rendered on desktop and mobile.
- **Dropdown panel** (8 most recent) with click-away and Escape to close, a
  "View all" link, loading and empty states.
- **`/notifications` page** with All/Unread tabs, mark-all-as-read, loading,
  error-with-retry and empty states, and a "showing N of M" note when truncated.
- **Navigation** is built by the client from `relatedBookingId` (our own UUID).
  The API never returns a URL, so a notification cannot become an open-redirect;
  a test asserts the route always starts with `/` and is never absolute or
  protocol-relative, even for a hostile id.
- Reused the existing `.card`/`.btn` classes, tokens and Lucide icons. Unread
  state is signalled by a filled dot **and** a bold title **and** an
  sr-only "Unread" — never colour alone.

### Polling / refresh

**None.** The unread count is fetched once per session and on SPA navigation
(`location.key`); opening the panel re-reads the list. No interval, no
WebSocket, no background timer — so an idle tab costs nothing and duplicate
timers cannot accumulate.

### Tests

**Server — `server/src/tests/notifications.test.ts` (30)**: 401s for every route;
customer/provider/admin isolation; cross-user mark-read 404 and not marked;
read-all scoped to caller; idempotent mark-read (timestamp unchanged);
non-UUID id is a 400; pagination with non-overlapping pages and a true total;
newest-first ordering; unreadOnly filter; every lifecycle event notifying the
right party; rejection reason carried to the customer; review notification
anonymous; repeated transition → one notification; refused transition → none;
no credentials or contact details in any payload; `POST /notifications` is a
404.

**Client — 33 new**: wire-level (no `userId` on any request; empty PATCH bodies;
404/401 surface as `ApiError`); badge at 0/1–99/99+/NaN; route construction and
open-redirect resistance; tones; relative times; row renders title/message/time,
carries `(Unread)`/`(Read)` for assistive tech, is a real button, and renders no
link when there is no route.

**Results:** server **145/145** (115 baseline + 30), client **278/278**
(245 baseline + 33), `npm run typecheck` exit 0, `npm run build` exit 0.
No existing test was weakened or modified.

### Issues encountered

1. **A migration edit overwrote `010_booking_problem_description.sql`.** Caught
   by the runner's checksum guard, which refused to proceed — that mechanism
   working exactly as designed. Restored, then verified the SHA-256 **matched**
   the recorded value. Finding the original line endings (CRLF) mattered: the
   LF version had a different checksum.
2. **A BOM in the new migration** broke the first `npm run migrate` with a
   syntax error near the invisible character. Stripped and re-applied.
3. **Line-based `ArrayList.Insert` prepended instead of appending**, reversing
   a restored comment block and inverting file order. Repaired by iterating the
   array backwards.
4. **Widespread UTF-8 mojibake.** Several PowerShell writes double-encoded
   non-ASCII characters, corrupting em-dashes and ellipses across ~15 client
   files — including in a string the booking tests assert on. Caught by three
   test failures, repaired by reversing the cp1252 round-trip, and verified at
   **0 remaining occurrences** across both `src` trees.
5. Several `Insert`-into-file edits split a comment header from its block; each
   was caught by `tsc --noEmit` and repaired. One such split briefly truncated
   `reviews.service.ts`, which was rebuilt from its known-good structure.
6. An ad-hoc smoke script failed on its own fixture (the admin it created could
   not authenticate, so the provider was never approved). Rather than debug the
   throwaway script, the same flow is covered by the 30 automated tests, which
   pass. Database residue verified at **0** afterwards.

### Not done (explicitly out of scope)

Email/SMS/push delivery, WebSockets, notification preferences or muting,
provider replies. Phase 17 not started.

---

## Step 016 — Production readiness, UX polish and security audit

**Status:** Complete · **Phase 17** · No new ADR required (see "Why no ADR")

A hardening phase: audit first, then fix only what was actually wrong. Three real
defects were found and fixed; the rest of the app was verified rather than
rewritten.

### Audit areas checked

Route guards · role matrix (every route x every role) · ownership derivation ·
sensitive-data exposure · authentication (login, revocation, malformed/expired
tokens, inactive users) · booking and review and notification and admin
authorization · API error shape · frontend loading/error/empty states ·
accessibility (labels, alt text, icon-only buttons, live regions) · navigation by
role · DTO allow-lists · migrations and checksums · seed idempotency · test
quality.

### Method

Static reading found the guards ambiguous (most routes use `...customerOnly`
spreads), so the matrix was verified **empirically** — every route was called as
anonymous, customer, provider and admin, and the observed status codes were
checked against intent. That table is now a permanent test.

### Findings and fixes

**1. Duplicate notification request (my own bug, from Phase 16).**
The navbar mounted `<NotificationBellWithPanel>` twice — once in the desktop
block, once in the mobile block — so every signed-in page view issued **two
identical `GET /api/notifications/unread-count` calls**. The bell is now rendered
once, outside the `md:` breakpoint split; only the links and account controls
still swap. A test reads the Navbar source and asserts exactly one mount and
that it sits before the breakpoint blocks, so it cannot creep back.

**2. `role="alert"` used for success messages.** `Alert` applied an assertive
alert to both variants, so "Provider approved successfully." interrupted a screen
reader mid-sentence. Errors are now `role="alert"` + `aria-live="assertive"`; the
informational variant is `role="status"` + `aria-live="polite"` and carries a
different icon, so the distinction is not colour-only.

**3. Loading state was silent.** `LoadingState` had `aria-busy` (which is not
announced) and no live region, so a screen-reader user got a spinner with no
explanation. It is now `role="status"` + `aria-live="polite"` with the label
announced.

**4. Latent open-redirect in the notification route (hardened).**
`notificationRoute` interpolated `relatedBookingId` into a path segment after
only checking it was non-null. React Router treats `/bookings/<anything>` as an
in-app path today, so this was **not currently exploitable** — but that safety is
incidental to the router's behaviour, not a property of the code. It now requires
a UUID and returns `null` otherwise, so a hostile value produces no navigation at
all. The Phase 16 test that asserted "a hostile id is contained" was **replaced
by a stronger one** (it must now produce no route), and its fixture was corrected
to a real UUID rather than the placeholder `b1`.

**5. Dead code.** `useCustomer` was exported in Phase 11 and never used. Removed.

### Verified clean (no change needed)

- **Authorization.** Every route x role behaves as intended. Customer-only,
  provider-only and admin-only routes all answer **403** (not 401) to an
  authenticated wrong-role caller. Public routes are open to all. Notifications
  are deliberately shared across roles but scoped to `req.user.id` — documented
  in ADR-029.
- **Ownership.** All customer/provider/admin identity comes from the session.
  No `customerId`/`providerId`/`adminId`/`reviewerId` is ever read from a body;
  schemas are `.strict()` and reject them.
- **Authentication.** Generic invalid-credentials message; a deactivated account
  cannot log in **and** cannot use a token it already holds; logout revokes
  immediately; malformed, unsigned, empty and garbage tokens all 401; `/auth/me`
  reads the user fresh from the database.
- **Data leakage.** Zero `SELECT *` in the server. Public provider/profile DTOs
  exclude `verified_by`, email, phone and owner name; public reviews are exactly
  rating/comment/createdAt; notifications contain no contact details, and the
  review notification is anonymous. Error responses never carry SQL, a stack
  trace or a file path — asserted by a test that probes four error routes and
  greps for nine leak signatures.
- **Frontend states.** All 10 API-driven pages have loading, error, empty and
  success states. The three without (Home, NotFound, and a static login form)
  make no API calls.
- **Accessibility.** 0 `<img>` without `alt`; 0 icon-only buttons without an
  accessible name; star ratings are a labelled radio group; unread state is dot +
  bold + sr-only text; dialogs take focus and close on Escape.
- **Migrations.** 11 files, **11/11 SHA-256 checksums match** the recorded
  values; no applied migration was edited.
- **Seed.** Re-running `npm run seed` is a no-op ("data already present") and
  row counts were identical before and after.
- **Booking/review/notification/admin state machines** were re-read and are
  unchanged; no genuine bug was found, so nothing was modified.

### Tests added

**Server — `server/src/tests/rolematrix.test.ts` (103)**
- 26 routes x 4 roles = 104 matrix assertions (public / any-role / customer-only /
  provider-only / admin-only)
- a deactivated account cannot log in
- malformed, unsigned, empty and garbage tokens are all 401
- logout revokes the session immediately
- four error routes are grepped for nine leak signatures (SQL, stack, paths)

**Client — `client/src/tests/audit.test.tsx` (13)**
- the navbar mounts exactly one bell, positioned before the breakpoint blocks
- error vs. success live-region semantics, and that a success is not `role="alert"`
- loading state exposes its label as a live region
- five hostile `relatedBookingId` values each produce no route

Plus the strengthened notification-route test in `notifications.test.tsx`.

### Results

server **248/248** (145 baseline + 103), client **291/291** (278 baseline + 13),
`npm run typecheck` exit 0, `npm run build` exit 0. No existing test was weakened
or deleted; one was made strictly stronger.

### Known limitations (unchanged, documented not hidden)

1. **No rate limiting.** `docs/SECURITY.md` has called for it since Phase 1 and
   it is still absent. It remains the single largest production gap.
2. **Notification types are duplicated** in the Postgres enum, the server's
   `NOTIFICATION_TYPES` and the client's copy. Adding an eighth requires three
   edits; tests cover both sides but nothing enforces the third.
3. **Bookings are stored as an absolute UTC instant** with no per-customer
   timezone, so a provider in another zone sees the customer's local time.
4. **The provider's own `GET /providers/me` returns `verifiedBy`** (the
   deciding admin's user id). It is never public and the admin UI deliberately
   drops it, but the field exists in that one payload. Not worth a contract
   change on its own; noted for a future pass.
5. **No password reset, email verification or MFA** — out of scope for a college
   project, but required before real users.
6. **The error handler includes `detail` when `NODE_ENV !== 'production'`.**
   Intentional developer convenience; it must never run with that env in
   production.

### Why no ADR

No architectural decision was made. The four fixes are corrections to existing
decisions (ADR-029's notification route, ADR-029's refresh strategy, and the
existing UI-component conventions), not new choices worth a numbered record. Per
the brief, an ADR was not created just to increment the number.
