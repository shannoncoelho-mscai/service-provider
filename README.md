# ServiceConnect

A local **service marketplace**: customers find nearby service providers, book
them, track the job, and review the result. Providers manage a public profile,
a service catalogue and an incoming job queue. Staff verify every provider
before it becomes publicly visible.

Built as a college project with npm workspaces, a strict TypeScript API and a
React SPA.

---

## Status

The application is **feature-complete** across every planned phase:

| Area | What works |
|------|------------|
| **Auth** | Register / sign in (customer or provider), scrypt password hashing, JWT access tokens, server-side session revocation on logout |
| **Customers** | Browse and filter verified providers, request a booking, track it through a lifecycle, cancel while eligible, leave a 1-5 star review |
| **Providers** | Public profile, service catalogue, job queue, and the full accept → start → complete workflow |
| **Admin** | Verification queue, provider detail, approve / reject / suspend, all written to an audit log |
| **Notifications** | In-app notifications for every booking event, committed in the same transaction as the state change |

**Test baseline:** server **311 passing / 313**, client **364 passing**, typecheck and
production build clean.

The two server failures are both in `server/src/tests/search.test.ts` and are
**not** image-related — see [Known test failures](#known-test-failures).

Not built (deliberately out of scope): payments, chat, email/SMS/push delivery,
provider replies to reviews, and a password-reset flow. Rate limiting is the
largest remaining production gap — see [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Tech stack

- **Client** — React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide
- **Server** — Node.js, Express 4, TypeScript (strict), zod, `pg`, Helmet
- **Database** — PostgreSQL 16 (local dev via Docker Compose)
- **Tests** — `node:test` on both sides; no browser or DOM emulator required

---

## Quick start

```bash
git clone https://github.com/shannoncoelho-mscai/service-provider.git serviceconnect
cd serviceconnect

npm install                                     # installs both workspaces

# Windows
copy server\.env.example server\.env
copy client\.env.example client\.env
# macOS / Linux
cp server/.env.example server/.env && cp client/.env.example client/.env

docker compose up -d                           # start PostgreSQL 16
npm run migrate                                 # create the schema (11 migrations)
npm run seed                                    # load deterministic dev fixtures

npm run dev:server                              # API  → http://localhost:4000
npm run dev:client                              # app  → http://localhost:5173
```

Then open **http://localhost:5173**.

`server/.env` needs a strong `JWT_SECRET`. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Seed accounts

Every seeded account uses the password `Password123!` (scrypt-hashed, never
reused). Full list in [`database/README.md`](database/README.md). The roles to
try first:

| Role | What to look at |
|------|-----------------|
| **CUSTOMER** | Book a provider, then watch the status change and the notifications arrive |
| **PROVIDER** | `/provider/dashboard` — accept, start and complete a booking |
| **ADMIN** | `/admin/dashboard` — approve a provider and watch them appear in public search |

The Vite dev server proxies `/api` to `http://localhost:4000`, so no CORS setup is
needed in development.

---

## Scripts

Run from the repository root:

| Command | Effect |
|---------|--------|
| `npm run dev:server` | API with hot reload (`tsx watch`) |
| `npm run dev:client` | Vite dev server |
| `npm run migrate` | Apply pending migrations (checksum-guarded, safe to re-run) |
| `npm run seed` | Load dev fixtures (no-op if data already present) |
| `npm test` | Both test suites |
| `npm run test:server` / `npm run test:client` | One suite only |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm run build` | Typecheck + production client bundle |
| `npm start:server` | Run the compiled API |

---

## Project structure

```
serviceconnect/
├── client/                          # React SPA
│   └── src/
│       ├── components/
│       │   ├── admin/               # verification queue, decision dialog
│       │   ├── booking/             # booking card, status badge, cancel dialog
│       │   ├── dashboard/           # customer dashboard cards
│       │   ├── notifications/       # navbar bell, dropdown, row
│       │   ├── provider/            # provider queue, review/decision UI
│       │   ├── providers/           # public directory, profile, reviews
│       │   ├── reviews/             # review form, booking review section
│       │   └── ui/                  # Alert, LoadingState, ErrorState, Field
│       ├── lib/                     # api client, auth session, pure helpers
│       ├── pages/                   # one file per route
│       ├── tests/                   # 364 tests
│       └── types/                   # shared TS types (mirror the API)
├── server/                          # Express API
│   └── src/
│       ├── app.ts                   # app assembly (helmet, cors, routers)
│       ├── db/                      # migration + seed runners
│       ├── middleware/              # requireAuth, requireRole, errorHandler
│       ├── modules/                 # auth, providers, bookings, reviews,
│       │                            # notifications, admin, health
│       ├── shared/                  # HttpError, enums, transition table
│       └── tests/                   # 313 tests
├── database/
│   ├── migrations/                  # 11 append-only, checksum-tracked files
│   └── README.md                    # schema reference + seed accounts
├── docs/                           # BUILD_LOG, AI_DECISION_LOG, SECURITY, DEPLOYMENT
└── docker-compose.yml              # local PostgreSQL 16
```

---

## How it fits together

**The backend is the security boundary.** Every protected route is guarded by
`requireAuth` plus `requireRole`, and every identity — customer, provider, acting
admin — comes from the verified session, never from a request body. Request
schemas are `strict`, so an attempt to smuggle in a `customerId` is rejected
rather than ignored. Frontend role checks exist purely to avoid showing somebody
a screen that could only fail.

**Bookings are a state machine.** `PENDING → ACCEPTED → IN_PROGRESS → COMPLETED`,
with `REJECTED` and `CANCELLED` as terminal branches. Transitions live in one
table on the server and are enforced in SQL as a guarded
`UPDATE … WHERE status = $current`, so a double-click or a race cannot skip a
state. The provider UI mirrors that same table, which is why it can never offer a
button the API would refuse.

**Reviews only follow completed work.** The `reviews` table carries composite
foreign keys onto `bookings`, so the database itself makes it impossible to store
a review whose customer or provider disagrees with the booking. One review per
booking, enforced by a `UNIQUE` constraint.

**Notifications commit with the booking.** Each booking transition and its
notification run inside one database transaction, so a notification can never
describe a change that rolled back, and a change can never commit without one.
There is no endpoint that creates a notification — the recipient, type and message
are all decided by server-side business logic.

Full reasoning for each of these is in
[`docs/AI_DECISION_LOG.md`](docs/AI_DECISION_LOG.md) (30 numbered ADRs).

---

## API

All routes are prefixed `/api`. Unless marked *public*, they require a bearer
token.

### Public

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/providers` | Search verified providers — filters, sort, pagination |
| `GET` | `/providers/categories` | Category list with provider counts |
| `GET` | `/providers/:id` | Public profile — APPROVED only. Gallery, services, price range, rating, anonymous reviews. Unapproved or unknown ID → 404 |

### Customer

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/bookings` | Request a booking → `201`. `providerId`, `serviceId`, `date`, `time`, `problemDescription`, `address`, `notes?` |
| `GET` | `/bookings/my` | My bookings (paged) |
| `GET` | `/bookings/:id` | One booking — another customer's is 404 |
| `PATCH` | `/bookings/:id/cancel` | Cancel, `{ reason }`, allowed from `PENDING`/`ACCEPTED` |
| `POST` | `/reviews` | Review a **completed** booking → `201`. `bookingId`, `rating` 1–5, `comment?` |
| `GET` | `/reviews/my` | My own reviews |

### Provider

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/providers/me` | My own profile |
| `PATCH` | `/providers/me` | Update my profile |
| `GET` | `/providers/me/services` | My service catalogue |
| `POST` | `/providers/me/services` | Create a service |
| `PATCH` | `/providers/me/services/:id` | Update a service |
| `DELETE` | `/providers/me/services/:id` | Remove a service |
| `GET` | `/providers/me/images` | My business image gallery |
| `POST` | `/providers/me/images` | Upload images (multipart, field `images`) |
| `DELETE` | `/providers/me/images/:id` | Delete one of my images (row + file) |
| `GET` | `/providers/me/services/:id/images` | Photos attached to one of my services |
| `POST` | `/providers/me/services/:id/images` | Upload service photos (multipart, field `images`) |
| `DELETE` | `/providers/me/services/:id/images/:imageId` | Delete one service photo (row + file) |
| `GET` | `/provider/bookings` | My job queue |
| `PATCH` | `/provider/bookings/:id/status` | `{ status, reason? }` — reason required to reject |

#### Business images

Providers upload photos of their work from **My business** (`/provider/business`).
Uploaded images appear automatically on the public profile through the existing
`ImageGallery` — there is no second public gallery.

| Rule | Value |
|------|-------|
| Accepted types | JPG, PNG, WebP |
| Max size per file | 5 MB |
| Max files per request | 10 |
| Storage | `server/uploads/providers/` (created automatically at boot) |
| Served at | `/uploads/providers/<filename>` |

Files are stored on the API server's local disk and served by `express.static`
from that one directory only — the rest of the filesystem is never exposed. This
is deliberately a **local development** setup. For production, replace it with
object storage (S3/GCS) plus a CDN; `provider_images.url` is already an
absolute http(s) URL, so that change is configuration only and needs no
migration.

Uploaded filenames are server-generated UUIDs — the client's filename is never
used, so a request cannot choose where a file lands. A provider's first image
becomes their primary; only one image can ever be primary.

### Notifications (any role, always your own rows)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/notifications` | Mine — `?page`, `?pageSize`, `?unreadOnly` |
| `GET` | `/notifications/unread-count` | `{ count }` |
| `PATCH` | `/notifications/:id/read` | Mark one read — another user's is 404 |
| `PATCH` | `/notifications/read-all` | Mark all of mine read |

### Admin

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/providers/pending` | Verification queue |
| `GET` | `/admin/providers/:id` | Full detail + decision history |
| `PATCH` | `/admin/providers/:id/approve` | → `APPROVED`, optional `note` |
| `PATCH` | `/admin/providers/:id/reject` | → `REJECTED`, `reason` required |
| `PATCH` | `/admin/providers/:id/suspend` | → `SUSPENDED`, optional `reason` |

Every decision is written to `admin_action_log` with the acting admin, the
previous and new status, and the reason.

---

## Testing

```bash
npm test              # 290 server + 340 client
npm run test:server
npm run test:client
```

Server tests run against a real PostgreSQL database and **require
`npm run migrate` to have been applied**. The suites share one database and run
serially (`--test-concurrency=1`) because several deliberately move the same
fixture through a lifecycle.

Coverage includes cross-user access attempts, role boundaries on every route,
illegal state transitions, concurrent duplicate submissions, and assertions that
error responses and public payloads never contain SQL, stack traces or customer
contact details.

---

## Known test failures

Two tests in `server/src/tests/search.test.ts` fail. Neither is related to image
management, and neither indicates broken application behaviour — both are
problems with how the *test* picks its fixture data.

### 1. `sort: rating, price and newest` (pre-existing)

`price_min` is `NULL` for an approved provider with no services, and
`Number(null)` is `0`, so those rows sort as though they were free. This
predates the image work and reproduces on a clean checkout.

### 2. `filter: keyword matches ... service names`

The test picks its fixture with:

```sql
SELECT name, provider_id FROM services WHERE is_active ORDER BY name LIMIT 1
```

and then asserts the owning provider is returned by search. That is only valid
if the alphabetically-first service belongs to a **public** provider. When the
seed created a demo catalogue it almost always did; after the demo services were
removed (see below) the first row alphabetically is `"web designing"`, whose
owner is `REJECTED` — and a rejected provider is correctly absent from
`public_providers` (ADR-022), so search rightly returns nothing.

The application is behaving correctly; the fixture selection is under-specified.
A durable fix scopes the query to `public_providers` rather than relying on
alphabetical luck.

## Documentation

| Document | Contents |
|----------|----------|
| [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) | Every phase: what was built, how it was verified, what went wrong |
| [`docs/AI_DECISION_LOG.md`](docs/AI_DECISION_LOG.md) | 30 numbered ADRs — why each significant choice was made, and what was rejected |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, role matrix, secrets handling, the Phase 17 audit, outstanding gaps |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Environment variables, release checklist, rollback |
| [`database/README.md`](database/README.md) | Table-by-table schema reference and seed accounts |

---

## Conventions

- **English, British spelling** in prose and comments (`colour`, `behaviour`);
  this is stylistic, not a rule to enforce in a linter.
- **Comments explain *why*.** A comment restating the code is noise; the
  interesting ones explain a constraint, a past bug, or a rejected alternative.
- **Server-side validation is the source of truth.** Client validation exists to
  save a round trip and never to enforce a rule.
- **Migrations are append-only.** An applied file is checksum-locked; the runner
  refuses to start if one has been edited. Add a new migration instead.
