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

**Test baseline:** server **248 passing**, client **291 passing**, typecheck and
production build clean.

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
git clone <your-repo-url> serviceconnect
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
│       ├── tests/                   # 291 tests
│       └── types/                   # shared TS types (mirror the API)
├── server/                          # Express API
│   └── src/
│       ├── app.ts                   # app assembly (helmet, cors, routers)
│       ├── db/                      # migration + seed runners
│       ├── middleware/              # requireAuth, requireRole, errorHandler
│       ├── modules/                 # auth, providers, bookings, reviews,
│       │                            # notifications, admin, health
│       ├── shared/                  # HttpError, enums, transition table
│       └── tests/                   # 248 tests
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
| `GET` | `/providers/:id` | Public profile — APPROVED only. Gallery, services, price range, rating, anonymous reviews. Unapproved or unknown id → 404 |

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
| `GET` | `/provider/bookings` | My job queue |
| `PATCH` | `/provider/bookings/:id/status` | `{ status, reason? }` — reason required to reject |

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
npm test              # 248 server + 291 client
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
