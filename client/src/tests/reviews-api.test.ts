/**
 * Reviews API contract tests (ADR-028).
 *
 * The security-critical assertion here is the body: a review that carried a
 * customerId or providerId would be a spoofing vector, and the server's strict
 * schema would reject it — but the client must never be the thing that sends it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { ApiError, createReview, listMyReviews } from '../lib/api';

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

const REVIEW = {
  id: 'r1',
  bookingId: 'b1',
  rating: 5,
  comment: 'Great work',
  createdAt: '2026-10-01T10:00:00.000Z',
  providerName: 'Acme Plumbing',
  serviceName: 'Plumbing repair',
  bookingStatus: 'COMPLETED',
};

afterEach(() => {
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});

describe('createReview', () => {
  it('POSTs to /reviews and unwraps the review', async () => {
    stubFetch(201, { review: REVIEW });
    const result = await createReview({ bookingId: 'b1', rating: 5, comment: 'Great work' });

    assert.equal(calls[0].url, '/api/reviews');
    assert.equal(calls[0].method, 'POST');
    assert.equal(result.id, 'r1');
  });

  it('sends exactly bookingId, rating and comment', async () => {
    stubFetch(201, { review: REVIEW });
    await createReview({ bookingId: 'b1', rating: 4, comment: 'Good' });
    assert.deepEqual(JSON.parse(calls[0].body!), {
      bookingId: 'b1',
      rating: 4,
      comment: 'Good',
    });
  });

  it('NEVER sends a customerId or providerId', async () => {
    stubFetch(201, { review: REVIEW });
    await createReview({ bookingId: 'b1', rating: 5, comment: 'Good' });

    const sent = JSON.parse(calls[0].body!);
    for (const forbidden of [
      'customerId',
      'customer_id',
      'userId',
      'reviewerId',
      'reviewer_id',
      'providerId',
      'provider_id',
    ]) {
      assert.ok(!(forbidden in sent), `${forbidden} must never be sent by the client`);
    }
  });

  it('omits the comment entirely when none is given', async () => {
    stubFetch(201, { review: REVIEW });
    await createReview({ bookingId: 'b1', rating: 5 });
    assert.deepEqual(Object.keys(JSON.parse(calls[0].body!)).sort(), ['bookingId', 'rating']);
  });

  it('omits a whitespace-only comment rather than sending blank text', async () => {
    stubFetch(201, { review: REVIEW });
    await createReview({ bookingId: 'b1', rating: 5, comment: '   \n  ' });
    assert.ok(!('comment' in JSON.parse(calls[0].body!)));
  });

  it('trims the comment before sending', async () => {
    stubFetch(201, { review: REVIEW });
    await createReview({ bookingId: 'b1', rating: 5, comment: '  Nice work  ' });
    assert.equal(JSON.parse(calls[0].body!).comment, 'Nice work');
  });

  it('sends each valid rating as a plain number', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      stubFetch(201, { review: { ...REVIEW, rating } });
      await createReview({ bookingId: 'b1', rating });
      const sent = JSON.parse(calls[0].body!);
      assert.equal(sent.rating, rating);
      assert.equal(typeof sent.rating, 'number');
    }
  });

  it('surfaces a duplicate review as a 409', async () => {
    stubFetch(409, { error: { message: 'You have already reviewed this booking.' } });
    await assert.rejects(
      () => createReview({ bookingId: 'b1', rating: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        return true;
      },
    );
  });

  it('surfaces a 400 for an invalid rating', async () => {
    stubFetch(400, { error: { message: 'rating must be between 1 and 5' } });
    await assert.rejects(
      () => createReview({ bookingId: 'b1', rating: 9 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        return true;
      },
    );
  });

  it('surfaces a 404 for a booking that is not the caller s', async () => {
    stubFetch(404, { error: { message: 'Booking not found' } });
    await assert.rejects(
      () => createReview({ bookingId: 'someone-elses', rating: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe('listMyReviews', () => {
  it('GETs /reviews/my and returns the array', async () => {
    stubFetch(200, { reviews: [REVIEW] });
    const result = await listMyReviews();

    assert.equal(calls[0].url, '/api/reviews/my');
    assert.equal(calls[0].method, 'GET');
    assert.equal(result.length, 1);
    assert.equal(result[0].rating, 5);
  });

  it('returns an empty array for a customer with no reviews', async () => {
    stubFetch(200, { reviews: [] });
    assert.deepEqual(await listMyReviews(), []);
  });
});
