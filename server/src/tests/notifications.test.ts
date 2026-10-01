import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Notification tests (ADR-029).
 *
 * Two halves, deliberately:
 *   1. The notification API itself (scoping, read state, pagination).
 *   2. The booking lifecycle, asserting the right recipient is notified and
 *      that a repeated transition does not notify twice.
 *
 * Run:  npm test --workspace server
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  customerA: `nt-cust-a-${runId}@example.com`,
  customerB: `nt-cust-b-${runId}@example.com`,
  providerA: `nt-prov-a-${runId}@example.com`,
  providerB: `nt-prov-b-${runId}@example.com`,
  admin: `nt-admin-${runId}@example.com`,
};

let tokCustomerA = '';
let tokCustomerB = '';
let tokProviderA = '';
let tokProviderB = '';
let tokAdmin = '';

let providerAId = '';
let serviceAId = '';
let categoryId = '';
let slotCounter = 0;

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

function slot(daysAhead: number, hour = 10): { date: string; time: string } {
  const when = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  when.setUTCHours(hour, 0, 0, 0);
  return {
    date: when.toISOString().slice(0, 10),
    time: `${String(when.getUTCHours()).padStart(2, '0')}:00`,
  };
}

async function createBooking(token = tokCustomerA): Promise<string> {
  const s = slot(5 + (slotCounter += 1));
  const res = await call(
    'POST',
    '/bookings',
    {
      providerId: providerAId,
      serviceId: serviceAId,
      date: s.date,
      time: s.time,
      problemDescription: 'Notification fixture booking.',
      address: '1 Test Street',
    },
    token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.booking.id;
}

async function drive(bookingId: string, path: string[], reason?: string) {
  for (const step of path) {
    const res = await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: step, ...(reason ? { reason } : {}) },
      tokProviderA,
    );
    assert.equal(res.status, 200, `step ${step}: ${JSON.stringify(res.data)}`);
  }
}

/** Notifications of one user, newest first, optionally filtered by type. */
async function mine(token: string, type?: string) {
  const res = await call('GET', '/notifications?pageSize=50', undefined, token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return type ? res.data.notifications.filter((n: any) => n.type === type) : res.data.notifications;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;

  const cat = await pool.query('SELECT id FROM service_categories ORDER BY id LIMIT 1');
  assert.ok(cat.rows[0], 'seeded categories are required for these tests');
  categoryId = cat.rows[0].id;

  for (const [key, email] of [
    ['customerA', emails.customerA],
    ['customerB', emails.customerB],
  ] as const) {
    const res = await call('POST', '/auth/register', {
      email,
      password: 'NotifyTest123!',
      fullName: `Notify ${key}`,
      role: 'CUSTOMER',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    if (key === 'customerA') tokCustomerA = res.data.token;
    else tokCustomerB = res.data.token;
  }

  for (const [key, email, name] of [
    ['providerA', emails.providerA, 'Notify Provider A'],
    ['providerB', emails.providerB, 'Notify Provider B'],
  ] as const) {
    const res = await call('POST', '/auth/register', {
      email,
      password: 'NotifyTest123!',
      fullName: name,
      role: 'PROVIDER',
      provider: { businessName: `Notify Plumbing ${key} ${runId}`, city: 'Springfield' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    if (key === 'providerA') {
      tokProviderA = res.data.token;
      providerAId = res.data.user.id;
    } else {
      tokProviderB = res.data.token;
    }
  }

  // Public registration cannot mint an ADMIN (ADR-016), so insert one directly.
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Notify Admin', 'ADMIN')`,
    [emails.admin, await hashPassword('AdminPass123!')],
  );
  const admin = await call('POST', '/auth/login', {
    email: emails.admin,
    password: 'AdminPass123!',
  });
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
  tokAdmin = admin.data.token;

  for (const id of [providerAId, (await pool.query(
    'SELECT user_id FROM provider_profiles WHERE business_name = $1',
    [`Notify Plumbing providerB ${runId}`],
  )).rows[0].user_id]) {
    await call('PATCH', `/admin/providers/${id}/approve`, {}, tokAdmin);
  }

  const svc = await call(
    'POST',
    '/providers/me/services',
    { name: 'Notify Test Service', categoryId, priceFrom: 50, durationMinutes: 60 },
    tokProviderA,
  );
  assert.equal(svc.status, 201, JSON.stringify(svc.data));
  serviceAId = svc.data.service.id;
});

after(async () => {
  try {
    // Order matters: verified_by is ON DELETE SET NULL, so profiles must go
    // before the admin, or the CHECK (verified_at IS NULL OR verified_by IS NOT
    // NULL) trips.
    await pool.query(
      `DELETE FROM admin_action_log
        WHERE admin_id IN (SELECT id FROM users WHERE email LIKE $1)
           OR target_id IN (SELECT user_id FROM provider_profiles
                             WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      [`%${runId}%`],
    );
    await pool.query(
      `DELETE FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
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

/* ------------------------------------------------------------- the API -- */

describe('notifications - access control', () => {
  test('unauthenticated list returns 401', async () => {
    assert.equal((await call('GET', '/notifications')).status, 401);
  });

  test('unauthenticated unread-count returns 401', async () => {
    assert.equal((await call('GET', '/notifications/unread-count')).status, 401);
  });

  test('an authenticated user can list their own notifications', async () => {
    const bookingId = await createBooking();
    const res = await call('GET', '/notifications', undefined, tokCustomerA);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.notifications));
    assert.ok(res.data.pagination);
    assert.ok(res.data.notifications.some((n: any) => n.relatedBookingId === bookingId));
  });

  test('a customer cannot see provider notifications', async () => {
    await createBooking();
    const provider = await mine(tokProviderA, 'BOOKING_CREATED');
    assert.ok(provider.length > 0, 'the provider must have been notified');
    const customer = await mine(tokCustomerA, 'BOOKING_CREATED');
    // The customer has their own BOOKING_CREATED; the provider's is a different
    // row and must never appear in the customer's list.
    const customerIds = new Set(customer.map((n: any) => n.id));
    for (const n of provider) {
      assert.ok(!customerIds.has(n.id), 'a provider notification leaked to a customer');
    }
  });

  test('a provider cannot see customer notifications', async () => {
    const bookingId = await createBooking();
    await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: 'ACCEPTED' },
      tokProviderA,
    );
    const accepted = await mine(tokCustomerA, 'BOOKING_ACCEPTED');
    assert.ok(accepted.length > 0, 'the customer must have been notified');
    const providerIds = new Set((await mine(tokProviderA)).map((n: any) => n.id));
    for (const n of accepted) {
      assert.ok(!providerIds.has(n.id), 'a customer notification leaked to a provider');
    }
  });

  test('one customer cannot see another customer notifications', async () => {
    const bookingId = await createBooking(tokCustomerA);
    const aIds = new Set((await mine(tokCustomerA)).map((n: any) => n.id));
    const bList = await mine(tokCustomerB);
    for (const n of bList) {
      assert.ok(!aIds.has(n.id), 'customer B saw a customer A notification');
    }
    assert.ok(!bList.some((n: any) => n.relatedBookingId === bookingId));
  });

  test('an admin gets no notifications merely for being an admin', async () => {
    const res = await call('GET', '/notifications', undefined, tokAdmin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.notifications, []);
  });

  test('a userId in the query string is rejected, not honoured', async () => {
    const res = await call(
      'GET',
      `/notifications?userId=${providerAId}`,
      undefined,
      tokCustomerA,
    );
    assert.equal(res.status, 400, 'a client must not be able to name another user');
  });
});

describe('notifications - read state', () => {
  test('unread count reflects the caller own unread rows', async () => {
    const before = (await call('GET', '/notifications/unread-count', undefined, tokCustomerB)).data
      .count;
    const bookingId = await createBooking();
    await call('PATCH', `/provider/bookings/${bookingId}/status`, { status: 'ACCEPTED' }, tokProviderA);
    const after = (await call('GET', '/notifications/unread-count', undefined, tokCustomerB)).data.count;
    assert.equal(after, before, 'another user booking must not change B count');

    const mineCount = (await call('GET', '/notifications/unread-count', undefined, tokCustomerA)).data
      .count;
    assert.ok(mineCount > 0, 'the customer must have unread notifications');
  });

  test('marking an own notification read works and is idempotent', async () => {
    const list = await mine(tokCustomerA);
    const target = list.find((n: any) => n.readAt === null);
    assert.ok(target, 'expected an unread notification');

    const first = await call('PATCH', `/notifications/${target.id}/read`, {}, tokCustomerA);
    assert.equal(first.status, 200);
    assert.ok(first.data.notification.readAt, 'readAt must be set');

    // A second press (a double-click) must not error or change the timestamp.
    const second = await call('PATCH', `/notifications/${target.id}/read`, {}, tokCustomerA);
    assert.equal(second.status, 200);
    assert.equal(
      second.data.notification.readAt,
      first.data.notification.readAt,
      'readAt must not be overwritten',
    );
  });

  test("marking another user's notification read returns 404", async () => {
    const providerList = await mine(tokProviderA);
    const foreign = providerList[0];
    assert.ok(foreign, 'expected a provider notification');
    const res = await call('PATCH', `/notifications/${foreign.id}/read`, {}, tokCustomerA);
    assert.equal(res.status, 404, 'a cross-user read must look like it does not exist');

    // And it must not actually have been marked.
    const still = await mine(tokProviderA);
    assert.equal(still.find((n: any) => n.id === foreign.id).readAt, null);
  });

  test('an unknown notification id returns 404', async () => {
    const res = await call(
      'PATCH',
      '/notifications/99999999-9999-4999-8999-999999999999/read',
      {},
      tokCustomerA,
    );
    assert.equal(res.status, 404);
  });

  test('a non-UUID notification id is a 400, not a database error', async () => {
    const res = await call('PATCH', '/notifications/not-a-uuid/read', {}, tokCustomerA);
    assert.equal(res.status, 400);
  });

  test('read-all affects only the calling user', async () => {
    // Give the provider some unread rows first.
    await createBooking();
    const providerBefore = await mine(tokProviderA);
    assert.ok(providerBefore.some((n: any) => n.readAt === null), 'provider has unread rows');

    const res = await call('PATCH', '/notifications/read-all', {}, tokCustomerA);
    assert.equal(res.status, 200);
    assert.ok(res.data.updated >= 0);

    const providerAfter = await mine(tokProviderA);
    assert.ok(
      providerAfter.some((n: any) => n.readAt === null),
      'mark-all-read must not touch another user notifications',
    );
    for (const n of await mine(tokCustomerA)) {
      assert.ok(n.readAt, 'every one of the caller own rows must now be read');
    }
  });

  test('unreadOnly filters the list', async () => {
    await createBooking();
    const all = await call('GET', '/notifications?pageSize=50', undefined, tokCustomerA);
    const unread = await call('GET', '/notifications?pageSize=50&unreadOnly=true', undefined, tokCustomerA);
    assert.ok(unread.data.notifications.length <= all.data.notifications.length);
    for (const n of unread.data.notifications) {
      assert.equal(n.readAt, null, 'unreadOnly must only return unread rows');
    }
  });

  test('pagination works and reports a true total', async () => {
    const page1 = await call('GET', '/notifications?page=1&pageSize=2', undefined, tokCustomerA);
    assert.equal(page1.status, 200);
    assert.ok(page1.data.notifications.length <= 2);
    assert.equal(page1.data.pagination.pageSize, 2);
    assert.ok(page1.data.pagination.total >= page1.data.notifications.length);

    const page2 = await call('GET', '/notifications?page=2&pageSize=2', undefined, tokCustomerA);
    assert.equal(page2.status, 200);
    const ids1 = page1.data.notifications.map((n: any) => n.id);
    for (const n of page2.data.notifications) {
      assert.ok(!ids1.includes(n.id), 'pages must not overlap');
    }
  });

  test('notifications are newest first', async () => {
    const list = await call('GET', '/notifications?pageSize=50', undefined, tokCustomerA);
    const times = list.data.notifications.map((n: any) => new Date(n.createdAt).getTime());
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i - 1] >= times[i], 'notifications must be ordered newest first');
    }
  });
});

describe('notifications - booking lifecycle', () => {
  test('booking creation notifies the customer and the provider', async () => {
    const before = (await mine(tokCustomerA)).length;
    const bookingId = await createBooking();

    const cust = await mine(tokCustomerA, 'BOOKING_CREATED');
    const prov = await mine(tokProviderA, 'BOOKING_CREATED');
    assert.ok(cust.length > 0, 'the customer must be told their request was sent');
    assert.ok(prov.length > 0, 'the provider must be told about a new request');

    // Both reference the booking that was just created.
    assert.ok(cust.some((n: any) => n.relatedBookingId === bookingId));
    assert.ok(prov.some((n: any) => n.relatedBookingId === bookingId));
    assert.ok((await mine(tokCustomerA)).length > before);
  });

  test('accept notifies the customer only', async () => {
    const bookingId = await createBooking();
    const provBefore = (await mine(tokProviderA)).length;

    await call('PATCH', `/provider/bookings/${bookingId}/status`, { status: 'ACCEPTED' }, tokProviderA);

    const accepted = await mine(tokCustomerA, 'BOOKING_ACCEPTED');
    assert.ok(accepted.some((n: any) => n.relatedBookingId === bookingId));
    assert.equal(
      (await mine(tokProviderA)).length,
      provBefore,
      'a provider must not be notified of their own action',
    );
  });

  test('reject notifies the customer and explains why', async () => {
    const bookingId = await createBooking();
    await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: 'REJECTED', reason: 'Fully booked that day' },
      tokProviderA,
    );
    const rejected = await mine(tokCustomerA, 'BOOKING_REJECTED');
    const mineRow = rejected.find((n: any) => n.relatedBookingId === bookingId);
    assert.ok(mineRow, 'the customer must be told the booking was declined');
    assert.match(mineRow.message, /Fully booked that day/);
  });

  test('customer cancellation notifies the provider', async () => {
    const bookingId = await createBooking();
    const provBefore = (await mine(tokProviderA, 'BOOKING_CANCELLED')).length;

    const res = await call(
      'PATCH',
      `/bookings/${bookingId}/cancel`,
      { reason: 'no longer needed' },
      tokCustomerA,
    );
    assert.equal(res.status, 200, JSON.stringify(res.data));

    const cancelled = await mine(tokProviderA, 'BOOKING_CANCELLED');
    assert.ok(cancelled.length > provBefore, 'the provider must be told about the cancellation');
    assert.ok(cancelled.some((n: any) => n.relatedBookingId === bookingId));
  });

  test('start notifies the customer', async () => {
    const bookingId = await createBooking();
    await drive(bookingId, ['ACCEPTED', 'IN_PROGRESS']);
    const list = await mine(tokCustomerA, 'BOOKING_IN_PROGRESS');
    assert.ok(list.some((n: any) => n.relatedBookingId === bookingId));
  });

  test('complete notifies the customer', async () => {
    const bookingId = await createBooking();
    await drive(bookingId, ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']);
    const list = await mine(tokCustomerA, 'BOOKING_COMPLETED');
    assert.ok(list.some((n: any) => n.relatedBookingId === bookingId));
  });

  test('a review notifies the provider, anonymously', async () => {
    const bookingId = await createBooking();
    await drive(bookingId, ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']);
    const before = (await mine(tokProviderA, 'REVIEW_SUBMITTED')).length;

    const res = await call(
      'POST',
      '/reviews',
      { bookingId, rating: 5, comment: 'Great work' },
      tokCustomerA,
    );
    assert.equal(res.status, 201, JSON.stringify(res.data));

    const list = await mine(tokProviderA, 'REVIEW_SUBMITTED');
    assert.equal(list.length, before + 1, 'the provider must get exactly one review notification');
    const row = list[0];
    assert.equal(row.relatedBookingId, bookingId);
    // The customer's name must never appear: reviews are anonymous app-wide.
    assert.ok(!JSON.stringify(row).includes(emails.customerA));
    assert.ok(!JSON.stringify(row).includes('Alex'));
  });

  test('a repeated transition notifies nobody twice', async () => {
    const bookingId = await createBooking();
    await call('PATCH', `/provider/bookings/${bookingId}/status`, { status: 'ACCEPTED' }, tokProviderA);
    const afterFirst = (await mine(tokCustomerA, 'BOOKING_ACCEPTED')).filter(
      (n: any) => n.relatedBookingId === bookingId,
    ).length;
    assert.equal(afterFirst, 1);

    // The same transition again: the guarded UPDATE matches no row, so the
    // request 409s and never reaches the notification insert.
    const repeat = await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: 'ACCEPTED' },
      tokProviderA,
    );
    assert.equal(repeat.status, 409);
    assert.equal(
      (await mine(tokCustomerA, 'BOOKING_ACCEPTED')).filter(
        (n: any) => n.relatedBookingId === bookingId,
      ).length,
      1,
      'a repeated transition must not create a second notification',
    );
  });

  test('an invalid transition notifies nobody', async () => {
    const bookingId = await createBooking();
    const before = (await mine(tokCustomerA)).length;
    const res = await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: 'COMPLETED' },
      tokProviderA,
    );
    assert.equal(res.status, 409, 'PENDING -> COMPLETED must be refused');
    assert.equal((await mine(tokCustomerA)).length, before, 'no notification for a refused transition');
  });

  test('a provider cannot be notified about another provider booking', async () => {
    // providerB has no services and no approved queue entry in this fixture, so
    // the check is that providerB never sees providerA rows.
    const provBIds = new Set((await mine(tokProviderB)).map((n: any) => n.id));
    for (const n of await mine(tokProviderA)) {
      assert.ok(!provBIds.has(n.id), 'provider B saw a provider A notification');
    }
  });

  test('notification content carries no credentials or contact details', async () => {
    const bookingId = await createBooking();
    await call('PATCH', `/provider/bookings/${bookingId}/status`, { status: 'ACCEPTED' }, tokProviderA);
    const all = await call('GET', '/notifications?pageSize=50', undefined, tokCustomerA);
    const text = JSON.stringify(all.data.notifications);
    for (const secret of [
      'password',
      'password_hash',
      'token',
      'session',
      emails.customerA,
      '1 Test Street',
    ]) {
      assert.ok(!text.includes(secret), `notification payload leaked: ${secret}`);
    }
  });

  test('the notification is committed with the transition, not before it', async () => {
    // A failed transition must leave NO notification behind: the insert happens
    // inside the same transaction as the guarded UPDATE.
    const bookingId = await createBooking();
    const before = (await mine(tokCustomerA)).length;
    const bad = await call(
      'PATCH',
      `/provider/bookings/${bookingId}/status`,
      { status: 'REJECTED' },
      tokProviderA,
    );
    assert.equal(bad.status, 400, 'rejecting without a reason must fail');
    assert.equal(
      (await mine(tokCustomerA)).length,
      before,
      'a failed transition must not leave a notification behind',
    );
  });

  test('a client cannot choose a notification recipient, type or message', async () => {
    // There is no create endpoint, so a POST is simply not a route.
    const post = await call('POST', '/notifications', {
      userId: providerAId,
      type: 'BOOKING_ACCEPTED',
      title: 'Injected',
      message: 'Injected message',
    }, tokCustomerA);
    assert.equal(post.status, 404, 'there must be no way to create a notification');
  });
});
