/**
/**
 * Booking API contract tests (ADR-024).
 *
 * These are the security-critical client tests: they assert what the browser
 * ACTUALLY puts on the wire. A request that accidentally carried a customerId,
 * a price, or a status on cancel would be a real vulnerability, and a type
 * change alone would not catch it — these assertions would.
 *
 * `fetch` is stubbed; no server or database is involved.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { ApiError, cancelBooking, createBooking, getBooking, listMyBookings } from '../lib/api';

interface Call {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

const calls: Call[] = [];

function stubFetch(status: number, payload: unknown) {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
      headers: (init.headers ?? {}) as Record<string, string>,
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
  notes: null,
  problemDescription: 'Tap is dripping',
  priceQuote: '90.00',
  cancellationReason: null,
  rejectionReason: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  service: { id: 's1', name: 'Plumbing' },
  provider: { id: 'p1', businessName: 'Acme Plumbing' },
  customerName: 'Alex',
};

afterEach(() => {
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});


describe('createBooking', () => {
  it('POSTs to /bookings and unwraps the booking', async () => {
    stubFetch(201, { booking: BOOKING });
    const result = await createBooking({
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
    });

    assert.equal(calls[0].url, '/api/bookings');
    assert.equal(calls[0].method, 'POST');
    assert.equal(result.id, 'b1');
    assert.equal(result.status, 'PENDING');
  });

  it('NEVER sends a customerId — the server derives it from the session', async () => {
    stubFetch(201, { booking: BOOKING });
    await createBooking({
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
    });

    const sent = JSON.parse(calls[0].body!);
    assert.ok(!('customerId' in sent), 'customerId must not be sent by the client');
    assert.ok(!('userId' in sent), 'userId must not be sent by the client');
  });

  it('NEVER sends price_quote or duration_minutes — the server snapshots them', async () => {
    stubFetch(201, { booking: BOOKING });
    await createBooking({
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
    });

    const sent = JSON.parse(calls[0].body!);
    assert.deepEqual(
      Object.keys(sent).sort(),
      ['address', 'date', 'problemDescription', 'providerId', 'serviceId', 'time'],
    );
  });

  it('sends the exact field names the backend contract expects', async () => {
    stubFetch(201, { booking: BOOKING });
    await createBooking({
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
      notes: 'Buzzer broken',
    });

    const sent = JSON.parse(calls[0].body!);
    assert.deepEqual(sent, {
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
      notes: 'Buzzer broken',
    });
  });

  it('omits notes entirely when blank rather than sending an empty string', async () => {
    stubFetch(201, { booking: BOOKING });
    await createBooking({
      providerId: 'p1',
      serviceId: 's1',
      date: '2026-12-01',
      time: '14:00',
      problemDescription: 'Tap is dripping',
      address: '42 Maple Street',
      notes: '   ',
    });

    const sent = JSON.parse(calls[0].body!);
    assert.ok(!('notes' in sent));
  });

  it('surfaces a 409 conflict as an ApiError with a safe, non-technical message', async () => {
    stubFetch(409, { error: { message: 'That time slot is already booked.' } });
    await assert.rejects(
      () =>
        createBooking({
          providerId: 'p1',
          serviceId: 's1',
          date: '2026-12-01',
          time: '14:00',
          problemDescription: 'Tap is dripping',
          address: '42 Maple Street',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        // The message must never leak internals.
        assert.ok(!/select |insert |relation|pg_|error: /i.test(error.message));
        return true;
      },
    );
  });
});

describe('cancelBooking', () => {
  it('PATCHes the cancel endpoint and sends ONLY a reason', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'CANCELLED' } });
    const result = await cancelBooking('b1', 'Plans changed');

    assert.equal(calls[0].url, '/api/bookings/b1/cancel');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(result.status, 'CANCELLED');

    const sent = JSON.parse(calls[0].body!);
    assert.deepEqual(Object.keys(sent), ['reason']);
  });

  it('NEVER sends a status — the cancel endpoint only cancels', async () => {
    stubFetch(200, { booking: { ...BOOKING, status: 'CANCELLED' } });
    await cancelBooking('b1', 'Plans changed');

    const sent = JSON.parse(calls[0].body!);
    assert.ok(!('status' in sent), 'the customer UI must never send a status value');
  });

  it('reports a 400 when the booking can no longer be cancelled', async () => {
    stubFetch(400, { error: { message: 'cannot cancel a completed booking' } });
    await assert.rejects(
      () => cancelBooking('b1', ''),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        return true;
      },
    );
  });
});

describe('listMyBookings', () => {
  it('GETs /bookings/my and returns the array', async () => {
    stubFetch(200, { bookings: [BOOKING], pagination: { page: 1, pageSize: 50, total: 1 } });
    const result = await listMyBookings();

    assert.ok(calls[0].url.startsWith('/api/bookings/my'));
    assert.equal(calls[0].method, 'GET');
    assert.equal(result.length, 1);
    assert.equal(result[0].service?.name, 'Plumbing');
  });

  it('returns an empty array rather than throwing on an empty result', async () => {
    stubFetch(200, { bookings: [], pagination: { page: 1, pageSize: 50, total: 0 } });
    assert.deepEqual(await listMyBookings(), []);
  });
});

describe('getBooking', () => {
  it('GETs a single booking', async () => {
    stubFetch(200, { booking: BOOKING });
    const result = await getBooking('b1');
    assert.equal(calls[0].url, '/api/bookings/b1');
    assert.equal(result.provider?.businessName, 'Acme Plumbing');
  });

  it('throws a 404 for a booking that is not the caller’s', async () => {
    stubFetch(404, { error: { message: 'Booking not found' } });
    await assert.rejects(
      () => getBooking('someone-elses-booking'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});


