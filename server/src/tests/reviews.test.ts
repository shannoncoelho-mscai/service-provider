import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Customer review workflow tests (ADR-028).
 *
 * Run:  npm test --workspace server   (requires DB + migrations + seed)
 *
 * Serial by design: several cases drive the SAME booking through the lifecycle
 * and then attempt to review it, so order matters and state is shared
 * deliberately.
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  customerA: `rv-cust-a-${runId}@example.com`,
  customerB: `rv-cust-b-${runId}@example.com`,
  providerA: `rv-prov-a-${runId}@example.com`,
  admin: `rv-admin-${runId}@example.com`,
};

let tokenCustomerA = '';
let tokenCustomerB = '';
let tokenProviderA = '';
let adminToken = '';

let providerAId = '';
let serviceAId = '';
/** A seeded category, required when creating a service. */
let categoryId = '';

function adminPassword(): string {
  return 'AdminPass123!';
}

/** A future slot, so the booking can legally be created. */
function slot(daysAhead: number, hour = 10): { date: string; time: string } {
  const when = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  when.setUTCHours(hour, 0, 0, 0);
  return {
    date: when.toISOString().slice(0, 10),
    time: `${String(when.getUTCHours()).padStart(2, '0')}:00`,
  };
}

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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

/** Every fixture booking is unique in time so the double-booking index is safe. */
let slotCounter = 0;
async function createBooking(): Promise<string> {
  const s = slot(5 + (slotCounter += 1));
  const res = await call(
    'POST',
    '/bookings',
    {
      providerId: providerAId,
      serviceId: serviceAId,
      date: s.date,
      time: s.time,
      problemDescription: 'Review fixture booking for the reviews suite.',
      address: '1 Test Street',
    },
    tokenCustomerA,
  );
  assert.equal(res.status, 201, `booking create failed: ${JSON.stringify(res.data)}`);
  return res.data.booking.id;
}

/** Drive a booking through the provider status machine. */
async function driveTo(bookingId: string, path: string[], reason?: string) {
  for (const step of path) {
    const res = await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: step, ...(reason ? { reason } : {}) },
      tokenProviderA,
    );
    assert.equal(res.status, 200, `status step ${step} failed: ${JSON.stringify(res.data)}`);
  }
}

const toCompleted = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];

/** A fresh COMPLETED booking, the precondition for every happy-path review. */
async function completedBooking(): Promise<string> {
  const id = await createBooking();
  await driveTo(id, toCompleted);
  return id;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;

  for (const [key, email] of [
    ['customerA', emails.customerA],
    ['customerB', emails.customerB],
  ] as const) {
    const res = await call('POST', '/auth/register', {
      email,
      password: 'ReviewTest123!',
      fullName: `Review ${key}`,
      role: 'CUSTOMER',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    if (key === 'customerA') tokenCustomerA = res.data.token;
    else tokenCustomerB = res.data.token;
  }

  const reg = await call('POST', '/auth/register', {
    email: emails.providerA,
    password: 'ReviewTest123!',
    fullName: 'Review Provider',
    role: 'PROVIDER',
    provider: { businessName: `Review Plumbing ${runId}`, city: 'Springfield' },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  tokenProviderA = reg.data.token;
  providerAId = reg.data.user.id;

  // A seeded category is required when creating a service.
  const cat = await pool.query('SELECT id FROM service_categories ORDER BY id LIMIT 1');
  assert.ok(cat.rows[0], 'seeded categories are required for these tests');
  categoryId = cat.rows[0].id;

  // Public registration deliberately cannot mint an ADMIN (ADR-016), so the
  // fixture admin is inserted directly — the same approach auth.test.ts uses.
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Review Test Admin', 'ADMIN')`,
    [emails.admin, await hashPassword(adminPassword())],
  );

  const admin = await call('POST', '/auth/login', {
    email: emails.admin,
    password: adminPassword(),
  });
  assert.equal(admin.status, 200, `admin login failed: ${JSON.stringify(admin.data)}`);
  adminToken = admin.data.token;

  const appr = await call('PATCH', `/admin/providers/${providerAId}/approve`, {}, adminToken);
  assert.equal(appr.status, 200, `approve failed: ${JSON.stringify(appr.data)}`);

  const svc = await call(
    'POST',
    '/providers/me/services',
    { name: 'Review Test Service', categoryId, priceFrom: 50, durationMinutes: 60 },
    tokenProviderA,
  );
  assert.equal(svc.status, 201, `service create failed: ${JSON.stringify(svc.data)}`);
  serviceAId = svc.data.service.id;
});

after(async () => {
  try {
    // Order matters, and the reason is a schema interaction worth recording:
    //   1. admin_action_log rows reference the fixture admin (FK blocks the delete)
    //   2. provider_profiles.verified_by is ON DELETE SET NULL, so deleting the
    //      admin first would blank `verified_by` on a row that still has a
    //      `verified_at`, tripping `CHECK (verified_at IS NULL OR
    //      verified_by IS NOT NULL)`. The profiles go first to avoid that.
    await pool.query(
      `DELETE FROM admin_action_log
        WHERE admin_id IN (SELECT id FROM users WHERE email LIKE $1)
           OR target_id IN (SELECT user_id FROM provider_profiles
                             WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      [`%${runId}%`],
    );
    await pool.query(
      `DELETE FROM provider_profiles
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`%${runId}%`],
    );
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${runId}%`]);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await pool.end();
  }
});

/* ------------------------------------------------------------------- auth -- */

describe('reviews - authentication and role', () => {
  test('unauthenticated create returns 401', async () => {
    const bookingId = await createBooking();
    const res = await call('POST', '/reviews', { bookingId, rating: 5 });
    assert.equal(res.status, 401);
  });

  test('unauthenticated list-my returns 401', async () => {
    assert.equal((await call('GET', '/reviews/my')).status, 401);
  });

  test('a PROVIDER cannot create a customer review (403)', async () => {
    const bookingId = await completedBooking();
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenProviderA);
    assert.equal(res.status, 403);
  });

  test('a provider cannot list customer reviews (403)', async () => {
    assert.equal((await call('GET', '/reviews/my', undefined, tokenProviderA)).status, 403);
  });
});

/* -------------------------------------------------------------- ownership -- */

describe('reviews - ownership', () => {
  test("a customer cannot review another customer's booking (404)", async () => {
    const bookingId = await completedBooking();
    // 404, not 403: the booking is invisible to B, so this endpoint cannot be
    // used to discover which booking ids exist.
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerB);
    assert.equal(res.status, 404);
  });

  test('an unknown booking id is also 404 - indistinguishable', async () => {
    const res = await call(
      'POST',
      '/reviews',
      { bookingId: '99999999-9999-4999-8999-999999999999', rating: 5 },
      tokenCustomerA,
    );
    assert.equal(res.status, 404);
  });

  test('providerId in the body is rejected outright', async () => {
    const bookingId = await completedBooking();
    const res = await call(
      'POST',
      '/reviews',
      { bookingId, rating: 5, providerId: providerAId },
      tokenCustomerA,
    );
    assert.equal(res.status, 400);
  });

  test('every ownership field in the body is rejected', async () => {
    for (const field of ['customerId', 'reviewerId', 'userId', 'reviewer_id', 'customer_id']) {
      const bookingId = await completedBooking();
      const res = await call(
        'POST',
        '/reviews',
        { bookingId, rating: 5, [field]: '99999999-9999-4999-8999-999999999999' },
        tokenCustomerA,
      );
      assert.equal(res.status, 400, `${field} must be rejected`);
    }
  });
});

/* ------------------------------------------------------------ eligibility -- */

describe('reviews - booking status eligibility', () => {
  test('a PENDING booking cannot be reviewed (409)', async () => {
    const bookingId = await createBooking();
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 409);
  });

  test('an ACCEPTED booking cannot be reviewed (409)', async () => {
    const bookingId = await createBooking();
    await driveTo(bookingId, ['ACCEPTED']);
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 409);
  });

  test('an IN_PROGRESS booking cannot be reviewed (409)', async () => {
    const bookingId = await createBooking();
    await driveTo(bookingId, ['ACCEPTED', 'IN_PROGRESS']);
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 409);
  });

  test('a COMPLETED booking can be reviewed (201)', async () => {
    const bookingId = await completedBooking();
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.review.rating, 5);
    assert.equal(res.data.review.bookingId, bookingId);
  });

  test('a CANCELLED booking cannot be reviewed (409)', async () => {
    const bookingId = await createBooking();
    const cancel = await call(
      'PATCH',
      `/bookings/${bookingId}/cancel`,
      { reason: 'no longer needed' },
      tokenCustomerA,
    );
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 409);
  });

  test('a REJECTED booking cannot be reviewed (409)', async () => {
    const bookingId = await createBooking();
    await driveTo(bookingId, ['REJECTED'], 'fully booked that week');
    const res = await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);
    assert.equal(res.status, 409);
  });
});

/* ----------------------------------------------------------------- rating -- */

describe('reviews - rating validation', () => {
  test('every integer 1..5 is accepted', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const bookingId = await completedBooking();
      const res = await call('POST', '/reviews', { bookingId, rating }, tokenCustomerA);
      assert.equal(res.status, 201, `rating ${rating} should be accepted`);
      assert.equal(res.data.review.rating, rating);
    }
  });

  test('out-of-range and non-integer ratings are rejected (400)', async () => {
    const bad: unknown[] = [0, 6, -3, 4.5, '5', null, undefined, NaN];
    for (const rating of bad) {
      const bookingId = await completedBooking();
      const res = await call('POST', '/reviews', { bookingId, rating }, tokenCustomerA);
      assert.equal(res.status, 400, `rating ${String(rating)} must be rejected`);
    }
  });

  test('a missing rating is rejected (400)', async () => {
    const bookingId = await completedBooking();
    assert.equal((await call('POST', '/reviews', { bookingId }, tokenCustomerA)).status, 400);
  });
});

/* ---------------------------------------------------------------- comment -- */

describe('reviews - comment handling', () => {
  test('the comment is optional and stored as null', async () => {
    const bookingId = await completedBooking();
    const res = await call('POST', '/reviews', { bookingId, rating: 4 }, tokenCustomerA);
    assert.equal(res.status, 201);
    assert.equal(res.data.review.comment, null);
  });

  test('a comment is stored', async () => {
    const bookingId = await completedBooking();
    const res = await call(
      'POST',
      '/reviews',
      { bookingId, rating: 4, comment: 'Fast, tidy and explained everything.' },
      tokenCustomerA,
    );
    assert.equal(res.data.review.comment, 'Fast, tidy and explained everything.');
  });

  test('a whitespace-only comment is stored as null, not as blank text', async () => {
    const bookingId = await completedBooking();
    const res = await call(
      'POST',
      '/reviews',
      { bookingId, rating: 4, comment: '   \n\t  ' },
      tokenCustomerA,
    );
    assert.equal(res.status, 201);
    assert.equal(res.data.review.comment, null, 'a blank comment must be stored as NULL');
  });

  test('a comment is trimmed before storage', async () => {
    const bookingId = await completedBooking();
    const res = await call(
      'POST',
      '/reviews',
      { bookingId, rating: 4, comment: '   Great work.   ' },
      tokenCustomerA,
    );
    assert.equal(res.data.review.comment, 'Great work.');
  });

  test('exactly 2000 characters is accepted, 2001 is rejected', async () => {
    const okId = await completedBooking();
    assert.equal(
      (
        await call(
          'POST',
          '/reviews',
          { bookingId: okId, rating: 4, comment: 'x'.repeat(2000) },
          tokenCustomerA,
        )
      ).status,
      201,
    );

    const tooLong = await completedBooking();
    assert.equal(
      (
        await call(
          'POST',
          '/reviews',
          { bookingId: tooLong, rating: 4, comment: 'x'.repeat(2001) },
          tokenCustomerA,
        )
      ).status,
      400,
    );
  });
});

/* -------------------------------------------------------------- duplicates -- */

describe('reviews - one review per booking', () => {
  test('a duplicate review returns 409 and leaks no SQL detail', async () => {
    const bookingId = await completedBooking();
    assert.equal(
      (await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA)).status,
      201,
    );
    const again = await call('POST', '/reviews', { bookingId, rating: 1 }, tokenCustomerA);
    assert.equal(again.status, 409);

    const text = JSON.stringify(again.data).toLowerCase();
    for (const leak of [
      'reviews_booking_id_key',
      'duplicate key',
      'unique',
      'relation',
      'select ',
      'insert ',
      'pg_',
    ]) {
      assert.ok(!text.includes(leak), `409 response leaked: ${leak}`);
    }
  });

  test('the DATABASE prevents a duplicate, not just the application', async () => {
    const bookingId = await completedBooking();
    await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);

    // Bypass the API entirely. The UNIQUE constraint must still reject it -
    // this is the real concurrency guard, not the service-layer check.
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO reviews (booking_id, customer_id, provider_id, rating)
             SELECT b.id, b.customer_id, b.provider_id, 1
               FROM bookings b WHERE b.id = $1`,
          [bookingId],
        ),
      (err: any) => {
        assert.equal(err.code, '23505');
        return true;
      },
    );
  });

  test('concurrent submissions yield exactly one review', async () => {
    const bookingId = await completedBooking();

    const results = await Promise.all(
      [1, 2, 3].map(() => call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA)),
    );
    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(created.length, 1, 'exactly one request may create the review');
    assert.equal(conflicts.length, 2, 'the others must be rejected as duplicates');

    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM reviews WHERE booking_id = $1`,
      [bookingId],
    );
    assert.equal(rows.rows[0].n, 1);
  });
});

/* ------------------------------------------------------------- my reviews -- */

describe('reviews - my reviews', () => {
  test('GET /reviews/my returns only the caller own reviews', async () => {
    const bookingId = await completedBooking();
    await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);

    const mine = await call('GET', '/reviews/my', undefined, tokenCustomerA);
    assert.equal(mine.status, 200);
    assert.ok(Array.isArray(mine.data.reviews));
    assert.ok(mine.data.reviews.some((r: any) => r.bookingId === bookingId));

    const theirs = await call('GET', '/reviews/my', undefined, tokenCustomerB);
    assert.ok(
      !theirs.data.reviews.some((r: any) => r.bookingId === bookingId),
      'customer B must never see customer A review',
    );
  });

  test('GET /reviews/my is an empty array for a customer with no reviews', async () => {
    const res = await call('GET', '/reviews/my', undefined, tokenCustomerB);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.reviews, []);
  });

  test('a review never exposes customer identity', async () => {
    const res = await call('GET', '/reviews/my', undefined, tokenCustomerA);
    const text = JSON.stringify(res.data);
    for (const leak of ['customerId', 'customer_id', 'password', 'token', 'session']) {
      assert.ok(!text.includes(leak), `my-reviews response leaked: ${leak}`);
    }
  });
});

/* --------------------------------------------------------- public surface -- */

describe('reviews - public provider profile', () => {
  test('a review raises the provider rating average and count', async () => {
    const bookingId = await completedBooking();
    await call('POST', '/reviews', { bookingId, rating: 5 }, tokenCustomerA);

    const profile = await call('GET', `/providers/${providerAId}`);
    assert.equal(profile.status, 200);
    const { rating, reviewCount } = profile.data.provider;
    assert.equal(typeof rating, 'number');
    assert.ok(reviewCount >= 1);
    assert.ok(rating >= 1 && rating <= 5, 'the average must stay within 1..5');
  });

  test('public reviews expose exactly rating, comment and date', async () => {
    const profile = await call('GET', `/providers/${providerAId}`);
    const reviews = profile.data.provider.reviews as any[];
    assert.ok(reviews.length > 0);
    for (const review of reviews) {
      assert.deepEqual(
        Object.keys(review).sort(),
        ['comment', 'createdAt', 'rating'],
        'a public review must be exactly rating/comment/createdAt',
      );
    }
  });

  test('the public review payload never contains customer PII', async () => {
    const profile = await call('GET', `/providers/${providerAId}`);
    const text = JSON.stringify(profile.data.provider.reviews);
    for (const leak of [
      'customerId',
      'customer_id',
      emails.customerA,
      'password',
      'token',
      'bookingId',
      'booking_id',
    ]) {
      assert.ok(!text.includes(leak), `public reviews leaked: ${leak}`);
    }
  });

  test('public review reads need no authentication', async () => {
    assert.equal((await call('GET', `/providers/${providerAId}`)).status, 200);
  });

  test('a provider with zero reviews reports null rating, never NaN', async () => {
    const email = `rv-solo-${runId}@example.com`;
    const reg = await call('POST', '/auth/register', {
      email,
      password: 'ReviewTest123!',
      fullName: 'Solo Provider',
      role: 'PROVIDER',
      provider: { businessName: `Solo Plumbing ${runId}`, city: 'Springfield' },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    await call('PATCH', `/admin/providers/${reg.data.user.id}/approve`, {}, adminToken);

    const profile = await call('GET', `/providers/${reg.data.user.id}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.provider.reviewCount, 0);
    // null, not NaN - the client renders "New to ServiceConnect" for null.
    assert.equal(profile.data.provider.rating, null);
    assert.ok(!Number.isNaN(profile.data.provider.rating));
    assert.deepEqual(profile.data.provider.reviews, []);
  });

  test('an unknown provider is a normal 404', async () => {
    const res = await call('GET', '/providers/99999999-9999-4999-8999-999999999999');
    assert.equal(res.status, 404);
  });
});
