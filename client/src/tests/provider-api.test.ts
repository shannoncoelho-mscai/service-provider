/**
 * Provider dashboard API contract tests (ADR-026).
 *
 * These assert what actually reaches the network, not what a button is labelled.
 * A provider status request that accidentally carried a `providerId` would be a
 * privilege-escalation surface; a rejection without its mandatory `reason`
 * would be a guaranteed 400. Both are caught here.
 *
 * `fetch` is stubbed; no server or database is involved.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  ApiError,
  getMyProviderProfile,
  listProviderBookings,
  updateProviderBookingStatus,
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

const BOOKING = {
  id: 'b1',
  status: 'PENDING',
  scheduledAt: '2026-12-01T14:00:00.000Z',
  durationMinutes: 90,
  address: '42 Maple Street',
  notes: 'Buzzer is broken',
  problemDescription: 'Tap is dripping',
  priceQuote: '90.00',
  cancellationReason: null,
  rejectionReason: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  service: { id: 's1', name: 'Plumbing' },
  provider: { id: 'p1', businessName: 'Acme Plumbing' },
  customerName: 'Alex Morgan',
};

const PROFILE = {
  userId: 'p1',
  businessName: 'Acme Plumbing',
  description: null,
  phone: '+1 555 0101',
  city: 'Springfield',
  address: null,
  serviceAreas: ['Springfield'],
  yearsExperience: 9,
  hourlyRate: '80.00',
  profileImageUrl: null,
  coverImageUrl: null,
  verificationStatus: 'APPROVED',
  isPublic: true,
  verifiedBy: 'a1',
  verifiedAt: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

afterEach(() => {
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});

/* ------------------------------------------------------------- the queue -- */

describe('listProviderBookings', () => {
  it('GETs the provider queue and returns bookings with the server total', async () => {
    stubFetch(200, { bookings: [BOOKING], pagination: { page: 1, pageSize: 50, total: 37 } });
    const data = await listProviderBookings();

    assert.ok(calls[0].url.startsWith('/api/provider/bookings'));
    assert.equal(calls[0].method, 'GET');
    assert.equal(data.bookings.length, 1);
    // The total must come from the server, not the capped array length.
    assert.equal(data.pagination.total, 37);
  });

  it('never asks the server to filter — the client filters in memory', async () => {
    stubFetch(200, { bookings: [], pagination: { page: 1, pageSize: 50, total: 0 } });
    await listProviderBookings();
    assert.ok(!calls[0].url.includes('status='), 'tab switching must not re-request');
  });

  it('surfaces a 403 as an ApiError', async () => {
    stubFetch(403, { error: { message: 'Provider role required' } });
    await assert.rejects(
      () => listProviderBookings(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });
});

describe('getMyProviderProfile', () => {
  /**
   * The response wrapper for `GET /api/providers/me` is `{ profile, user }` —
   * see `providers.service.ts#getMyProfile`, which the route sends verbatim.
   * The public `GET /api/providers/:id` uses `{ provider }`, a different key.
   *
   * This fixture previously stubbed `{ provider: PROFILE }`, mirroring the
   * client's own wrong assumption, so it passed while the real app returned
   * `undefined` and the provider dashboard crashed on render. Stubs must copy
   * the SERVER's shape, not the client's expectation of it.
   */
  const meResponse = () => ({
    profile: PROFILE,
    user: { fullName: 'Rajesh Naik', email: 'contact@ganpatiacqua.example.com' },
  });

  it('GETs /providers/me and unwraps the "profile" key', async () => {
    stubFetch(200, meResponse());
    const profile = await getMyProviderProfile();

    assert.equal(calls[0].url, '/api/providers/me');
    assert.equal(calls[0].method, 'GET');
    assert.equal(profile.verificationStatus, 'APPROVED');
    assert.equal(profile.isPublic, true);
    assert.equal(profile.businessName, 'Acme Plumbing');
  });

  it('REGRESSION: reads "profile", not "provider" (the key that crashed the dashboard)', async () => {
    stubFetch(200, meResponse());
    const profile = await getMyProviderProfile();

    // With the old `data.provider` accessor this was `undefined`, and the
    // dashboard then threw on `profile.verificationStatus`.
    assert.notEqual(profile, undefined, 'the accessor must not return undefined');
    assert.ok(!('provider' in profile), 'the profile must be unwrapped, not the wrapper');
    assert.equal(typeof profile.verificationStatus, 'string');
  });

  it('surfaces every verification status the server can return', async () => {
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const) {
      stubFetch(200, { ...meResponse(), profile: { ...PROFILE, verificationStatus: status } });
      const profile = await getMyProviderProfile();
      assert.equal(profile.verificationStatus, status);
    }
  });

  it('throws instead of returning undefined for a malformed payload', async () => {
    // A contract violation must become a catchable error so the caller renders
    // its error state, never `undefined` flowing into a render.
    for (const body of [{}, { profile: null }, { provider: PROFILE }, null]) {
      stubFetch(200, body);
      await assert.rejects(
        () => getMyProviderProfile(),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          return true;
        },
        `payload ${JSON.stringify(body)} must not resolve to undefined`,
      );
    }
  });
});

/* --------------------------------------------------- the status workflow -- */

describe('updateProviderBookingStatus', () => {
  it('PATCHes the provider status endpoint with ONLY the status', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'ACCEPTED' } });
    const result = await updateProviderBookingStatus('b1', 'ACCEPTED');

    assert.equal(calls[0].url, '/api/provider/bookings/b1/status');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(result.status, 'ACCEPTED');
    assert.deepEqual(JSON.parse(calls[0].body!), { status: 'ACCEPTED' });
  });

  it('NEVER sends a providerId — the provider is the session user', async () => {
    stubFetch(200, { booking: BOOKING });
    await updateProviderBookingStatus('b1', 'IN_PROGRESS');

    const sent = JSON.parse(calls[0].body!);
    for (const forbidden of ['providerId', 'provider_id', 'userId', 'customerId', 'bookingId']) {
      assert.ok(!(forbidden in sent), `${forbidden} must never be sent by the client`);
    }
  });

  it('sends IN_PROGRESS when starting a service', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'IN_PROGRESS' } });
    const result = await updateProviderBookingStatus('b1', 'IN_PROGRESS');
    assert.deepEqual(JSON.parse(calls[0].body!), { status: 'IN_PROGRESS' });
    assert.equal(result.status, 'IN_PROGRESS');
  });

  it('sends COMPLETED when finishing a job', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'COMPLETED' } });
    const result = await updateProviderBookingStatus('b1', 'COMPLETED');
    assert.deepEqual(JSON.parse(calls[0].body!), { status: 'COMPLETED' });
    assert.equal(result.status, 'COMPLETED');
  });

  it('sends the MANDATORY reason when rejecting', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'REJECTED', rejectionReason: 'Fully booked' } });
    await updateProviderBookingStatus('b1', 'REJECTED', 'Fully booked on that date');

    assert.deepEqual(JSON.parse(calls[0].body!), {
      status: 'REJECTED',
      reason: 'Fully booked on that date',
    });
  });

  it('trims the rejection reason before sending', async () => {
    stubFetch(200, { booking: BOOKING });
    await updateProviderBookingStatus('b1', 'REJECTED', '   Fully booked   ');
    assert.equal(JSON.parse(calls[0].body!).reason, 'Fully booked');
  });

  it('omits an empty reason rather than sending a blank string', async () => {
    stubFetch(200, { booking: BOOKING });
    await updateProviderBookingStatus('b1', 'REJECTED', '   ');
    // The dialog blocks this in the UI; if it ever slipped through, sending
    // `{ status, reason: '' }` would still be worse than sending nothing.
    assert.deepEqual(Object.keys(JSON.parse(calls[0].body!)), ['status']);
  });

  it('surfaces a 409 conflict as an ApiError, without leaking internals', async () => {
    stubFetch(409, { error: { message: 'Cannot move a booking from PENDING to completed' } });
    await assert.rejects(
      () => updateProviderBookingStatus('b1', 'COMPLETED'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.ok(!/relation|pg_|select /i.test(error.message));
        return true;
      },
    );
  });

  it('surfaces a 404 when the booking is not on this provider queue', async () => {
    stubFetch(404, { error: { message: 'Booking not found' } });
    await assert.rejects(
      () => updateProviderBookingStatus('someone-elses', 'ACCEPTED'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});
