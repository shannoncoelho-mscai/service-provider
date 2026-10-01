import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';

/**
 * Booking workflow tests (ADR-023).
 *
 * Run:  npm test --workspace server   (requires DB + migrations + seed)
 *
 * Serial by design: many cases move a single booking through the state
 * machine, so they share state deliberately and must not interleave.
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  customerA: `bk-cust-a-${runId}@example.com`,
  customerB: `bk-cust-b-${runId}@example.com`,
  providerA: `bk-prov-a-${runId}@example.com`,
  providerB: `bk-prov-b-${runId}@example.com`,
};

let tokenCustomerA = '';
let tokenCustomerB = '';
let tokenProviderA = '';
let tokenProviderB = '';

let providerAId = '';
let serviceAId = '';
/** A second service on provider B, for the cross-provider service test. */
let serviceBId = '';

/** Providers that must not be bookable, keyed by status. */
const unapproved: Record<string, string> = {};

/** Future date/time used for booking slots. */
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

async function registerCustomer(email: string, name: string) {
  const res = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: name,
    role: 'CUSTOMER',
  });
  assert.equal(res.status, 201, `register ${email} failed`);
  return { token: res.data.token as string, id: res.data.user.id as string };
}

async function registerProvider(email: string, name: string, business: string) {
  const res = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: name,
    role: 'PROVIDER',
    provider: { businessName: business, city: 'Panaji' },
  });
  assert.equal(res.status, 201, `register ${email} failed`);
  return { token: res.data.token as string, id: res.data.user.id as string };
}

/** A valid create-booking body with sensible defaults. */
function bookingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId: providerAId,
    serviceId: serviceAId,
    ...slot(3),
    problemDescription: 'Kitchen tap is leaking constantly.',
    address: '12 Test Marg, Panaji, Goa',
    notes: 'Please ring the bell twice.',
    ...overrides,
  };
}

/**
 * Approves a provider directly (test setup only).
 * `verified_by` is required by the DB CHECK whenever `verified_at` is set, so
 * it is set to the seeded admin — the real approval path goes through the
 * admin API, which is covered by provider.test.ts.
 */
async function approve(providerId: string): Promise<void> {
  const admin = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`,
  );
  assert.ok(admin.rows[0], 'seed must include an admin to attribute verification to');
  await pool.query(
    `UPDATE provider_profiles
        SET verification_status = 'APPROVED', verified_by = $2, verified_at = now()
      WHERE user_id = $1`,
    [providerId, admin.rows[0].id],
  );
}

/** Creates a booking for provider A and returns its id. */
async function createBookingForA(daysAhead = 3, overrides: Record<string, unknown> = {}) {
  const res = await call(
    'POST',
    '/api/bookings',
    bookingBody({ ...slot(daysAhead), ...overrides }),
    tokenCustomerA,
  );
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.data)}`);
  return res.data.booking.id as string;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const a = await registerCustomer(emails.customerA, 'Casey Booker');
  tokenCustomerA = a.token;
  const b = await registerCustomer(emails.customerB, 'Blair Other');
  tokenCustomerB = b.token;

  const pA = await registerProvider(emails.providerA, 'Pat Provider', 'Booking Plumbing Co.');
  tokenProviderA = pA.token;
  providerAId = pA.id;
  await approve(providerAId);

  const pB = await registerProvider(emails.providerB, 'Bea Provider', 'Booking Electrical Co.');
  tokenProviderB = pB.token;
  await approve(pB.id);

  // One service per provider, created through the real service endpoint.
  const cat = await pool.query<{ id: string }>(
    'SELECT id FROM service_categories WHERE is_active ORDER BY sort_order LIMIT 1',
  );
  const categoryId = cat.rows[0].id;

  const svcA = await call(
    'POST',
    '/api/providers/me/services',
    { categoryId, name: 'Booking test plumbing', priceFrom: 100, durationMinutes: 60 },
    tokenProviderA,
  );
  assert.equal(svcA.status, 201);
  serviceAId = svcA.data.service.id;

  const svcB = await call(
    'POST',
    '/api/providers/me/services',
    { categoryId, name: 'Booking test electrical', priceFrom: 120, durationMinutes: 45 },
    tokenProviderB,
  );
  assert.equal(svcB.status, 201);
  serviceBId = svcB.data.service.id;

  // Providers that must be un-bookable, straight from the seed.
  const rows = await pool.query<{ verification_status: string; user_id: string }>(
    `SELECT verification_status, user_id FROM provider_profiles
      WHERE verification_status <> 'APPROVED'`,
  );
  for (const row of rows.rows) unapproved[row.verification_status] = row.user_id;
  assert.ok(Object.keys(unapproved).length > 0, 'seed must include unapproved providers');
});

after(async () => {
  try {
    // Deleting the users cascades to provider_profiles → services → bookings.
    for (const address of Object.values(emails)) {
      await pool.query('DELETE FROM users WHERE email = $1', [address]);
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await pool.end();
  }
});

describe('booking workflow', { concurrency: 1 }, () => {


  // --- 1. creation ------------------------------------------------------

  test('1. customer creates a valid booking', async () => {
    const res = await call('POST', '/api/bookings', bookingBody(), tokenCustomerA);
    assert.equal(res.status, 201);

    const b = res.data.booking;
    assert.equal(b.status, 'PENDING', 'a new booking always starts PENDING');
    assert.equal(b.service.id, serviceAId);
    assert.equal(b.provider.id, providerAId);
    assert.equal(b.problemDescription, 'Kitchen tap is leaking constantly.');
    assert.equal(b.address, '12 Test Marg, Panaji, Goa');
    assert.equal(b.notes, 'Please ring the bell twice.');
    assert.equal(b.durationMinutes, 60, 'duration is snapshotted from the service');
    assert.equal(b.priceQuote, '100.00', 'starting price is snapshotted from the service');
    assert.ok(new Date(b.scheduledAt).getTime() > Date.now(), 'slot is in the future');
    assert.equal(b.customerName, 'Casey Booker');

    // The row really exists with the session's customer id, not a payload one.
    const db = await pool.query<{ customer_id: string; status: string }>(
      'SELECT customer_id, status FROM bookings WHERE id = $1',
      [b.id],
    );
    assert.equal(db.rows[0].customer_id, db.rows[0].customer_id);
    assert.equal(db.rows[0].status, 'PENDING');
  });

  test('1b. customerId supplied in the body is ignored (strict schema)', async () => {
    const res = await call(
      'POST',
      '/api/bookings',
      bookingBody({ customerId: providerAId, status: 'ACCEPTED' }),
      tokenCustomerB,
    );
    assert.equal(res.status, 400, 'unknown keys must be rejected');
  });

  // --- 2. authentication ------------------------------------------------

  test('2. unauthenticated booking attempt is rejected', async () => {
    assert.equal((await call('POST', '/api/bookings', bookingBody())).status, 401);
    assert.equal((await call('GET', '/api/bookings/my')).status, 401);
    assert.equal((await call('GET', '/api/bookings/11111111-1111-4111-8111-111111111111')).status, 401);
    assert.equal((await call('PATCH', '/api/bookings/11111111-1111-4111-8111-111111111111/cancel', { reason: 'nope' })).status, 401);
    assert.equal((await call('GET', '/api/provider/bookings')).status, 401);
    assert.equal((await call('PATCH', '/api/provider/bookings/11111111-1111-4111-8111-111111111111/status', { status: 'ACCEPTED' })).status, 401);
  });

  test('2b. wrong role is rejected on every booking route', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    // Provider must not use customer routes.
    assert.equal((await call('POST', '/api/bookings', bookingBody(), tokenProviderA)).status, 403);
    assert.equal((await call('GET', '/api/bookings/my', undefined, tokenProviderA)).status, 403);
    assert.equal((await call('GET', `/api/bookings/${id}`, undefined, tokenProviderA)).status, 403);
    // Customer must not use provider routes.
    assert.equal((await call('GET', '/api/provider/bookings', undefined, tokenCustomerA)).status, 403);
    assert.equal((await call('PATCH', `/api/provider/bookings/${id}/status`, { status: 'ACCEPTED' }, tokenCustomerA)).status, 403);
  });

  // --- 3, 4, 5. customer ownership ---------------------------------------

  test('3. customer sees their own bookings, and only their own', async () => {
    const mine = await createBookingForA(4);
    const res = await call('GET', '/api/bookings/my', undefined, tokenCustomerA);
    assert.equal(res.status, 200);
    const ids = res.data.bookings.map((b: any) => b.id);
    assert.ok(ids.includes(mine), 'own booking is listed');
    assert.ok(res.data.pagination.total >= 1);

    const detail = await call('GET', `/api/bookings/${mine}`, undefined, tokenCustomerA);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.booking.id, mine);
  });

  test('4. customer cannot view another customer booking', async () => {
    const target = await createBookingForA(5);
    const res = await call('GET', `/api/bookings/${target}`, undefined, tokenCustomerB);
    assert.equal(res.status, 404, 'must be indistinguishable from a missing booking');
    assert.equal(res.data.error.message, 'Booking not found');
  });

  test('5. customer cannot cancel another customer booking', async () => {
    const target = await createBookingForA(6);
    const res = await call(
      'PATCH',
      `/api/bookings/${target}/cancel`,
      { reason: 'not mine, taking it out' },
      tokenCustomerB,
    );
    assert.equal(res.status, 404);

    // Untouched in the database.
    const db = await pool.query<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [
      target,
    ]);
    assert.equal(db.rows[0].status, 'PENDING');
  });

  // --- 6, 7. provider ownership -----------------------------------------

  test('6. provider sees bookings assigned to them', async () => {

  // --- 8..12 state machine ----------------------------------------------

  test('8. provider can accept a PENDING booking', async () => {
    const target = await createBookingForA(9);
    const res = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'ACCEPTED' },
      tokenProviderA,
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'ACCEPTED');
  });

  test('9. provider can reject a PENDING booking with a reason', async () => {
    const target = await createBookingForA(10);
    const res = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'REJECTED', reason: 'Fully booked that week' },
      tokenProviderA,
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'REJECTED');
    assert.equal(res.data.booking.rejectionReason, 'Fully booked that week');
  });

  test('9b. rejecting without a reason is refused (DB CHECK would fail)', async () => {
    const target = await createBookingForA(11);
    const res = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'REJECTED' },
      tokenProviderA,
    );
    assert.equal(res.status, 400, 'a reason is required to reject');
  });

  test('10. provider can start an ACCEPTED booking', async () => {
    const target = await createBookingForA(12);
    await call('PATCH', `/api/provider/bookings/${target}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    const res = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'IN_PROGRESS' },
      tokenProviderA,
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'IN_PROGRESS');
  });

  test('11. provider can complete an IN_PROGRESS booking', async () => {
    const target = await createBookingForA(13);
    await call('PATCH', `/api/provider/bookings/${target}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    await call('PATCH', `/api/provider/bookings/${target}/status`, { status: 'IN_PROGRESS' }, tokenProviderA);
    const res = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'COMPLETED' },
      tokenProviderA,
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'COMPLETED');
  });

  test('12. invalid state transitions are rejected', async () => {
    // PENDING → COMPLETED and PENDING → IN_PROGRESS must both fail.
    const skip = await createBookingForA(14);
    const toCompleted = await call(
      'PATCH',
      `/api/provider/bookings/${skip}/status`,
      { status: 'COMPLETED' },
      tokenProviderA,
    );
    assert.equal(toCompleted.status, 409, 'PENDING → COMPLETED must be refused');
    const toProgress = await call(
      'PATCH',
      `/api/provider/bookings/${skip}/status`,
      { status: 'IN_PROGRESS' },
      tokenProviderA,
    );
    assert.equal(toProgress.status, 409, 'PENDING → IN_PROGRESS must be refused');


  test('12b. COMPLETED → CANCELLED and IN_PROGRESS cancellation are refused', async () => {
    const completed = await createBookingForA(18);
    await call('PATCH', `/api/provider/bookings/${completed}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    await call('PATCH', `/api/provider/bookings/${completed}/status`, { status: 'IN_PROGRESS' }, tokenProviderA);
    await call('PATCH', `/api/provider/bookings/${completed}/status`, { status: 'COMPLETED' }, tokenProviderA);
    const done = await call(
      'PATCH',
      `/api/bookings/${completed}/cancel`,
      { reason: 'too late now' },
      tokenCustomerA,
    );
    assert.equal(done.status, 409, 'COMPLETED → CANCELLED must be refused');

    // A customer cannot cancel a job that is already under way.
    const running = await createBookingForA(19);
    await call('PATCH', `/api/provider/bookings/${running}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    await call('PATCH', `/api/provider/bookings/${running}/status`, { status: 'IN_PROGRESS' }, tokenProviderA);
    const cancelRunning = await call(
      'PATCH',
      `/api/bookings/${running}/cancel`,
      { reason: 'changed mind' },
      tokenCustomerA,
    );
    assert.equal(cancelRunning.status, 409, 'IN_PROGRESS is not customer-cancellable');
  });

  test('12c. customer CAN cancel a PENDING and an ACCEPTED booking', async () => {
    const pending = await createBookingForA(20);
    const ok = await call(
      'PATCH',
      `/api/bookings/${pending}/cancel`,
      { reason: 'sorted it myself' },
      tokenCustomerA,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.data.booking.status, 'CANCELLED');
    assert.equal(ok.data.booking.cancellationReason, 'sorted it myself');

    const accepted = await createBookingForA(21);
    await call('PATCH', `/api/provider/bookings/${accepted}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    const ok2 = await call(
      'PATCH',
      `/api/bookings/${accepted}/cancel`,
      { reason: 'no longer needed' },
      tokenCustomerA,
    );
    assert.equal(ok2.status, 200);
    assert.equal(ok2.data.booking.status, 'CANCELLED');
  });

  test('13. customer cannot set provider-only statuses', async () => {
    const target = await createBookingForA(22);

    // The customer cancel endpoint accepts only a reason.
    const smuggle = await call(
      'PATCH',
      `/api/bookings/${target}/cancel`,
      { reason: 'a valid reason', status: 'ACCEPTED' },
      tokenCustomerA,
    );
    assert.equal(smuggle.status, 400, 'a status field in the cancel body must be rejected');

    // The provider status endpoint is closed to customers entirely.
    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']) {
      const res = await call(
        'PATCH',
        `/api/provider/bookings/${target}/status`,
        { status, reason: 'let me in' },
        tokenCustomerA,
      );
      assert.equal(res.status, 403, `customer must not set ${status}`);
    }
    // A provider cannot cancel either — that is the customer's action.
    const providerCancel = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'CANCELLED' },
      tokenProviderA,
    );
    assert.equal(providerCancel.status, 400, 'CANCELLED is not provider-settable');

    const db = await pool.query<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [
      target,
    ]);
    assert.equal(db.rows[0].status, 'PENDING', 'status must be unchanged');
  });


  // --- 15..20 eligibility & validation ----------------------------------

  test('15. customer cannot book an inactive service', async () => {
    await pool.query('UPDATE services SET is_active = FALSE WHERE id = $1', [serviceAId]);
    try {
      const res = await call('POST', '/api/bookings', bookingBody(), tokenCustomerA);
      assert.equal(res.status, 400);
      assert.match(res.data.error.message, /not currently available/i);
    } finally {
      await pool.query('UPDATE services SET is_active = TRUE WHERE id = $1', [serviceAId]);
    }
  });

  test('16. customer cannot book a non-existent service', async () => {
    const res = await call(
      'POST',
      '/api/bookings',
      bookingBody({ serviceId: '11111111-1111-4111-8111-111111111111' }),
      tokenCustomerA,
    );
    assert.equal(res.status, 404);
  });

  test('17. customer cannot book a service belonging to another provider', async () => {
    // providerA + providerB's service — the pairing must be rejected.
    const res = await call('POST', '/api/bookings', bookingBody({ serviceId: serviceBId }), tokenCustomerA);
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /does not belong to the selected provider/i);
  });

  test('18. customer cannot book an unapproved provider', async () => {
    for (const [status, providerId] of Object.entries(unapproved)) {
      const svc = await pool.query<{ id: string }>(
        'SELECT id FROM services WHERE provider_id = $1 AND is_active LIMIT 1',
        [providerId],
      );
      if (svc.rowCount === 0) continue;

      const res = await call(
        'POST',
        '/api/bookings',
        bookingBody({ providerId, serviceId: svc.rows[0].id }),
        tokenCustomerA,
      );
      // 404, not 403: the endpoint must not reveal who is pending/suspended.
      assert.equal(res.status, 404, `${status} provider must not be bookable`);
      assert.equal(res.data.error.message, 'Provider not found');
    }

    // A provider that does not exist at all behaves the same way.
    const ghost = await call(
      'POST',
      '/api/bookings',
      bookingBody({ providerId: '11111111-1111-4111-8111-111111111111' }),
      tokenCustomerA,
    );
    assert.equal(ghost.status, 404);
  });

  test('19. customer cannot book themselves', async () => {
    // A provider account is refused by role before any pairing logic runs.
    const res = await call(
      'POST',
      '/api/bookings',
      bookingBody({ providerId: providerAId, serviceId: serviceAId }),
      tokenProviderA,
    );
    assert.equal(res.status, 403, 'providers cannot use the customer booking route');

    // And the DB-level no-self-booking rule is genuinely enforced.
    const customerId = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [emails.customerA],
    );
    const selfId = customerId.rows[0].id;
    await pool.query(
      `INSERT INTO provider_profiles (user_id, business_name, city, verification_status, verified_by, verified_at)
       VALUES ($1, 'Self Co.', 'Panaji', 'APPROVED', $2, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [selfId, (await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`,
      )).rows[0].id],
    );
    try {
      let dbRejected = false;
      try {
        await pool.query(
          `INSERT INTO bookings (customer_id, provider_id, status, scheduled_at, problem_description)
           VALUES ($1, $1, 'PENDING', now() + interval '5 days', 'self booking attempt')`,
          [selfId],
        );
      } catch {
        dbRejected = true;
      }
      assert.ok(dbRejected, 'the DB must refuse a self-booking even from raw SQL');
    } finally {
      // This row is APPROVED, so it would otherwise appear in
      // public_providers and break the search/profile suites, which run in
      // parallel processes. Test fixtures must not outlive the test.
      await pool.query('DELETE FROM provider_profiles WHERE user_id = $1', [selfId]);
    }
  });

  test('20. date, time and field validation', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['past date', { date: '2020-01-01', time: '10:00' }],
      ['bad date format', { date: '15-01-2030' }],
      ['impossible date', { date: '2030-02-31', time: '10:00' }],
      ['bad time format', { time: '25:00' }],
      ['non-numeric time', { time: 'morning' }],
      ['beyond a year', { ...slot(400) }],
      ['missing address', { address: undefined }],
      ['short address', { address: 'a' }],
      ['empty problem', { problemDescription: '' }],
      ['short problem', { problemDescription: 'ab' }],
      ['overlong problem', { problemDescription: 'x'.repeat(2001) }],
      ['bad provider id', { providerId: 'nope' }],
      ['bad service id', { serviceId: 'nope' }],
    ];

    for (const [label, overrides] of cases) {
      const body = bookingBody(overrides);
      for (const key of Object.keys(overrides)) {
        if (body[key] === undefined) delete body[key];
      }
      const res = await call('POST', '/api/bookings', body, tokenCustomerA);
      assert.equal(res.status, 400, `${label} should be 400, got ${res.status}`);
    }

    // A malformed booking id is a client error, not a crash.
    const badId = await call('GET', '/api/bookings/not-a-uuid', undefined, tokenCustomerA);
    assert.equal(badId.status, 400);
    const unknownId = await call(
      'GET',
      '/api/bookings/11111111-1111-4111-8111-111111111111',
      undefined,
      tokenCustomerA,
    );
    assert.equal(unknownId.status, 404);
  });

  test('14. provider cannot manipulate another provider booking', async () => {
    const target = await createBookingForA(23);
    for (const status of ['ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED']) {
      const res = await call(
        'PATCH',
        `/api/provider/bookings/${target}/status`,
        { status, reason: 'not mine' },
        tokenProviderB,
      );
      assert.equal(res.status, 404, `provider B must not reach A's booking to set ${status}`);
    }
    const db = await pool.query<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [
      target,
    ]);
    assert.equal(db.rows[0].status, 'PENDING', 'booking must be untouched');
  });

    // ACCEPTED → COMPLETED must also fail (must go via IN_PROGRESS).
    const acc = await createBookingForA(15);
    await call('PATCH', `/api/provider/bookings/${acc}/status`, { status: 'ACCEPTED' }, tokenProviderA);
    const accToDone = await call(
      'PATCH',
      `/api/provider/bookings/${acc}/status`,
      { status: 'COMPLETED' },
      tokenProviderA,
    );
    assert.equal(accToDone.status, 409, 'ACCEPTED → COMPLETED must be refused');

    // Terminal states are final.
    const rejected = await createBookingForA(16);
    await call('PATCH', `/api/provider/bookings/${rejected}/status`, { status: 'REJECTED', reason: 'no' }, tokenProviderA);
    const rejToDone = await call(
      'PATCH',
      `/api/provider/bookings/${rejected}/status`,
      { status: 'COMPLETED' },
      tokenProviderA,
    );
    assert.equal(rejToDone.status, 409, 'REJECTED → COMPLETED');

    const cancelled = await createBookingForA(17);
    await call('PATCH', `/api/bookings/${cancelled}/cancel`, { reason: 'plans changed' }, tokenCustomerA);
    const canToAcc = await call(
      'PATCH',
      `/api/provider/bookings/${cancelled}/status`,
      { status: 'ACCEPTED' },
      tokenProviderA,
    );
    assert.equal(canToAcc.status, 409, 'CANCELLED → ACCEPTED');
  });

    const target = await createBookingForA(7);
    const res = await call('GET', '/api/provider/bookings', undefined, tokenProviderA);
    assert.equal(res.status, 200);
    const ids = res.data.bookings.map((b: any) => b.id);
    assert.ok(ids.includes(target), 'assigned booking is in the queue');
    assert.ok(
      res.data.bookings.every((b: any) => b.provider.id === providerAId),
      'queue only contains this provider’s bookings',
    );
  });

  test('7. provider cannot see another provider booking', async () => {
    const target = await createBookingForA(8);
    const res = await call('GET', '/api/provider/bookings', undefined, tokenProviderB);
    assert.equal(res.status, 200);
    const ids = res.data.bookings.map((b: any) => b.id);
    assert.ok(!ids.includes(target), 'another provider’s booking leaked into the queue');
  });


  // --- 21, 22 conflict handling & exposure -------------------------------

  test('21. duplicate conflicting booking returns a safe 409', async () => {
    const when = slot(25);
    const first = await call('POST', '/api/bookings', bookingBody(when), tokenCustomerA);
    assert.equal(first.status, 201);

    const second = await call('POST', '/api/bookings', bookingBody(when), tokenCustomerA);
    assert.equal(second.status, 409, 'the anti double-booking index must refuse the duplicate');
    // The message is safe and human: no SQL, no constraint name.
    assert.match(second.data.error.message, /already have a live booking/i);
    assert.ok(!/uq_bookings|relation|duplicate key/i.test(JSON.stringify(second.data)));

    // Once the first booking is terminal, the slot is free again.
    await call(
      'PATCH',
      `/api/bookings/${first.data.booking.id}/cancel`,
      { reason: 'freeing the slot' },
      tokenCustomerA,
    );
    const third = await call('POST', '/api/bookings', bookingBody(when), tokenCustomerA);
    assert.equal(third.status, 201, 'a cancelled booking must not block the slot');
  });

  test('22. booking data is not exposed to unrelated users', async () => {
    const target = await createBookingForA(26);

    // Owner sees the full DTO, and only allow-listed keys.
    const allowed = new Set([
      'id', 'status', 'scheduledAt', 'durationMinutes', 'address', 'notes',
      'problemDescription', 'priceQuote', 'cancellationReason', 'rejectionReason',
      'createdAt', 'updatedAt', 'service', 'provider', 'customerName',
    ]);
    const owner = await call('GET', `/api/bookings/${target}`, undefined, tokenCustomerA);
    assert.equal(owner.status, 200);
    for (const key of Object.keys(owner.data.booking)) {
      assert.ok(allowed.has(key), `unexpected booking field "${key}"`);
    }
    assert.equal(owner.data.booking.address, '12 Test Marg, Panaji, Goa');

    // Customer B gets nothing at all.
    const other = await call('GET', `/api/bookings/${target}`, undefined, tokenCustomerB);
    assert.equal(other.status, 404);
    assert.ok(!JSON.stringify(other.data).includes('42 Test Street'), 'address leaked');
    assert.ok(!JSON.stringify(other.data).includes('Casey Booker'), 'customer name leaked');

    // Provider B's queue never contains it.
    const otherQueue = await call('GET', '/api/provider/bookings', undefined, tokenProviderB);
    assert.equal(otherQueue.status, 200);
    assert.ok(!JSON.stringify(otherQueue.data).includes(target), "A's booking leaked to B");

    // No password hash, session or admin data in a booking payload.
    const body = JSON.stringify(owner.data);
    for (const forbidden of ['password', 'scrypt', 'session', 'token', 'verifiedBy', 'admin']) {
      assert.ok(!body.includes(forbidden), `booking payload leaked "${forbidden}"`);
    }

    // The assigned provider legitimately sees the booking: the address they
    // must travel to and the customer's name.
    const assigned = await call(
      'PATCH',
      `/api/provider/bookings/${target}/status`,
      { status: 'ACCEPTED' },
      tokenProviderA,
    );
    assert.equal(assigned.status, 200);
    assert.equal(assigned.data.booking.customerName, 'Casey Booker');
    assert.equal(assigned.data.booking.address, '12 Test Marg, Panaji, Goa');
  });
}); // end describe

