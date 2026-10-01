/**
 * Reviews logic + component tests (ADR-028).
 *
 * Two things are worth testing hardest: which bookings are offered a review
 * action, and that nothing identifying about the customer reaches the markup.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  REVIEW_COMMENT_MAX,
  canReview,
  ratingLabel,
  validateReview,
} from '../lib/booking-utils';
import BookingCard from '../components/booking/BookingCard';
import BookingReviewSection from '../components/reviews/BookingReviewSection';
import ReviewForm from '../components/reviews/ReviewForm';
import ReviewList from '../components/providers/ReviewList';
import type { Booking, BookingStatus, MyReview } from '../types';

const BOOKING: Booking = {
  id: 'b1',
  status: 'COMPLETED',
  scheduledAt: '2026-10-01T14:00:00.000Z',
  durationMinutes: 90,
  address: '42 Maple Street',
  notes: null,
  problemDescription: 'Kitchen tap is dripping.',
  priceQuote: '90.00',
  cancellationReason: null,
  rejectionReason: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  service: { id: 's1', name: 'Plumbing repair' },
  provider: { id: 'p1', businessName: 'Acme Plumbing' },
  customerName: 'Alex Morgan',
};

const REVIEW: MyReview = {
  id: 'r1',
  bookingId: 'b1',
  rating: 5,
  comment: 'Fast, tidy and explained everything.',
  createdAt: '2026-10-02T10:00:00.000Z',
  providerName: 'Acme Plumbing',
  serviceName: 'Plumbing repair',
  bookingStatus: 'COMPLETED',
};

const noop = () => {};

/* ------------------------------------------------------------ eligibility -- */

describe('canReview', () => {
  it('allows a COMPLETED booking', () => {
    assert.equal(canReview('COMPLETED'), true);
  });

  it('refuses every other status', () => {
    for (const status of [
      'PENDING',
      'ACCEPTED',
      'IN_PROGRESS',
      'REJECTED',
      'CANCELLED',
    ] as BookingStatus[]) {
      assert.equal(canReview(status), false, `${status} must not be reviewable`);
    }
  });
});

/* ------------------------------------------------------------- validation -- */

describe('validateReview', () => {
  it('accepts a rating with no comment', () => {
    assert.deepEqual(validateReview({ rating: 5, comment: '' }), {});
  });

  it('requires a rating', () => {
    assert.match(validateReview({ rating: null, comment: '' }).rating!, /1 to 5/);
  });

  it('rejects out-of-range and non-integer ratings', () => {
    for (const rating of [0, 6, -1, 4.5, 2.1]) {
      assert.ok(
        validateReview({ rating, comment: '' }).rating,
        `rating ${rating} must be rejected`,
      );
    }
  });

  it('accepts every whole number 1..5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      assert.deepEqual(validateReview({ rating, comment: '' }), {});
    }
  });

  it('does not require a comment', () => {
    assert.equal(validateReview({ rating: 3, comment: '' }).comment, undefined);
  });

  it('rejects a comment over the server maximum', () => {
    const errors = validateReview({ rating: 5, comment: 'x'.repeat(REVIEW_COMMENT_MAX + 1) });
    assert.match(errors.comment!, new RegExp(String(REVIEW_COMMENT_MAX)));
  });

  it('accepts a comment at exactly the maximum', () => {
    assert.deepEqual(validateReview({ rating: 5, comment: 'x'.repeat(REVIEW_COMMENT_MAX) }), {});
  });
});

describe('ratingLabel', () => {
  it('uses the singular only for one star', () => {
    assert.equal(ratingLabel(1), '1 star');
    assert.equal(ratingLabel(2), '2 stars');
    assert.equal(ratingLabel(5), '5 stars');
  });
});

/* ------------------------------------------------------------- components -- */

describe('ReviewForm', () => {
  const render = () =>
    renderToStaticMarkup(
      <ReviewForm bookingId="b1" providerName="Acme Plumbing" onCreated={noop} />,
    );

  it('renders five star options in a radio group', () => {
    const html = render();
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /aria-label="Your rating out of 5"/);
    assert.equal((html.match(/type="radio"/g) ?? []).length, 5);
  });

  it('gives every star an accessible label', () => {
    const html = render();
    for (const label of ['1 star', '2 stars', '3 stars', '4 stars', '5 stars']) {
      assert.match(html, new RegExp(label), `${label} must be present`);
    }
  });

  it('renders the comment as an optional field with a visible limit', () => {
    const html = render();
    assert.match(html, /Optional/);
    assert.match(html, new RegExp(String(REVIEW_COMMENT_MAX)));
  });

  it('has a single submit button', () => {
    const html = render();
    assert.match(html, /Submit review/);
    assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  });

  it('NEVER renders a customer id or provider id input', () => {
    const html = render();
    for (const forbidden of ['customerId', 'customer_id', 'providerId', 'userId', 'reviewerId']) {
      assert.ok(!new RegExp(forbidden, 'i').test(html), `${forbidden} must not be rendered`);
    }
  });

  it('explains that reviews are shown without the customer name', () => {
    assert.match(render(), /without your name/i);
  });
});

describe('BookingReviewSection', () => {
  const render = (status: BookingStatus, review: MyReview | null = null) =>
    renderToStaticMarkup(
      <BookingReviewSection
        bookingId="b1"
        status={status}
        providerName="Acme Plumbing"
        review={review}
        onCreated={noop}
      />,
    );

  it('renders nothing at all for a non-completed booking', () => {
    for (const status of [
      'PENDING',
      'ACCEPTED',
      'IN_PROGRESS',
      'REJECTED',
      'CANCELLED',
    ] as BookingStatus[]) {
      assert.equal(render(status), '', `${status} must render no review section`);
    }
  });

  it('shows the form for a completed booking with no review', () => {
    const html = render('COMPLETED');
    assert.match(html, /Submit review/);
    assert.match(html, /How did it go/);
  });

  it('shows the stored review instead of the form once one exists', () => {
    const html = render('COMPLETED', REVIEW);
    assert.match(html, /Review submitted/);
    assert.match(html, /Fast, tidy and explained everything/);
    // The form is gone, so a second submission is impossible from this page.
    assert.ok(!/Submit review/.test(html), 'the form must not remain after a review exists');
  });

  it('shows a rating summary for a review with no comment', () => {
    const html = render('COMPLETED', { ...REVIEW, comment: null });
    assert.match(html, /Review submitted/);
    assert.match(html, /without leaving a comment/);
  });

  it('never renders customer identity in the review state', () => {
    const html = render('COMPLETED', REVIEW);
    for (const forbidden of ['Alex Morgan', 'customerId', 'password', 'token']) {
      assert.ok(!html.includes(forbidden), `${forbidden} must not be rendered`);
    }
  });
});

describe('BookingCard review action', () => {
  const render = (status: BookingStatus) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BookingCard booking={{ ...BOOKING, status }} onCancel={noop} />
      </MemoryRouter>,
    );

  it('offers "Leave a review" on a COMPLETED booking', () => {
    assert.match(render('COMPLETED'), /Leave a review/);
  });

  it('offers no review action on any other status', () => {
    for (const status of [
      'PENDING',
      'ACCEPTED',
      'IN_PROGRESS',
      'REJECTED',
      'CANCELLED',
    ] as BookingStatus[]) {
      assert.ok(!/Leave a review/.test(render(status)), `${status} must not offer a review`);
    }
  });
});

describe('ReviewList (public provider profile)', () => {
  const render = (
    reviews: Array<{ rating: number; comment: string | null; createdAt: string }>,
    total: number,
  ) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ReviewList reviews={reviews} totalCount={total} />
      </MemoryRouter>,
    );

  it('shows a zero-review empty state', () => {
    assert.match(render([], 0), /No reviews yet/);
  });

  it('renders each review with its comment', () => {
    const html = render(
      [{ rating: 5, comment: 'Excellent work', createdAt: '2026-10-01T00:00:00.000Z' }],
      1,
    );
    assert.match(html, /Excellent work/);
  });

  it('explains a rating submitted without a comment', () => {
    const html = render(
      [{ rating: 4, comment: null, createdAt: '2026-10-01T00:00:00.000Z' }],
      1,
    );
    assert.match(html, /Rated 4 out of 5 without a comment/);
  });

  it('notes when only the most recent reviews are shown', () => {
    const reviews = Array.from({ length: 2 }, (_, i) => ({
      rating: 5,
      comment: `Review ${i}`,
      createdAt: '2026-10-01T00:00:00.000Z',
    }));
    assert.match(render(reviews, 9), /most recent of 9 reviews/);
  });

  it('renders reviews anonymously and leaks no reviewer identity', () => {
    const html = render(
      [{ rating: 5, comment: 'Great', createdAt: '2026-10-01T00:00:00.000Z' }],
      1,
    );
    assert.match(html, /Anonymous review/);
    for (const forbidden of ['Alex', 'email', 'password', 'customerId']) {
      assert.ok(!html.includes(forbidden), `${forbidden} must not appear in public reviews`);
    }
  });
});

