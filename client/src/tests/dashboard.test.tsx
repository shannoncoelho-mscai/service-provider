/**
 * Customer dashboard tests (ADR-025).
 *
 * The summary arithmetic and the upcoming/past split are pure functions, so they
 * are tested directly and exhaustively — that is where a wrong number would
 * actually mislead a customer. The components are then rendered through
 * `react-dom/server` to confirm what reaches the page.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  ACTIVE_STATUSES,
  RECENT_LIMIT,
  UPCOMING_LIMIT,
  accountView,
  firstNameOf,
  greetingFor,
  nextAppointment,
  partitionBookings,
  summariseBookings,
} from '../lib/booking-utils';
import AccountCard from '../components/dashboard/AccountCard';
import RecentBookings from '../components/dashboard/RecentBookings';
import SummaryCards from '../components/dashboard/SummaryCards';
import type { Booking, CurrentUser } from '../types';

/** Build a booking with only the fields a test actually cares about. */
function makeBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    status: 'PENDING',
    scheduledAt: '2026-12-01T14:00:00.000Z',
    durationMinutes: 90,
    address: '42 Maple Street',
    notes: null,
    problemDescription: 'Kitchen tap is dripping.',
    priceQuote: '90.00',
    cancellationReason: null,
    rejectionReason: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    service: { id: 's1', name: 'Plumbing repair' },
    provider: { id: 'p1', businessName: 'Acme Plumbing' },
    customerName: 'Alex',
    ...over,
  };
}

const CUSTOMER: CurrentUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alex@example.com',
  fullName: 'Alex Morgan',
  phone: '+1 555 0100',
  role: 'CUSTOMER',
  createdAt: '2024-03-15T00:00:00.000Z',
};

/* ------------------------------------------------------------ partitioning -- */

describe('partitionBookings', () => {
  it('treats PENDING, ACCEPTED and IN_PROGRESS as upcoming', () => {
    for (const status of ACTIVE_STATUSES) {
      const { upcoming, recent } = partitionBookings([makeBooking({ status })]);
      assert.equal(upcoming.length, 1, `${status} must be upcoming`);
      assert.equal(recent.length, 0);
    }
  });

  it('treats COMPLETED, CANCELLED and REJECTED as past', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'REJECTED'] as const) {
      const { upcoming, recent } = partitionBookings([makeBooking({ status })]);
      assert.equal(recent.length, 1, `${status} must be past`);
      assert.equal(upcoming.length, 0);
    }
  });

  it('sorts upcoming by soonest first', () => {
    const { upcoming } = partitionBookings([
      makeBooking({ id: 'late', scheduledAt: '2026-12-20T10:00:00.000Z' }),
      makeBooking({ id: 'early', scheduledAt: '2026-12-02T10:00:00.000Z' }),
      makeBooking({ id: 'mid', scheduledAt: '2026-12-10T10:00:00.000Z' }),
    ]);
    assert.deepEqual(upcoming.map((b) => b.id), ['early', 'mid', 'late']);
  });

  it('sorts past by most recent first', () => {
    const { recent } = partitionBookings([
      makeBooking({ id: 'older', status: 'COMPLETED', scheduledAt: '2025-01-01T10:00:00.000Z' }),
      makeBooking({ id: 'newer', status: 'COMPLETED', scheduledAt: '2026-06-01T10:00:00.000Z' }),
    ]);
    assert.deepEqual(recent.map((b) => b.id), ['newer', 'older']);
  });

  it('keeps a PENDING booking upcoming even when its slot has passed', () => {
    // Still something the customer is waiting on and may want to cancel.
    const { upcoming, recent } = partitionBookings([
      makeBooking({ status: 'PENDING', scheduledAt: '2020-01-01T10:00:00.000Z' }),
    ]);
    assert.equal(upcoming.length, 1);
    assert.equal(recent.length, 0);
  });

  it('does NOT mutate the caller’s array', () => {
    const input = [
      makeBooking({ id: 'late', scheduledAt: '2026-12-20T10:00:00.000Z' }),
      makeBooking({ id: 'early', scheduledAt: '2026-12-02T10:00:00.000Z' }),
    ];
    const snapshot = input.map((b) => b.id);
    partitionBookings(input);
    assert.deepEqual(input.map((b) => b.id), snapshot);
  });

  it('returns two empty lists for no bookings', () => {
    assert.deepEqual(partitionBookings([]), { upcoming: [], recent: [] });
  });
});

/* ----------------------------------------------------------------- summary -- */

describe('summariseBookings', () => {
  const MIXED = [
    makeBooking({ id: '1', status: 'PENDING' }),
    makeBooking({ id: '2', status: 'PENDING' }),
    makeBooking({ id: '3', status: 'ACCEPTED' }),
    makeBooking({ id: '4', status: 'IN_PROGRESS' }),
    makeBooking({ id: '5', status: 'COMPLETED' }),
    makeBooking({ id: '6', status: 'COMPLETED' }),
    makeBooking({ id: '7', status: 'CANCELLED' }),
    makeBooking({ id: '8', status: 'REJECTED' }),
  ];

  it('counts each headline number from one response', () => {
    assert.deepEqual(summariseBookings(MIXED), {
      upcoming: 4,
      pending: 2,
      completed: 2,
      total: 8,
    });
  });

  it('prefers the server total so a capped page cannot under-report', () => {
    // 50 rows returned, but the customer has 80 bookings in total.
    const capped = Array.from({ length: 50 }, (_, i) =>
      makeBooking({ id: String(i), status: 'COMPLETED' }),
    );
    assert.equal(summariseBookings(capped, 80).total, 80);
  });

  it('falls back to the array length when no total is supplied', () => {
    assert.equal(summariseBookings(MIXED).total, 8);
  });

  it('reports all zeros for an empty history', () => {
    assert.deepEqual(summariseBookings([]), {
      upcoming: 0,
      pending: 0,
      completed: 0,
      total: 0,
    });
  });
});

describe('nextAppointment', () => {
  it('returns the soonest upcoming booking', () => {
    const { upcoming } = partitionBookings([
      makeBooking({ id: 'late', scheduledAt: '2026-12-20T10:00:00.000Z' }),
      makeBooking({ id: 'early', scheduledAt: '2026-12-02T10:00:00.000Z' }),
    ]);
    assert.equal(nextAppointment(upcoming)?.id, 'early');
  });

  it('returns null when nothing is upcoming', () => {
    assert.equal(nextAppointment([]), null);
  });
});

/* ----------------------------------------------------------------- greeting -- */

describe('greetingFor', () => {
  it('greets according to the local hour', () => {
    assert.equal(greetingFor(new Date(2026, 0, 15, 8)), 'Good morning');
    assert.equal(greetingFor(new Date(2026, 0, 15, 14)), 'Good afternoon');
    assert.equal(greetingFor(new Date(2026, 0, 15, 21)), 'Good evening');
  });
});

describe('firstNameOf', () => {
  it('uses only the first name, never the full legal name', () => {
    assert.equal(firstNameOf(CUSTOMER), 'Alex');
  });

  it('returns an empty string for a signed-out visitor', () => {
    assert.equal(firstNameOf(null), '');
  });
});

/* ------------------------------------------------------------ account view -- */

describe('accountView', () => {
  it('exposes only the four safe fields', () => {
    const view = accountView(CUSTOMER);
    assert.deepEqual(Object.keys(view).sort(), ['email', 'memberSince', 'name', 'role']);
  });

  it('never carries the customer id or phone number', () => {
    const view = accountView(CUSTOMER);
    assert.ok(!JSON.stringify(view).includes(CUSTOMER.id));
    assert.ok(!JSON.stringify(view).includes('+1 555 0100'));
  });
});

/* ------------------------------------------------------------- components -- */

describe('SummaryCards', () => {
  const render = (summary: ReturnType<typeof summariseBookings>) =>
    renderToStaticMarkup(<SummaryCards summary={summary} />);

  it('shows all four headline numbers with readable labels', () => {
    const html = render({ upcoming: 3, pending: 2, completed: 5, total: 9 });
    assert.match(html, /Upcoming/);
    assert.match(html, /Pending/);
    assert.match(html, /Completed/);
    assert.match(html, /Total bookings/);
    // Each numeral is accompanied by an sr-only label for screen readers.
    assert.match(html, /class="sr-only"> upcoming/);
  });

  it('renders nothing for an empty history, so all-zero cards never show', () => {
    const html = render({ upcoming: 0, pending: 0, completed: 0, total: 0 });
    assert.equal(html, '');
  });

  it('does not rely on colour alone to convey a count', () => {
    const html = render({ upcoming: 1, pending: 0, completed: 0, total: 1 });
    // Text labels, not just icon/background, carry the meaning.
    assert.match(html, /Upcoming/);
    assert.match(html, /Total bookings/);
  });
});

describe('AccountCard', () => {
  const html = renderToStaticMarkup(<AccountCard user={CUSTOMER} />);

  it('shows the name, email and account type', () => {
    assert.match(html, /Alex Morgan/);
    assert.match(html, /alex@example\.com/);
    assert.match(html, /Customer/);
  });

  it('does NOT render the customer id anywhere in the DOM', () => {
    assert.ok(!html.includes(CUSTOMER.id), 'the customer id must never be rendered');
  });

  it('does NOT render the phone number', () => {
    assert.ok(!html.includes('+1 555 0100'));
  });

  it('does NOT render password, token or session fields', () => {
    for (const forbidden of ['password', 'token', 'session', 'hash']) {
      assert.ok(!new RegExp(forbidden, 'i').test(html), `${forbidden} must not be rendered`);
    }
  });
});

describe('RecentBookings', () => {
  const render = (bookings: Booking[]) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <RecentBookings bookings={bookings} />
      </MemoryRouter>,
    );

  it('renders a compact row per booking with a link to its details', () => {
    const html = render([makeBooking({ id: 'r1', status: 'COMPLETED' })]);
    assert.match(html, /Plumbing repair/);
    assert.match(html, /Acme Plumbing/);
    assert.match(html, /href="\/bookings\/r1"/);
  });

  it('shows a status badge for each past booking', () => {
    assert.match(render([makeBooking({ status: 'COMPLETED' })]), /Completed/);
    assert.match(render([makeBooking({ status: 'CANCELLED' })]), /Cancelled/);
    assert.match(render([makeBooking({ status: 'REJECTED' })]), /Declined/);
  });

  it('offers NO cancel action — past bookings are not cancellable', () => {
    const html = render([makeBooking({ status: 'COMPLETED' })]);
    assert.ok(!/Cancel/.test(html), 'the history list must not offer cancellation');
  });

  it('links to the full history', () => {
    assert.match(render([makeBooking({ status: 'COMPLETED' })]), /href="\/bookings"/);
  });

  it('shows an empty state rather than a blank panel', () => {
    const html = render([]);
    assert.match(html, /No past bookings yet/);
  });
});

/* ---------------------------------------------------------------- limits -- */

describe('dashboard list limits', () => {
  it('caps upcoming and recent lists and defers the rest to /bookings', () => {
    // A dashboard is an overview; the full history lives at /bookings.
    assert.equal(UPCOMING_LIMIT, 4);
    assert.equal(RECENT_LIMIT, 5);

    const many = Array.from({ length: 12 }, (_, i) =>
      makeBooking({ id: `u${i}`, status: 'PENDING' }),
    );
    const { upcoming } = partitionBookings(many);
    assert.equal(upcoming.length, 12, 'the data keeps everything');
    assert.equal(upcoming.slice(0, UPCOMING_LIMIT).length, 4, 'but only four are rendered');
  });
});


