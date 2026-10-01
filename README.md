# ServiceConnect

A local **service discovery and booking marketplace** — customers find and book nearby service providers (plumbers, mechanics, electricians, carpenters, painters, cleaners, appliance repair, interior designers, …).

> **Status: scaffolding stage.** This repository currently contains the project skeleton only (folder structure, docs, configuration, health endpoint, landing page). Features are being added incrementally — see [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md). Authentication is **not** implemented yet.

## Roles

| Role | Capabilities |
|------|--------------|
| **CUSTOMER** | Search/filter providers, create and manage bookings |
| **PROVIDER** | Manage profile, services, availability, booking requests, clients |
| **ADMIN** | Manually verify providers before they become publicly visible |

All authorization is enforced **on the backend** (JWT role claims + Express middleware). Frontend role gates are UX only and are never the security boundary — see [`docs/SECURITY.md`](docs/SECURITY.md).

## Tech stack

- **Client:** React + TypeScript + Vite + Tailwind CSS + React Router + Lucide icons
- **Server:** Node.js + Express + TypeScript (strict mode), centralized error handling, zod-validated environment config, modular API routing
- **Database:** PostgreSQL (local dev via Docker Compose)

## Project structure

```
serviceconnect/
├── client/                   # React SPA
│   └── src/
│       ├── components/       # Navbar (responsive nav)
│       ├── pages/            # Home (landing), Providers, Login, 404
│       ├── lib/api.ts        # typed API client
│       └── types/            # shared TS types
├── server/                   # Express API
│   └── src/
│       ├── index.ts          # server entry, graceful shutdown
│       ├── app.ts            # app assembly (helmet, cors, routers)
│       ├── config/           # env validation (zod), pg pool
│       ├── middleware/       # errorHandler, requireAuth, requireRole
│       ├── modules/          # feature modules: health, auth, providers, bookings, admin
│       └── shared/           # HttpError, role types, express typings
├── database/                 # schema/migrations/seeds (planned — see database/README.md)
├── docs/                     # BUILD_LOG, AI_DECISION_LOG, SECURITY, DEPLOYMENT
├── docker-compose.yml        # local PostgreSQL 16
├── .env.example              # env var reference (no secrets)
```

## Prerequisites

- Node.js ≥ 20 (tested on Node 24)
- npm ≥ 10
- Docker (for the local PostgreSQL container)

## Setup

```bash
# 1. Install all dependencies (npm workspaces: server + client)
npm install

# 2. Create your local environment files from the templates (never commit these)
copy server\.env.example server\.env        # Windows
copy client\.env.example client\.env
# macOS/Linux: cp server/.env.example server/.env && cp client/.env.example client/.env

# 3. Start PostgreSQL (optional during scaffolding — the API boots without it)
docker compose up -d

# 4. Create the schema and load development fixtures
npm run migrate
npm run seed
```

`server/.env` must contain a strong `JWT_SECRET` (generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

## Running

```bash
# Terminal 1 — API server  →  http://localhost:4000/api/health
npm run dev:server

# Terminal 2 — client      →  http://localhost:5173
npm run dev:client
```

Other scripts (run from the repo root):

| Command | Effect |
|---------|--------|
| `npm test` | Auth & RBAC integration tests (server; needs DB + migrations) |
| `npm run migrate` | Apply `database/migrations/*.sql` (checksum-tracked, idempotent) |
| `npm run seed` | Load development fixtures (8 categories, 11 providers, …) |
| `npm run build` | Type-check + build server and client |
| `npm run typecheck` | `tsc --noEmit` for both packages |

### API endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/auth/register` | — | Create CUSTOMER or PROVIDER account (ADMIN impossible) → `201 { user, token }` |
| `POST /api/auth/login` | — | Uniform `401` on any failure → `200 { user, token, expiresIn }` |
| `POST /api/auth/logout` | Bearer | Revokes the session server-side → `200` |
| `GET /api/auth/me` | Bearer | Current user from DB → `200 { user }` |
| `GET /api/health` | — | `{"status":"ok","service":"ServiceConnect API"}` |
| `GET /api/admin/ping` | ADMIN | Example of a role-protected route (401/403 otherwise) |
| `GET /api/providers/me` | PROVIDER | Own profile + verification status |
| `PATCH /api/providers/me` | PROVIDER | Update business fields only (verification fields → 400) |
| `GET /api/admin/providers/pending` | ADMIN | Queue of PENDING profiles |
| `GET /api/admin/providers/:id` | ADMIN | Full detail + decision history |
| `PATCH /api/admin/providers/:id/approve` | ADMIN | → APPROVED (logged) |
| `PATCH /api/admin/providers/:id/reject` | ADMIN | → REJECTED, body `{ "reason": "…" }` required (logged) |
| `PATCH /api/admin/providers/:id/suspend` | ADMIN | → SUSPENDED, optional reason (logged) |
| `GET /api/providers/me/services` | PROVIDER | Own catalogue only (other providers' rows never returned) |
| `POST /api/providers/me/services` | PROVIDER | Create a service → `201 { service }` |
| `PATCH /api/providers/me/services/:id` | PROVIDER | Edit own service (foreign id → 404) |
| `DELETE /api/providers/me/services/:id` | PROVIDER | Deactivate own service (soft delete, reversible) |
| `GET /api/providers` | — | **Public search** — only APPROVED providers. Params: `keyword`, `category`, `location`, `minPrice`, `maxPrice`, `rating`, `availability`, `sort` (`rating`\|`price`\|`newest`), `order`, `page`, `pageSize` (≤50) |
| `GET /api/providers/categories` | — | Category slugs + public provider counts (for filter UI) |
| `GET /api/providers/:id` | — | **Public profile** — APPROVED only. Cover/profile image, gallery, services, price range, experience, reviews (anonymous). Unapproved or unknown id → 404 |
| `POST /api/bookings` | CUSTOMER | Create a booking request → `201 { booking }`. Body: `providerId`, `serviceId`, `date`, `time`, `problemDescription`, `address`, `notes?` |
| `GET /api/bookings/my` | CUSTOMER | My bookings (paged) |
| `GET /api/bookings/:id` | CUSTOMER | One of my bookings (another customer's → 404) |
| `PATCH /api/bookings/:id/cancel` | CUSTOMER | Cancel, body `{ "reason": "…" }` — allowed from `PENDING`/`ACCEPTED` only |
| `POST /api/reviews` | CUSTOMER | Review a **completed** booking → `201 { review }`. Body: `bookingId`, `rating` (int 1–5), `comment?` (≤2000) — reviewer and provider are derived server-side |
| `GET /api/reviews/my` | CUSTOMER | My own reviews. Public reviews of a provider come from `GET /api/providers/:id` (anonymous) |
| `GET /api/notifications` | any | My own notifications — `?page`, `?pageSize`, `?unreadOnly` |
| `GET /api/notifications/unread-count` | any | `{ count }` |
| `PATCH /api/notifications/:id/read` | owner | Mark one read (scoped to me — another user's is 404) |
| `PATCH /api/notifications/read-all` | any | Mark all of **my** notifications read |
| `GET /api/provider/bookings` | PROVIDER | My job queue; optional `?status=` |
| `PATCH /api/provider/bookings/:id/status` | PROVIDER | `{ "status": "ACCEPTED"\|"REJECTED"\|"IN_PROGRESS"\|"COMPLETED", "reason"? }` — reason required to reject |

Seed accounts share the dev password `Password123!` (scrypt-hashed — never
reused anywhere else). Details: [`database/README.md`](database/README.md).

The Vite dev server proxies `/api` to `http://localhost:4000`, so no CORS configuration is needed in development.

## Health check

```bash
curl http://localhost:4000/api/health
# {"status":"ok","service":"ServiceConnect API"}
```

## Roadmap

- [x] Step 1 — Project scaffolding, docs, health endpoint, landing page, responsive nav
- [x] Step 2 — Database schema + migrations (8 entities, constraints, seeds — see `database/`)
- [x] Step 3 — Auth: registration, login, password hashing, JWT issuance ✅ (11 tests)
- [x] Step 4 — Customer features: search/filter providers ✅; booking frontend ✅; customer dashboard ✅; **reviews & ratings ✅** (review a completed booking, anonymous public reviews) — 245 client tests
- [x] Step 5 — Provider features — **profile onboarding, `GET/PATCH /providers/me`, verification workflow done**; **provider dashboard done** (`/provider/dashboard` — queue, accept/reject/start/complete); services/availability editor UI remains
- [x] Step 6 — Admin features: provider verification workflow ✅ (pending queue, approve/reject/suspend, audit log — 8 server tests) + **admin frontend done** (`/admin/dashboard`, `/admin/providers/:id` — 205 client tests)
- [x] Step 7 — Hardening: rate limiting, tests, deployment; **in-app notifications done** (booking-event notifications, bell + `/notifications`, transactional with the state change); **Phase 17 audit done** (full route×role matrix, accessibility + live-region fixes) — 248 server / 291 client tests

## Documentation

- [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) — what was built, when, and how it was verified
- [`docs/AI_DECISION_LOG.md`](docs/AI_DECISION_LOG.md) — architecture decisions and trade-offs
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, RBAC matrix, secrets handling
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — environment variables, hosting, release checklist
#   s e r v i c e - p r o v i d e r  
 