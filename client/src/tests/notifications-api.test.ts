/**
 * Notification API contract tests (ADR-029).
 *
 * The important assertion is what the wire does NOT carry: no userId, ever.
 * The server scopes every query to the session, so a client that sent one
 * would at best be ignored and at worst become a way to read another user's
 * notifications.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  ApiError,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api';

interface Call {
  url: string;
  method: string;
  body: string | null;
}

const calls: Call[] = [];

function stubFetch(status: number, payload: unknown) {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const NOTIFICATION = {
  id: 'n1',
  type: 'BOOKING_ACCEPTED',
  title: 'Your booking was accepted',
  message: 'The provider accepted your booking.',
  relatedBookingId: 'b1',
  readAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

afterEach(() => {
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});

describe('listNotifications', () => {
  it('GETs the list with pagination parameters', async () => {
    stubFetch(200, { notifications: [NOTIFICATION], pagination: { page: 1, pageSize: 20, total: 1 } });
    const data = await listNotifications();

    assert.ok(calls[0].url.startsWith('/api/notifications?'));
    assert.ok(calls[0].url.includes('page=1'));
    assert.ok(calls[0].url.includes('pageSize=20'));
    assert.equal(data.notifications.length, 1);
    assert.equal(data.pagination.total, 1);
  });

  it('sends unreadOnly only when asked', async () => {
    stubFetch(200, { notifications: [], pagination: { page: 1, pageSize: 20, total: 0 } });
    await listNotifications({ unreadOnly: true });
    assert.ok(calls[0].url.includes('unreadOnly=true'));

    stubFetch(200, { notifications: [], pagination: { page: 1, pageSize: 20, total: 0 } });
    await listNotifications();
    assert.ok(!calls[0].url.includes('unreadOnly'));
  });

  it('NEVER sends a userId — the server scopes to the session', async () => {
    stubFetch(200, { notifications: [], pagination: { page: 1, pageSize: 20, total: 0 } });
    await listNotifications({ page: 2, pageSize: 50, unreadOnly: true });
    for (const forbidden of ['userId', 'user_id', 'customerId', 'providerId']) {
      assert.ok(!calls[0].url.includes(forbidden), `${forbidden} must never be sent`);
    }
  });
});

describe('getUnreadCount', () => {
  it('returns the count from /unread-count', async () => {
    stubFetch(200, { count: 3 });
    assert.equal(await getUnreadCount(), 3);
    assert.equal(calls[0].url, '/api/notifications/unread-count');
  });

  it('surfaces a 401 as an ApiError', async () => {
    stubFetch(401, { error: { message: 'Unauthenticated' } });
    await assert.rejects(
      () => getUnreadCount(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        return true;
      },
    );
  });
});

describe('markNotificationRead', () => {
  it('PATCHes the read endpoint with an EMPTY body', async () => {
    stubFetch(200, { notification: { ...NOTIFICATION, readAt: '2026-10-01T11:00:00.000Z' } });
    const result = await markNotificationRead('n1');

    assert.equal(calls[0].url, '/api/notifications/n1/read');
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].body!), {});
    assert.ok(result.readAt);
  });

  it('NEVER sends a userId, so a cross-user read is impossible', async () => {
    stubFetch(200, { notification: NOTIFICATION });
    await markNotificationRead('n1');
    for (const forbidden of ['userId', 'user_id', 'id']) {
      assert.ok(!calls[0].body!.includes(forbidden), `${forbidden} must not be sent in the body`);
    }
  });

  it('surfaces a 404 for another user notification', async () => {
    stubFetch(404, { error: { message: 'Notification not found' } });
    await assert.rejects(
      () => markNotificationRead('someone-elses'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe('markAllNotificationsRead', () => {
  it('PATCHes read-all with an empty body and returns the updated count', async () => {
    stubFetch(200, { updated: 4 });
    assert.equal(await markAllNotificationsRead(), 4);
    assert.equal(calls[0].url, '/api/notifications/read-all');
    assert.deepEqual(JSON.parse(calls[0].body!), {});
  });

  it('never sends a userId', async () => {
    stubFetch(200, { updated: 0 });
    await markAllNotificationsRead();
    assert.ok(!calls[0].body!.includes('userId'));
  });
});
