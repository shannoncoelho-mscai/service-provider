# Security ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ServiceConnect

**Status: scaffolding stage.** Not production-ready yet. This document records
the threat model, the controls that already exist, and the ones still to be
implemented. Items marked `TODO` must land before any real deployment.

## Principles

1. **The backend is the security boundary.** Every permission check that matters
   happens in Express middleware/handlers. Frontend guards (hiding buttons,
   redirecting routes) are UX only and can be bypassed with `curl`.
2. **No secrets in source code.** All secrets come from environment variables,
   validated at boot; `.env*` files are git-ignored; only `.env.example`
   templates (with placeholder values) are committed.
3. **Fail closed.** Unknown roles ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ deny. Missing/invalid token ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ 401.
   Invalid env config ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ process refuses to start.
4. **Least privilege.** A route declares the minimum roles it accepts.
5. **Validate everything twice** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â zod schemas at the boundary (request body /
   params / env), and SQL parameters everywhere.

## Role & permission matrix (target state)

| Capability | CUSTOMER | PROVIDER | ADMIN |
|---|:---:|:---:|:---:|
| Browse/search verified providers | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Register / login | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ (bootstrap) |
| Create & manage own bookings | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Manage own profile / services / availability | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Accept/reject booking requests (own) | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| View own clients | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Approve/reject provider verification | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Ban/suspend users, platform stats | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |
| Edit another user's data | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã‚ÂÃ…â€™ | ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ |

Enforcement: `requireAuth` + `requireRole(...)` on every mutating route;
ownership checks (`booking.userId === req.user.id`) in services. Adding a route
without a role gate is a bug.

## Controls already implemented (scaffolding + Steps 003ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“004)

- **Registration/login/logout/me** (`/api/auth/*`): zod-validated input;
  `ADMIN` role impossible via public registration; provider sign-ups start
  `PENDING`.
- **Provider onboarding & verification (Step 005):** self-service
  `GET/PATCH /api/providers/me` uses a strict schema + column whitelist ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
  verification fields and foreign ids are rejected (400); admin-only
  `/api/admin/providers/*` decides status with a FOR-UPDATE state machine;
  every decision writes `admin_action_log` **in the same transaction**;
  providers can never approve themselves (middleware 403 + tests).
- **Password storage:** scrypt hashes only (`server/src/lib/password.ts`,
  ADR-011) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â DB `CHECK` rejects short/absent hashes; zero plaintext rows.
- **Password *verification*: uniform generic 401 + dummy-hash timing
  equalization** on login (ADR-016) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no user enumeration by message or timing.
- **Token expiry + real logout:** JWTs (`JWT_EXPIRES_IN`, default 1h) backed by
  `auth_sessions` rows; logout revokes server-side; expired sessions purged
  (ADR-015).
- **`requireAuth` is the only identity boundary:** signature ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ session ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢
  active user ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ **role from DB**, never from the frontend/token claim.
- **`requireRole`:** 401 unauthenticated / 403 wrong role ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `/api/admin/*`
  requires ADMIN (verified by tests for customer, provider, admin).
- **Database constraints as security:** role/verification/booking values are
  PostgreSQL enums; "only APPROVED providers are public" is enforced by the
  `public_providers` view + generated `is_public` column + partial index;
  audit rows (`admin_action_log.admin_id`) use `ON DELETE RESTRICT` so history
  cannot be erased by deleting a user.
- `helmet` security headers; CORS restricted to `CORS_ORIGIN`.
- Centralized error handler ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â internal errors return a generic message;
  stack traces/detail are never leaked in `production`.
- zod env validation: server exits on missing/weak configuration
  (`JWT_SECRET` must be ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥ 32 chars).
- Parameterized SQL from day one (no string concatenation).
- `.gitignore` blocks `.env*` (except templates).

## TODO before launch

- [x] Password hashing for **storage**: scrypt via `server/src/lib/password.ts`
      (ADR-011) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no MD5/SHA, no plaintext. Hash-format CHECK in the DB.
- [x] Login/registration endpoints with uniform error messages ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â implemented
      Step 004: generic `401 "Invalid email or password"` for every login
      failure + dummy-hash timing equalization (ADR-016).
- [ ] Rate limiting on auth endpoints (`express-rate-limit`) + login lockout ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
      the main remaining mitigation for registration enumeration (ADR-016).
- [ ] Refresh-token / longer session strategy once the SPA auth UI exists;
      today: 1h access token + server-side revocation (ADR-015).
- [ ] Rate limiting on auth endpoints (`express-rate-limit`) + login lockout.
- [ ] Refresh-token or short-lived access-token strategy; logout/revocation plan.
- [ ] Input validation (zod) on every request body/params.
- [ ] SQL injection review of all queries; least-privilege DB role.
- [ ] IDOR tests: cross-user access, role escalation, IDOR on `bookingId`/`providerId` (automated).
      -- *Done (Phase 17 audit).* Covered for the service catalogue (ADR-020),
      public search (ADR-021), bookings (ADR-023), reviews (ADR-028), notifications
      (ADR-029) and provider verification (ADR-019). See
      `server/src/tests/rolematrix.test.ts`, which asserts a full route x role
      matrix and runs on every test invocation.
- [ ] File-upload restrictions if provider media is added (type/size scanning).
- [ ] Dependency auditing in CI (`npm audit --audit-level=high`).
- [ ] Security headers review & CSP once the frontend bundle shape is final.
- [ ] Admin action audit log (who approved which provider, when).

## Reporting

For a college project, report findings in the repository issue tracker. Treat
any committed secret as compromised: rotate it, then scrub history.

---

## Phase 17 audit record (Step 016)

A full read-only audit was performed before any change. The route x role matrix
was verified **empirically** (every route called as anonymous, customer,
provider and admin) rather than by reading code, because most routes apply their
guard through a `...customerOnly` spread that static review gets wrong.

**Result: no authorization, ownership or data-leakage defects were found.** Every
route behaves as documented; wrong-role callers get 403, not 401; public routes
are open; notifications are shared across roles but scoped to `req.user.id`.

Three genuine defects were found and fixed, all introduced by earlier phases:

| # | Defect | Fix |
|---|---|---|
| 1 | Navbar mounted the notification bell **twice** (desktop + mobile blocks), issuing a duplicate `unread-count` request on every page view | Render one bell outside the `md:` split; test reads the source and asserts it |
| 2 | `Alert` used `role="alert"` (assertive) for **success** messages, interrupting screen readers | Errors stay `alert`/assertive; info becomes `status`/polite with a different icon |
| 3 | `LoadingState` had `aria-busy` only â€” **not announced**, so a screen reader got a silent spinner | Added `role="status"` + `aria-live="polite"` |

A fourth item was hardened rather than fixed: `notificationRoute` interpolated
`relatedBookingId` into a path after only a null check. React Router contains
this today, so it was **not exploitable**, but that safety is incidental to the
router. It now requires a UUID and returns no route otherwise.

Regression tests live in `server/src/tests/rolematrix.test.ts` (103) and
`client/src/tests/audit.test.tsx` (13).

### Outstanding production gaps

These are unchanged and deliberately not hidden:

- **No rate limiting or login lockout.** The largest remaining gap; it has been
  on this list since Phase 1.
- **No password reset, email verification or MFA.** Fine for a college
  demonstration, not for real users.
- **The error handler includes `detail` when `NODE_ENV !== 'production'`.**
  A deliberate developer convenience â€” ensure production sets `NODE_ENV`.
- **`GET /providers/me` returns `verifiedBy`** (the deciding admin's user id) to
  the provider. Never public, and the admin UI already drops it, but the field
  exists in that one payload.
- **Notification types are triplicated** across the Postgres enum, the server and
  the client. Tests cover the server and client; nothing enforces the enum.

