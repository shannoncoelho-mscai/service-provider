# Deployment — ServiceConnect

**Status: scaffolding stage.** This is the target deployment model; nothing is
deployed yet. Follow the checklist at the end when the app is feature-complete.

## Architecture

```
Browser ──► Client (static SPA, CDN)
              │  VITE_API_URL = https://api.<domain>/api
              ▼
           Backend (Node/Express, stateless)
              │  DATABASE_URL
              ▼
           PostgreSQL (managed)
```

## Environment variables

Set in the hosting platform's dashboard (never in code):

| Variable | Where | Notes |
|---|---|---|
| `NODE_ENV` | server | `production` in real deployments |
| `PORT` | server | usually injected by the platform (Render/ Railway / Fly) |
| `DATABASE_URL` | server | from the managed Postgres provider |
| `JWT_SECRET` | server | ≥ 32 random chars; rotate if exposed |
| `JWT_EXPIRES_IN` | server | e.g. `1h` |
| `CORS_ORIGIN` | server | exact client origin, no trailing slash |
| `VITE_API_URL` | client (build-time) | `https://api.<domain>/api` |

Reference: `.env.example`, `server/.env.example`, `client/.env.example`.

## Build & start commands

| | Client | Server |
|---|---|---|
| Install | `npm install` | `npm install` |
| Build | `npm run build --workspace client` | `npm run build --workspace server` |
| Start | `vite preview` / serve `dist/` via CDN | `npm run start --workspace server` |
| Dev | `npm run dev:client` | `npm run dev:server` |

Notes:
- The backend builds to `dist/` with `tsc` and runs plain Node — no TS on the server.
- The frontend reads `VITE_API_URL` **at build time**; changing it requires a rebuild.
- The backend must be reachable by the frontend origin → set `CORS_ORIGIN`
  (or put both behind one reverse proxy).

## Suggested hosting (free-tier friendly)

| Tier | Candidate | Notes |
|---|---|---|
| Frontend | Vercel / Netlify / GitHub Pages | SPA rewrite rule: all paths → `index.html` |
| Backend | Render / Railway / Fly.io / Cyclic | Node 20+; keep-alive may sleep free instances |
| Database | Neon / Supabase / Aiven (PostgreSQL 16) | use the pooler connection string for serverless |

## Database release steps

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Run migrations: `npm run migrate --workspace server`
   (applies `database/migrations/*.sql`; tracked in `schema_migrations`).
3. Seed **only** development databases: `npm run seed --workspace server`
   (`-- --force` is refused when `NODE_ENV=production`).
4. Seed/insert the initial ADMIN user via a protected script — **never** expose
   an open admin-registration endpoint (TODO: auth step).

## Pre-deployment checklist

- [ ] All `TODO`s in `docs/SECURITY.md` completed (auth, rate limits, tests).
- [ ] Migrations run cleanly against an empty database.
- [ ] `npm run typecheck` and `npm run build` pass in CI.
- [ ] Automated authorization tests pass (role escalation / IDOR).
- [ ] `NODE_ENV=production`, real `JWT_SECRET`, real `CORS_ORIGIN`.
- [ ] `.env` files absent from the image/repo; secrets only in platform config.
- [ ] HTTPS enforced; HSTS enabled at the proxy/CDN.
- [ ] Health check wired to `GET /api/health` for uptime monitoring.
- [ ] Logs scrubbed of tokens/passwords; error responses show no stack traces.
- [ ] Database backups / point-in-time recovery enabled.

## Rollback

Keep the previous frontend bundle (CDN versioning makes rollback a DNS/config
flip) and redeploy the previous backend revision. Migrations must be backward
compatible for one release (expand → migrate → contract).

---

## Pre-deploy verification (Phase 17)

Run these before every release. The first two are automated and run on every
`npm test`, so CI catches a regression before it ships.

```bash
npm test          # server 248 + client 291, must be 0 failures
npm run typecheck # both workspaces, must exit 0
npm run build     # client production bundle, must exit 0
npm run migrate   # applies pending migrations; safe to re-run
```

`npm run migrate` is checksum-guarded: it refuses to run if an **already-applied**
migration file has been edited. That is intentional — if it fires, restore the
file or write a NEW migration. Never rewrite an applied one.

### Database invariants to re-check after a migration

- `reviews.booking_id` is UNIQUE (one review per booking) and the composite FKs
  on `(booking_id, customer_id)` / `(booking_id, provider_id)` still exist.
- `notifications.user_id` is still `ON DELETE CASCADE` and the partial
  `WHERE read_at IS NULL` index is still present (the unread-count query needs it).
- `bookings` still has the partial UNIQUE live-slot index (anti double-booking).

### Known gaps — do not ship to real users without them

1. **No rate limiting or login lockout.** `POST /api/auth/login` is unlimited.
   This is the single largest production risk and has been open since Phase 1.
2. **No password reset, email verification or MFA.**
3. Ensure `NODE_ENV=production` is set: the error handler includes a `detail`
   field for unknown errors outside production.
4. Access tokens live in `sessionStorage` and last 1h with server-side
   revocation (ADR-015). There is no refresh token; a user is asked to sign in
   again after an hour.

See the Phase 17 audit record in [`SECURITY.md`](SECURITY.md) for the full
findings and the outstanding list.
