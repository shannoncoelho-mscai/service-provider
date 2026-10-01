import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Public provider search tests (ADR-021).
 *
 * Run:  npm test --workspace server   (requires DB + migrations + seed)
 *
 * Covers the acceptance criteria:
 *   1. filtering  — keyword, category, location, minPrice, maxPrice, rating,
 *                   availability, and combinations
 *   2. pagination — page/pageSize, metadata, no overlap between pages
 *   3. sorting    — rating, price, newest, asc/desc, stable tiebreak
 *   4. exposure   — no password hashes, contact details, owner identity,
 *                   verification notes or admin data in any response
 *   5. visibility — PENDING, REJECTED and SUSPENDED providers never appear
 *   6. validation — every query param is validated; injection attempts are
 *                   treated as literal text, never executed
 *
 * These tests read the seeded directory (8 APPROVED + 1 each of
 * PENDING/REJECTED/SUSPENDED) rather than creating their own providers, so
 * the "only APPROVED is public" rule is checked against realistic data.
 *
 * They run with `concurrency: 1` because several cases temporarily mutate
 * seeded rows (created_at, service_areas, services.is_active) to exercise the
 * triggers. Each mutation restores the exact prior value in a `finally`, so
 * the suite is repeatable and leaves no residue.
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const adminEmail = `search-admin-${runId}@example.com`;

/** Ids of the seeded providers that must NEVER be publicly visible. */
let hiddenIds: string[] = [];
let allPublicIds: string[] = [];

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

// `GET /api/providers` (no trailing slash) and `/api/providers/` are both
// valid; normalise the bare case so the 501 catch-all is never reached.
const search = (qs = '') => call('GET', '/api/providers' + (qs === '' ? '/' : qs));

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // A test admin is needed so a REJECTED row with a reason exists to prove
  // internal verification notes never reach the public endpoint.
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Search Admin', 'ADMIN')`,
    [adminEmail, await hashPassword('AdminPass123!')],
  );
  const login = await call('POST', '/api/auth/login', {
    email: adminEmail,
    password: 'AdminPass123!',
  });
  assert.equal(login.status, 200);
  const token = login.data.token;

  // Give the seeded REJECTED provider a private rejection reason.
  const rejected = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM provider_profiles WHERE verification_status = 'REJECTED' LIMIT 1`,
  );
  if (rejected.rows[0]) {
    await call(
      'PATCH',
      `/api/admin/providers/${rejected.rows[0].user_id}/reject`,
      { reason: 'INTERNAL NOTE: tax paperwork could not be verified' },
      token,
    );
  }

  // Everything that is not APPROVED (plus inactive users) must stay hidden.
  const hidden = await pool.query<{ user_id: string }>(
    `SELECT p.user_id
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.verification_status <> 'APPROVED' OR NOT u.is_active`,
  );
  hiddenIds = hidden.rows.map((r) => r.user_id);

  const pub = await pool.query<{ id: string }>('SELECT id FROM public_providers');
  allPublicIds = pub.rows.map((r) => r.id);
});

after(async () => {
  try {
    const admin = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      adminEmail,
    ]);
    if (admin.rows[0]) {
      // Restore the seeded REJECTED provider's original state.
      const rej = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM provider_profiles
          WHERE verification_status = 'REJECTED' AND user_id <> $1 LIMIT 1`,
        [admin.rows[0].id],
      );
      if (rej.rows[0]) {
        await pool.query(
          `UPDATE provider_profiles
              SET verification_status = 'REJECTED', verified_by = NULL, verified_at = NULL
            WHERE user_id = $1`,
          [rej.rows[0].user_id],
        );
      }
      await pool.query('DELETE FROM admin_action_log WHERE admin_id = $1', [admin.rows[0].id]);
      await pool.query('DELETE FROM users WHERE id = $1', [admin.rows[0].id]);
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await pool.end();
  }
});


// --- visibility: only APPROVED providers are public ----------------------

// `describe(..., { concurrency: 1 })` runs these in file order, one at a time.
// That matters here: the sort/availability/location cases temporarily rewrite
// seeded rows to exercise the triggers, and the pagination case reads every
// row. Running them concurrently let one test's mutation land in the middle of
// another's walk, which is a test-isolation bug, not a product bug.
describe('public provider search', { concurrency: 1 }, () => {

test('visibility: unfiltered search returns exactly the APPROVED set', async () => {
  const res = await search('?pageSize=50');
  assert.equal(res.status, 200);
  const ids = res.data.providers.map((p: any) => p.id);

  assert.equal(res.data.pagination.total, allPublicIds.length);
  assert.deepEqual([...ids].sort(), [...allPublicIds].sort());

  // Database truth: every returned row is APPROVED.
  const db = await pool.query<{ id: string; verification_status: string }>(
    `SELECT v.id, p.verification_status
       FROM public_providers v
       JOIN provider_profiles p ON p.user_id = v.id`,
  );
  for (const row of db.rows) {
    assert.equal(row.verification_status, 'APPROVED');
  }
});

test('visibility: PENDING / REJECTED / SUSPENDED providers never appear', async () => {
  assert.ok(hiddenIds.length >= 3, 'seed should include non-approved providers');

  const byStatus = await pool.query<{ verification_status: string }>(
    `SELECT DISTINCT verification_status FROM provider_profiles
      WHERE verification_status <> 'APPROVED'`,
  );
  const statuses = new Set(byStatus.rows.map((r) => r.verification_status));
  assert.ok(statuses.has('PENDING'), 'need a PENDING provider to test');
  assert.ok(statuses.has('REJECTED'), 'need a REJECTED provider to test');
  assert.ok(statuses.has('SUSPENDED'), 'need a SUSPENDED provider to test');

  // Sweep every query shape a customer can use: a hidden provider must not
  // surface via keyword, category, location, price, rating or availability.
  for (const qs of [
    '',
    '?pageSize=50',
    '?sort=rating',
    '?sort=price&order=asc',
    '?sort=newest',
    '?availability=true',
    '?rating=0',
    '?maxPrice=1000000',
    '?minPrice=0&maxPrice=1000000&rating=0&availability=false',
  ]) {
    const res = await search(qs);
    assert.equal(res.status, 200, `query "${qs}" should be 200, got ${res.status}`);
    const ids = res.data.providers.map((p: any) => p.id);
    for (const hidden of hiddenIds) {
      assert.ok(!ids.includes(hidden), `hidden provider leaked via "${qs}"`);
    }
  }

  // Even searching for a hidden provider's exact business name finds nothing.
  const target = await pool.query<{ business_name: string; user_id: string }>(
    `SELECT business_name, user_id FROM provider_profiles
      WHERE verification_status = 'REJECTED' LIMIT 1`,
  );
  if (target.rows[0]) {
    const res = await search(`?keyword=${encodeURIComponent(target.rows[0].business_name)}`);
    const ids = res.data.providers.map((p: any) => p.id);
    assert.ok(!ids.includes(target.rows[0].user_id), 'rejected provider found by name');
  }
});

test('exposure: responses contain no secrets, contact details or admin data', async () => {
  const res = await search('?pageSize=50');
  const body = JSON.stringify(res.data);

  // Nothing sensitive may appear anywhere in the payload.
  for (const forbidden of [
    'password',
    'scrypt',
    'email',
    'phone',
    'fullName',
    'verifiedBy',
    'reason',
    'INTERNAL NOTE',
    'tax paperwork',
    'adminId',
    'rejection',
    'suspension',
  ]) {
    assert.ok(!body.includes(forbidden), `response leaked "${forbidden}"`);
  }

  // The allow-list is exact: no unexpected top-level keys per provider.
  const allowed = new Set([
    'id',
    'businessName',
    'description',
    'city',
    'serviceAreas',
    'yearsExperience',
    'profileImageUrl',
    'coverImageUrl',
    'verifiedAt',
    'rating',
    'reviewCount',
    'priceFrom',
    'activeServiceCount',
    'isAvailable',
    'categories',
  ]);
  for (const provider of res.data.providers) {
    for (const key of Object.keys(provider)) {
      assert.ok(allowed.has(key), `unexpected field "${key}" in public DTO`);
    }
  }

  // Address and hourly rate are deliberately withheld from the directory.
  assert.ok(!('address' in res.data.providers[0]));
  assert.ok(!('hourlyRate' in res.data.providers[0]));

  // Contact details of real providers must not appear anywhere in the body.
  const contacts = await pool.query<{ phone: string | null }>(
    `SELECT phone FROM provider_profiles WHERE phone IS NOT NULL LIMIT 5`,
  );
  for (const c of contacts.rows) {
    assert.ok(!body.includes(c.phone!), 'a provider phone number leaked into search results');
  }
});

// --- filtering ------------------------------------------------------------

test('filter: keyword matches business name, description and service names', async () => {
  // Business name ("Plumbing").
  const byName = await search('?keyword=Plumbing');
  assert.ok(byName.data.pagination.total >= 1);
  for (const p of byName.data.providers) {
    assert.match(`${p.businessName} ${p.description ?? ''}`.toLowerCase(), /plumbing|pipe|drain/);
  }

  // Keyword only present in a SERVICE name still matches the provider.
  const svc = await pool.query<{ name: string; provider_id: string }>(
    `SELECT name, provider_id FROM services WHERE is_active ORDER BY name LIMIT 1`,
  );
  const word = svc.rows[0].name.split(' ')[0];
  const byService = await search(`?keyword=${encodeURIComponent(word)}`);
  assert.ok(
    byService.data.providers.some((p: any) => p.id === svc.rows[0].provider_id),
    `keyword "${word}" should match via service name`,
  );

  // Case-insensitive.
  const lower = await search(`?keyword=${word.toLowerCase()}`);
  const upper = await search(`?keyword=${word.toUpperCase()}`);
  assert.equal(lower.data.pagination.total, upper.data.pagination.total);

  // No match → empty, not an error.
  const none = await search('?keyword=zzzznotathingzzzz');
  assert.equal(none.status, 200);
  assert.equal(none.data.pagination.total, 0);
  assert.deepEqual(none.data.providers, []);
});

test('filter: category uses slugs and excludes providers outside it', async () => {
  const cats = await call('GET', '/api/providers/categories');
  assert.equal(cats.status, 200);
  assert.ok(cats.data.categories.length > 0);

  for (const cat of cats.data.categories) {
    const res = await search(`?category=${encodeURIComponent(cat.slug)}`);
    assert.equal(res.status, 200);
    for (const p of res.data.providers) {
      assert.ok(
        p.categories.some((c: any) => c.slug === cat.slug),
        `${p.businessName} does not offer ${cat.slug}`,
      );
    }
  }

  // Unknown slug → empty result, no error, no leak.
  const unknown = await search('?category=not-a-real-category');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.pagination.total, 0);
});

test('filter: location matches city or advertised service area', async () => {
  const city = await pool.query<{ city: string }>('SELECT city FROM public_providers LIMIT 1');
  const byCity = await search(`?location=${encodeURIComponent(city.rows[0].city)}`);
  assert.ok(byCity.data.pagination.total >= 1);
  for (const p of byCity.data.providers) {
    const want = city.rows[0].city.toLowerCase();
    const match =
      p.city.toLowerCase() === want || p.serviceAreas.some((a: string) => a.toLowerCase() === want);
    assert.ok(match, `${p.businessName} is not in ${city.rows[0].city}`);
  }

  // Partial match works too.
  const partial = await search(`?location=${city.rows[0].city.slice(0, 3)}`);
  assert.ok(partial.data.pagination.total >= 1);

  // Service-area matching: set an area on a known provider and find it.
  // Restore unconditionally so a later failure cannot leak state.
  const target = await pool.query<{ id: string; service_areas: string[] }>(
    'SELECT id, service_areas FROM public_providers LIMIT 1',
  );
  await pool.query('UPDATE provider_profiles SET service_areas = $2 WHERE user_id = $1', [
    target.rows[0].id,
    ['Zzyzxville'],
  ]);
  try {
    const byArea = await search('?location=Zzyzxville');
    assert.ok(
      byArea.data.providers.some((p: any) => p.id === target.rows[0].id),
      'service-area location filter failed',
    );
  } finally {
    await pool.query('UPDATE provider_profiles SET service_areas = $2 WHERE user_id = $1', [
      target.rows[0].id,
      target.rows[0].service_areas,
    ]);
  }
});

test('filter: price, rating and availability narrow the result set', async () => {
  const all = await search('?pageSize=50');
  const total = all.data.pagination.total;

  // maxPrice: everyone returned must have a price_min within budget.
  const cheap = await search('?maxPrice=100');
  for (const p of cheap.data.providers) {
    assert.ok(Number(p.priceFrom) <= 100, `${p.businessName} is above the budget`);
  }
  assert.ok(cheap.data.pagination.total <= total);

  // minPrice: an "at least this much" filter, matched on any active service.
  const premium = await search('?minPrice=150');
  for (const p of premium.data.providers) {
    const has = await pool.query(
      `SELECT 1 FROM services WHERE provider_id = $1 AND is_active AND price_from >= 150 LIMIT 1`,
      [p.id],
    );
    assert.equal(has.rowCount, 1, `${p.businessName} has no service at or above 150`);
  }

  // rating: minimum average, and unrated providers are excluded.
  const rated = await search('?rating=4');
  for (const p of rated.data.providers) {
    assert.notEqual(p.rating, null);
    assert.ok(Number(p.rating) >= 4);
  }
  const high = await search('?rating=4.5');
  assert.ok(high.data.pagination.total <= rated.data.pagination.total);

  // availability: only providers with at least one active service.
  const available = await search('?availability=true');
  for (const p of available.data.providers) {
    assert.equal(p.isAvailable, true);
    assert.ok(p.activeServiceCount > 0);
  }
  assert.ok(available.data.pagination.total <= total);

  // Combining filters narrows further and stays consistent.
  const combo = await search('?rating=4&availability=true&sort=rating');
  assert.ok(combo.data.pagination.total <= rated.data.pagination.total);
  for (const p of combo.data.providers) {
    assert.equal(p.isAvailable, true);
    assert.ok(Number(p.rating) >= 4);
  }
});

test('filter: a deactivated service makes a provider unavailable', async () => {
  // The trigger that backs `availability` must react to service changes.
  const target = await pool.query<{ id: string }>(
    'SELECT id FROM public_providers WHERE active_service_count > 0 LIMIT 1',
  );
  const id = target.rows[0].id;
  const svcs = await pool.query<{ id: string }>(
    'SELECT id FROM services WHERE provider_id = $1 AND is_active ORDER BY id',
    [id],
  );
  const count = svcs.rows.length;
  assert.ok(count > 0, 'fixture provider must have at least one active service');

  try {
    // Deactivate them one at a time: the count must fall by exactly one each time.
    for (let i = 0; i < count; i++) {
      await pool.query('UPDATE services SET is_active = FALSE WHERE id = $1', [svcs.rows[i].id]);
      const after = await pool.query<{ active_service_count: number }>(
        'SELECT active_service_count FROM provider_profiles WHERE user_id = $1',
        [id],
      );
      assert.equal(
        after.rows[0].active_service_count,
        count - i - 1,
        `trigger did not recount after deactivating service ${i + 1}`,
      );
    }

    // With every service inactive the provider drops out of the availability filter…
    const res = await search('?availability=true&pageSize=50');
    assert.ok(!res.data.providers.some((p: any) => p.id === id), 'unavailable provider listed');

    // …but is still publicly visible in the directory (deactivated ≠ removed).
    const all = await search('?pageSize=50');
    const found = all.data.providers.find((p: any) => p.id === id);
    assert.ok(found, 'provider should still be listed without the availability filter');
    assert.equal(found.isAvailable, false);
    assert.equal(found.activeServiceCount, 0);
  } finally {
    for (const s of svcs.rows) {
      await pool.query('UPDATE services SET is_active = TRUE WHERE id = $1', [s.id]);
    }
  }

  const restored = await pool.query<{ active_service_count: number }>(
    'SELECT active_service_count FROM provider_profiles WHERE user_id = $1',
    [id],
  );
  assert.equal(restored.rows[0].active_service_count, count, 'trigger did not restore the count');
});

// --- pagination -----------------------------------------------------------

test('pagination: page size, metadata and non-overlapping pages', async () => {
  const all = await search('?pageSize=50');
  const total = all.data.pagination.total;
  assert.ok(total >= 2, 'need at least two providers for pagination');

  const p1 = await search('?page=1&pageSize=2');
  assert.equal(p1.status, 200);
  assert.equal(p1.data.providers.length, 2);
  assert.equal(p1.data.pagination.page, 1);
  assert.equal(p1.data.pagination.pageSize, 2);
  assert.equal(p1.data.pagination.total, total);
  assert.equal(p1.data.pagination.totalPages, Math.ceil(total / 2));
  assert.equal(p1.data.pagination.hasPrev, false);
  assert.equal(p1.data.pagination.hasNext, true);

  const p2 = await search('?page=2&pageSize=2');
  const ids1 = p1.data.providers.map((p: any) => p.id);
  const ids2 = p2.data.providers.map((p: any) => p.id);
  for (const id of ids2) {
    assert.ok(!ids1.includes(id), 'pages must not overlap');
  }
  assert.equal(p2.data.pagination.hasPrev, true);

  // Walking every page yields each provider exactly once (no dupes, no gaps).
  const seen = new Set<string>();
  for (let page = 1; page <= Math.ceil(total / 2); page++) {
    const res = await search(`?page=${page}&pageSize=2&sort=newest`);
    for (const p of res.data.providers) seen.add(p.id);
  }
  assert.equal(seen.size, total, 'paging must cover every result exactly once');

  // Beyond the last page → empty, well-formed, not an error.
  const beyond = await search('?page=999&pageSize=2');
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.data.providers, []);
  assert.equal(beyond.data.pagination.hasNext, false);

  // Defaults are applied when pagination params are omitted.
  const dflt = await search('');
  assert.equal(dflt.data.pagination.page, 1);
  assert.ok(dflt.data.pagination.pageSize >= 1);
});

// --- sorting --------------------------------------------------------------

test('sort: rating, price and newest, each asc and desc', async () => {
  const byRatingDesc = await search('?sort=rating&order=desc&rating=0&pageSize=50');
  const ratings = byRatingDesc.data.providers.map((p: any) => Number(p.rating));
  for (let i = 1; i < ratings.length; i++) {
    assert.ok(ratings[i - 1] >= ratings[i], `rating desc broken at ${i}: ${ratings}`);
  }

  const byRatingAsc = await search('?sort=rating&order=asc&rating=0&pageSize=50');
  const asc = byRatingAsc.data.providers.map((p: any) => Number(p.rating));
  for (let i = 1; i < asc.length; i++) {
    assert.ok(asc[i - 1] <= asc[i], `rating asc broken at ${i}: ${asc}`);
  }

  const byPriceAsc = await search('?sort=price&order=asc&pageSize=50');
  const prices = byPriceAsc.data.providers.map((p: any) => Number(p.priceFrom));
  for (let i = 1; i < prices.length; i++) {
    assert.ok(prices[i - 1] <= prices[i], `price asc broken at ${i}: ${prices}`);
  }

  const byPriceDesc = await search('?sort=price&order=desc&pageSize=50');
  const desc = byPriceDesc.data.providers.map((p: any) => Number(p.priceFrom));
  for (let i = 1; i < desc.length; i++) {
    assert.ok(desc[i - 1] >= desc[i], `price desc broken at ${i}: ${desc}`);
  }

  // asc and desc must genuinely differ, and cover the same rows.
  const byNewest = await search('?sort=newest&order=desc&pageSize=50');
  const oldestFirst = await search('?sort=newest&order=asc&pageSize=50');
  assert.equal(byNewest.data.pagination.total, oldestFirst.data.pagination.total);

  // The seeded directory shares one created_at, so newest ordering normally
  // falls through to the `id` tiebreaker. Give ALL providers distinct,
  // unambiguous timestamps so the sort must genuinely follow created_at.
  const all = await pool.query<{ id: string; created_at: Date }>(
    'SELECT id, created_at FROM public_providers ORDER BY id',
  );
  assert.ok(all.rows.length >= 2, 'need at least two public providers');
  const older = all.rows[0].id;
  const newer = all.rows[all.rows.length - 1].id;

  try {
    // Spaced a day apart so no rounding can blur the boundary.
    for (const [i, row] of all.rows.entries()) {
      await pool.query(
        `UPDATE provider_profiles
            SET created_at = timestamptz '2020-01-01 00:00:00+00' + ($2 || ' days')::interval
          WHERE user_id = $1`,
        [row.id, String(i)],
      );
    }
    assert.notEqual(older, newer, 'fixture must have two distinct providers');

    const descNewest = await search('?sort=newest&order=desc&pageSize=50');
    assert.equal(
      descNewest.data.providers[0].id,
      newer,
      'newest-first must lead with the most recent provider',
    );
    assert.equal(
      descNewest.data.providers[descNewest.data.providers.length - 1].id,
      older,
      'newest-first must end with the least recent provider',
    );

    const ascNewest = await search('?sort=newest&order=asc&pageSize=50');
    assert.equal(
      ascNewest.data.providers[0].id,
      older,
      'oldest-first must lead with the least recent provider',
    );
    assert.equal(ascNewest.data.providers[ascNewest.data.providers.length - 1].id, newer);
    assert.notDeepEqual(
      descNewest.data.providers.map((p: any) => p.id),
      ascNewest.data.providers.map((p: any) => p.id),
    );
  } finally {
    // Restore the exact prior timestamps.
    for (const row of all.rows) {
      await pool.query('UPDATE provider_profiles SET created_at = $2 WHERE user_id = $1', [
        row.id,
        row.created_at,
      ]);
    }
  }
});

test('sort: unrated providers sort last in both directions', async () => {
  // rating_avg is NULL for providers with no reviews. Those rows must cluster
  // at the end regardless of direction, otherwise "cheapest first" surfaces
  // providers nobody has rated yet.
  const asc = await search('?sort=rating&order=asc&pageSize=50');
  const values = asc.data.providers.map((p: any) => p.rating);
  const firstNull = values.findIndex((v: any) => v === null);
  if (firstNull !== -1) {
    assert.ok(
      values.slice(firstNull).every((v: any) => v === null),
      'NULL ratings must cluster at the end of an ascending sort',
    );
  }

  const desc = await search('?sort=rating&order=desc&pageSize=50');
  const dvalues = desc.data.providers.map((p: any) => p.rating);
  const firstNullDesc = dvalues.findIndex((v: any) => v === null);
  if (firstNullDesc !== -1) {
    assert.ok(
      dvalues.slice(firstNullDesc).every((v: any) => v === null),
      'NULL ratings must cluster at the end of a descending sort',
    );
  }

  // A minimum-rating filter must exclude unrated providers entirely.
  const rated = await search('?rating=0&pageSize=50');
  for (const p of rated.data.providers) {
    assert.notEqual(p.rating, null, 'rating filter should have excluded unrated providers');
  }
});

// --- validation & injection ----------------------------------------------

test('validation: invalid query parameters are rejected with 400', async () => {
  const bad: Array<[string, string]> = [
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['pageSize=0', 'pageSize'],
    ['pageSize=51', 'pageSize'],
    ['pageSize=abc', 'pageSize'],
    ['minPrice=-5', 'minPrice'],
    ['minPrice=abc', 'minPrice'],
    ['maxPrice=abc', 'maxPrice'],
    ['minPrice=100&maxPrice=10', 'range'],
    ['rating=9', 'rating'],
    ['rating=-1', 'rating'],
    ['rating=abc', 'rating'],
    ['availability=maybe', 'availability'],
    ['sort=popularity', 'sort'],
    ['order=sideways', 'order'],
    ['keyword=', 'empty keyword'],
    ['minPrice=10.999', 'too many decimals'],
  ];

  for (const [qs, label] of bad) {
    const res = await search(`?${qs}`);
    assert.equal(res.status, 400, `"${qs}" (${label}) should be 400, got ${res.status}`);
  }

  // Unknown parameter → 400 rather than being silently ignored.
  const unknown = await search('?minprice=50');
  assert.equal(unknown.status, 400, 'typo/unsupported param should be rejected');
});

test('injection: SQL metacharacters are treated as literal text', async () => {
  const payloads = [
    "'; DROP TABLE providers; --",
    "' OR '1'='1",
    "1' UNION SELECT password_hash, 1 FROM users --",
    "admin'--",
    "'; DELETE FROM services WHERE '1'='1",
  ];

  for (const payload of payloads) {
    const res = await search(`?keyword=${encodeURIComponent(payload)}`);
    // Either a 400 (schema) or an empty result — never a 500, never data.
    assert.ok(
      res.status === 200 || res.status === 400,
      `payload "${payload}" produced ${res.status}`,
    );
    if (res.status === 200) {
      assert.equal(res.data.pagination.total, 0, 'injection payload matched a provider');
    }
  }

  // The same payloads through every other string-ish parameter.
  for (const key of ['category', 'location']) {
    const res = await search(`?${key}=${encodeURIComponent("' OR 1=1--")}`);
    assert.ok(res.status === 200 || res.status === 400);
    if (res.status === 200) assert.equal(res.data.pagination.total, 0);
  }

  // The database is still standing and the directory is intact.
  const tables = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users','services','provider_profiles')`,
  );
  assert.equal(Number(tables.rows[0].count), 3, 'tables were dropped by an injection attempt');
  const healthy = await search('?pageSize=50');
  assert.equal(healthy.data.pagination.total, allPublicIds.length);

  // LIKE wildcards are escaped, not treated as patterns.
  const wildcard = await search(`?keyword=${encodeURIComponent('%')}`);
  assert.equal(wildcard.status, 200);
  assert.equal(wildcard.data.pagination.total, 0, "'%' must not match every provider");
});

test('search is public: no authentication required', async () => {
  const res = await search('?pageSize=1');
  assert.equal(res.status, 200);
  // And it stays public even with a bogus token (it is never required).
  const bogus = await call('GET', '/api/providers?pageSize=1', undefined, 'not-a-real-token');
  assert.equal(bogus.status, 200);
});

}); // end describe('public provider search')
