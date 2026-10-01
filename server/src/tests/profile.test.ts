import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';

/**
 * Public provider profile tests (ADR-022).
 *
 * Run:  npm test --workspace server   (requires DB + migrations + seed)
 *
 * Rules under test:
 *   1. APPROVED providers are publicly readable (200 + full payload)
 *   2. PENDING / REJECTED / SUSPENDED providers are NOT (404)
 *   3. unknown id → 404; malformed id → 400; no distinction that leaks state
 *   4. the response exposes no password hash, email, phone, owner name,
 *      verification notes, admin action log or other internal column
 *   5. nested collections are allow-listed: services carry public fields only,
 *      images carry url/alt only, reviews are anonymous
 *   6. inactive services are not advertised
 */

let server: Server;
let base = '';

const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111';
const MALFORMED_ID = 'not-a-uuid';

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

const profile = (id: string) => call('GET', `/api/providers/${id}`);

/** Every seeded provider, keyed by verification status. */
let byStatus: Record<string, string> = {};
/** A provider with at least one review, for the review assertions. */
let reviewedProviderId = '';
/** A provider with a phone number on file, to prove it is not published. */
let providerWithPhoneId = '';

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const rows = await pool.query<{ verification_status: string; user_id: string }>(
    `SELECT verification_status, user_id FROM provider_profiles`,
  );
  byStatus = Object.fromEntries(rows.rows.map((r) => [r.verification_status, r.user_id]));

  const reviewed = await pool.query<{ provider_id: string }>(
    'SELECT DISTINCT provider_id FROM reviews LIMIT 1',
  );
  if (reviewed.rows[0]) reviewedProviderId = reviewed.rows[0].provider_id;

  const withPhone = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM provider_profiles WHERE phone IS NOT NULL LIMIT 1`,
  );
  if (withPhone.rows[0]) providerWithPhoneId = withPhone.rows[0].user_id;

  for (const status of ['APPROVED', 'PENDING', 'REJECTED', 'SUSPENDED']) {
    assert.ok(byStatus[status], `seed must include a ${status} provider`);
  }
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeAllConnections();
  await pool.end();
});

describe('public provider profile', { concurrency: 1 }, () => {


  // --- visibility ------------------------------------------------------

  test('APPROVED provider is publicly readable with a full payload', async () => {
    const res = await profile(byStatus.APPROVED);
    assert.equal(res.status, 200);

    const p = res.data.provider;
    assert.equal(p.id, byStatus.APPROVED);
    assert.ok(p.businessName, 'business name is required');
    assert.equal(typeof p.city, 'string');
    assert.equal(typeof p.yearsExperience, 'number');
    assert.equal(typeof p.isAvailable, 'boolean');
    assert.ok(Array.isArray(p.categories));
    assert.ok(Array.isArray(p.services));
    assert.ok(Array.isArray(p.images));
    assert.ok(Array.isArray(p.reviews));

    const publicIds = await pool.query<{ id: string }>('SELECT id FROM public_providers');
    assert.ok(publicIds.rows.some((r) => r.id === p.id));
  });

  test('PENDING / REJECTED / SUSPENDED providers are not publicly readable', async () => {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED']) {
      const res = await profile(byStatus[status]);
      assert.equal(res.status, 404, `${status} provider must not be publicly readable`);
      assert.equal(res.data.error.message, 'Provider not found');
    }
  });

  test('a rejected provider is still hidden when searched by its exact name', async () => {
    const rejected = await pool.query<{ business_name: string; user_id: string }>(
      `SELECT business_name, user_id FROM provider_profiles WHERE verification_status = 'REJECTED'`,
    );
    const search = await call(
      'GET',
      `/api/providers?keyword=${encodeURIComponent(rejected.rows[0].business_name)}&pageSize=50`,
    );
    const ids = search.data.providers.map((p: any) => p.id);
    assert.ok(!ids.includes(rejected.rows[0].user_id), 'rejected provider leaks via search');
  });

  test('a deactivated APPROVED provider stops being public', async () => {
    const target = byStatus.APPROVED;
    const user = await pool.query<{ is_active: boolean }>(
      'SELECT is_active FROM users WHERE id = $1',
      [target],
    );
    const original = user.rows[0].is_active;

    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [target]);
    try {
      const res = await profile(target);
      assert.equal(res.status, 404, 'deactivated user must not be public');
    } finally {
      await pool.query('UPDATE users SET is_active = $2 WHERE id = $1', [target, original]);
    }
  });

  // --- safe responses ---------------------------------------------------

  test('unknown, malformed and non-public ids are indistinguishable', async () => {
    const unknown = await profile(UNKNOWN_ID);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error.message, 'Provider not found');

    const malformed = await profile(MALFORMED_ID);
    assert.equal(malformed.status, 400, 'a malformed id is a client error');

    // A non-public provider must be indistinguishable from an unknown one.
    const rejected = await profile(byStatus.REJECTED);
    assert.equal(rejected.status, unknown.status);
    assert.equal(rejected.data.error.message, unknown.data.error.message);
  });

  test('profile is public: no authentication required, bogus token ignored', async () => {
    assert.equal((await profile(byStatus.APPROVED)).status, 200);
    const bogus = await call('GET', `/api/providers/${byStatus.APPROVED}`, undefined, 'not-a-token');
    assert.equal(bogus.status, 200, 'the profile endpoint never requires a session');
  });

  // --- exposure ---------------------------------------------------------

  test('no sensitive field is returned anywhere in the payload', async () => {
    for (const id of Object.values(byStatus)) {
      const res = await profile(id);
      if (res.status !== 200) continue; // 404 bodies carry no provider data at all
      const body = JSON.stringify(res.data);

      for (const forbidden of [
        'password',
        'scrypt',
        'email',
        'phone',
        'fullName',
        'full_name',
        'userId',
        'user_id',
        'verifiedBy',
        'verified_by',
        'hourlyRate',
        'hourly_rate',
        'address',
        'isActive',
        'is_active',
        'reason',
        'adminId',
        'admin_id',
        'bookingId',
        'booking_id',
        'customerId',
        'customer_id',
        'provider_id',
      ]) {
        assert.ok(!body.includes(forbidden), `profile leaked "${forbidden}"`);
      }
    }
  });

  test('a provider phone number is never published', async () => {
    if (!providerWithPhoneId) return;
    const phone = await pool.query<{ phone: string }>(
      'SELECT phone FROM provider_profiles WHERE user_id = $1',
      [providerWithPhoneId],
    );
    if (!phone.rows[0]?.phone) return;

    const res = await profile(providerWithPhoneId);
    if (res.status !== 200) return;
    assert.ok(
      !JSON.stringify(res.data).includes(phone.rows[0].phone),
      'provider phone number leaked into the public profile',
    );
  });

  test('the top-level DTO matches the search allow-list plus collections', async () => {
    const res = await profile(byStatus.APPROVED);
    const allowed = new Set([
      'id', 'businessName', 'description', 'city', 'serviceAreas', 'yearsExperience',
      'profileImageUrl', 'coverImageUrl', 'verifiedAt', 'rating', 'reviewCount',
      'priceFrom', 'activeServiceCount', 'isAvailable', 'categories',
      'services', 'images', 'reviews',
    ]);
    for (const key of Object.keys(res.data.provider)) {
      assert.ok(allowed.has(key), `unexpected top-level field "${key}"`);
    }
  });

  // --- nested collections ----------------------------------------------

  test('services expose public fields only, and never inactive ones', async () => {
    const res = await profile(byStatus.APPROVED);
    const allowed = new Set([
      'id', 'name', 'description', 'priceFrom', 'priceTo', 'durationMinutes', 'category',
    ]);

    for (const service of res.data.provider.services) {
      for (const key of Object.keys(service)) {
        assert.ok(allowed.has(key), `unexpected service field "${key}"`);
      }
      assert.ok(service.name, 'service name is required');
      assert.ok(service.category && service.category.slug, 'service category is required');
      assert.ok(
        service.priceTo === null || Number(service.priceTo) >= Number(service.priceFrom),
        'service price range is inverted',
      );
    }

    // Deactivating every service must remove them from the profile.
    const ids = res.data.provider.services.map((s: any) => s.id);
    if (ids.length > 0) {
      await pool.query('UPDATE services SET is_active = FALSE WHERE id = ANY($1::uuid[])', [ids]);
      try {
        const after = await profile(byStatus.APPROVED);
        assert.equal(after.data.provider.services.length, 0, 'inactive services still advertised');
      } finally {
        await pool.query('UPDATE services SET is_active = TRUE WHERE id = ANY($1::uuid[])', [
          ids,
        ]);
      }
    }
  });

  test('gallery images expose url and alt text only', async () => {
    const res = await profile(byStatus.APPROVED);
    for (const image of res.data.provider.images) {
      assert.deepEqual(Object.keys(image).sort(), ['altText', 'url']);
      assert.ok(image.url.startsWith('http'), 'image url must be absolute');
    }
  });

  test('reviews are public but anonymous', async () => {
    if (!reviewedProviderId) return;
    const res = await profile(reviewedProviderId);
    assert.equal(res.status, 200);

    for (const review of res.data.provider.reviews) {
      assert.deepEqual(Object.keys(review).sort(), ['comment', 'createdAt', 'rating']);
      assert.ok(review.rating >= 1 && review.rating <= 5);
    }

    const db = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM reviews WHERE provider_id = $1',
      [reviewedProviderId],
    );
    assert.equal(
      res.data.provider.reviews.length > 0,
      Number(db.rows[0].count) > 0,
      'review presence does not match the database',
    );
  });

  test('rating aggregates on the profile match the database', async () => {
    const res = await profile(byStatus.APPROVED);
    const db = await pool.query<{ rating_avg: string | null; rating_count: number }>(
      'SELECT rating_avg, rating_count FROM provider_profiles WHERE user_id = $1',
      [byStatus.APPROVED],
    );
    assert.equal(res.data.provider.reviewCount, db.rows[0].rating_count);
    if (db.rows[0].rating_avg === null) {
      assert.equal(res.data.provider.rating, null);
    } else {
      assert.ok(Math.abs(res.data.provider.rating - Number(db.rows[0].rating_avg)) < 0.01);
    }
  });
}); // end describe
