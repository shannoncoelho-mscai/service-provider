/**
 * Provider dashboard logic + component tests (ADR-026).
 *
 * The transition table is the security-relevant part of this feature: it decides
 * which action buttons exist, so it is tested exhaustively — including every
 * transition the server forbids, to prove the UI cannot offer it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  PROVIDER_FILTERS,
  PROVIDER_TRANSITIONS,
  REASON_MAX,
  actionLabel,
  canProviderAct,
  filterProviderBookings,
  nextProviderAction,
  requiresReason,
  sortProviderBookings,
  summariseProviderBookings,
  validateReason,
} from '../lib/booking-utils';
import ProviderBookingCard from '../components/provider/ProviderBookingCard';
import ProviderSummaryCards from '../components/provider/ProviderSummaryCards';
import VerificationNotice from '../components/provider/VerificationNotice';
import type { Booking, BookingStatus } from '../types';

// ESM has no __dirname; resolve from this module's own URL.
const PAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages');

function makeBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    status: 'PENDING',
    scheduledAt: '2026-12-01T14:00:00.000Z',
    durationMinutes: 90,
    address: '42 Maple Street',
    notes: 'Buzzer is broken',
    problemDescription: 'Kitchen tap is dripping constantly.',
    priceQuote: '90.00',
    cancellationReason: null,
    rejectionReason: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    service: { id: 's1', name: 'Plumbing repair' },
    provider: { id: 'p1', businessName: 'Acme Plumbing' },
    customerName: 'Alex Morgan',
    ...over,
  };
}

const noop = () => {};

/* ------------------------------------------------- the transition table -- */

describe('PROVIDER_TRANSITIONS', () => {
  it('allows exactly the three legal provider moves', () => {
    assert.deepEqual([...PROVIDER_TRANSITIONS.PENDING].sort(), ['ACCEPTED', 'REJECTED']);
    assert.deepEqual([...PROVIDER_TRANSITIONS.ACCEPTED], ['IN_PROGRESS']);
    assert.deepEqual([...PROVIDER_TRANSITIONS.IN_PROGRESS], ['COMPLETED']);
  });

  it('never offers CANCELLED — that is the customer action', () => {
    for (const targets of Object.values(PROVIDER_TRANSITIONS)) {
      assert.ok(
        !targets.includes('CANCELLED' as never),
        'a provider must never be offered CANCELLED',
      );
    }
  });

  it('gives every terminal status no action at all', () => {
    for (const status of ['REJECTED', 'CANCELLED', 'COMPLETED'] as const) {
      assert.deepEqual(PROVIDER_TRANSITIONS[status], []);
      assert.equal(canProviderAct(status), false);
      assert.equal(nextProviderAction(status), null);
    }
  });

  it('forbids the shortcuts the server forbids', () => {
    // PENDING -> IN_PROGRESS and PENDING -> COMPLETED must be unavailable.
    assert.ok(!PROVIDER_TRANSITIONS.PENDING.includes('IN_PROGRESS'));
    assert.ok(!PROVIDER_TRANSITIONS.PENDING.includes('COMPLETED'));
    // REJECTED -> COMPLETED and CANCELLED -> ACCEPTED must be unavailable.
    assert.equal(nextProviderAction('REJECTED'), null);
    assert.equal(nextProviderAction('CANCELLED'), null);
    assert.equal(nextProviderAction('COMPLETED'), null);
  });

  it('maps each status to the expected primary action', () => {
    assert.equal(nextProviderAction('PENDING'), 'ACCEPTED');
    assert.equal(nextProviderAction('ACCEPTED'), 'IN_PROGRESS');
    assert.equal(nextProviderAction('IN_PROGRESS'), 'COMPLETED');
  });
});

describe('actionLabel / requiresReason', () => {
  it('labels each action in the provider voice', () => {
    assert.equal(actionLabel('ACCEPTED'), 'Accept');
    assert.equal(actionLabel('REJECTED'), 'Reject');
    assert.equal(actionLabel('IN_PROGRESS'), 'Start service');
    assert.equal(actionLabel('COMPLETED'), 'Mark completed');
  });

  it('requires a reason ONLY for rejection, matching the server schema', () => {
    assert.equal(requiresReason('REJECTED'), true);
    assert.equal(requiresReason('ACCEPTED'), false);
    assert.equal(requiresReason('IN_PROGRESS'), false);
    assert.equal(requiresReason('COMPLETED'), false);
  });
});

describe('validateReason', () => {
  it('rejects an empty reason', () => {
    assert.match(validateReason('   ')!, /reason/i);
  });

  it('rejects a reason under the server minimum of 3 characters', () => {
    assert.match(validateReason('no')!, /at least 3/i);
  });

  it('rejects a reason over the server maximum', () => {
    assert.match(validateReason('x'.repeat(REASON_MAX + 1))!, /under 500/i);
  });

  it('accepts a reasonable reason', () => {
    assert.equal(validateReason('Fully booked that day'), null);
  });
});

/* ------------------------------------------------------- counts and sort -- */

describe('summariseProviderBookings', () => {
  const MIXED = [
    makeBooking({ id: '1', status: 'PENDING' }),
    makeBooking({ id: '2', status: 'PENDING' }),
    makeBooking({ id: '3', status: 'ACCEPTED' }),
    makeBooking({ id: '4', status: 'IN_PROGRESS' }),
    makeBooking({ id: '5', status: 'COMPLETED' }),
    makeBooking({ id: '6', status: 'REJECTED' }),
    makeBooking({ id: '7', status: 'CANCELLED' }),
  ];

  it('counts every status group', () => {
    assert.deepEqual(summariseProviderBookings(MIXED), {
      pending: 2,
      accepted: 1,
      inProgress: 1,
      completed: 1,
      rejected: 1,
      cancelled: 1,
      total: 7,
    });
  });

  it('prefers the server total over the capped array length', () => {
    assert.equal(summariseProviderBookings(MIXED, 120).total, 120);
  });

  it('reports all zeros for an empty queue', () => {
    assert.deepEqual(summariseProviderBookings([]), {
      pending: 0,
      accepted: 0,
      inProgress: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
      total: 0,
    });
  });
});

describe('sortProviderBookings', () => {
  it('puts PENDING, then ACCEPTED, then IN_PROGRESS, then closed work', () => {
    const sorted = sortProviderBookings([
      makeBooking({ id: 'done', status: 'COMPLETED' }),
      makeBooking({ id: 'running', status: 'IN_PROGRESS' }),
      makeBooking({ id: 'asked', status: 'ACCEPTED' }),
      makeBooking({ id: 'new', status: 'PENDING' }),
    ]);
    assert.deepEqual(sorted.map((b) => b.id), ['new', 'asked', 'running', 'done']);
  });

  it('orders newest activity first within a status', () => {
    const sorted = sortProviderBookings([
      makeBooking({ id: 'older', status: 'PENDING', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeBooking({ id: 'newer', status: 'PENDING', updatedAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    assert.deepEqual(sorted.map((b) => b.id), ['newer', 'older']);
  });

  it('does NOT mutate the original array', () => {
    const input = [
      makeBooking({ id: 'done', status: 'COMPLETED' }),
      makeBooking({ id: 'new', status: 'PENDING' }),
    ];
    const snapshot = input.map((b) => b.id);
    sortProviderBookings(input);
    assert.deepEqual(input.map((b) => b.id), snapshot, 'the API response array must not be mutated');
  });
});

describe('filterProviderBookings', () => {
  const MIXED = [
    makeBooking({ id: 'p', status: 'PENDING' }),
    makeBooking({ id: 'a', status: 'ACCEPTED' }),
    makeBooking({ id: 'c', status: 'COMPLETED' }),
  ];

  it('returns everything for ALL', () => {
    assert.equal(filterProviderBookings(MIXED, 'ALL').length, 3);
  });

  it('filters by a single status', () => {
    assert.deepEqual(filterProviderBookings(MIXED, 'PENDING').map((b) => b.id), ['p']);
  });

  it('returns an empty list for a status with nothing in it', () => {
    assert.deepEqual(filterProviderBookings(MIXED, 'CANCELLED'), []);
  });

  it('does not mutate the original array', () => {
    const snapshot = MIXED.map((b) => b.id);
    filterProviderBookings(MIXED, 'PENDING');
    assert.deepEqual(MIXED.map((b) => b.id), snapshot);
  });

  it('offers exactly the seven documented tabs', () => {
    assert.deepEqual(
      PROVIDER_FILTERS.map((f) => f.value),
      ['ALL', 'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'],
    );
  });
});

/* ------------------------------------------------------------- components -- */

const renderCard = (booking: Booking, busyStatus: string | null = null) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ProviderBookingCard
        booking={booking}
        busyStatus={busyStatus}
        onAccept={noop}
        onReject={noop}
        onStart={noop}
        onComplete={noop}
      />
    </MemoryRouter>,
  );

describe('ProviderBookingCard', () => {
  it('shows the service, customer name, address, problem and notes', () => {
    const html = renderCard(makeBooking());
    assert.match(html, /Plumbing repair/);
    assert.match(html, /Alex Morgan/);
    assert.match(html, /42 Maple Street/);
    assert.match(html, /Kitchen tap is dripping/);
    assert.match(html, /Buzzer is broken/);
  });

  it('offers Accept and Reject for a PENDING booking', () => {
    const html = renderCard(makeBooking({ status: 'PENDING' }));
    assert.match(html, /Accept/);
    assert.match(html, /Reject/);
  });

  it('offers ONLY Start service for an ACCEPTED booking', () => {
    const html = renderCard(makeBooking({ status: 'ACCEPTED' }));
    assert.match(html, /Start service/);
    assert.ok(!/\bAccept\b\s*</.test(html), 'an accepted booking must not offer Accept');
    assert.ok(!/Reject/.test(html), 'an accepted booking must not offer Reject');
  });

  it('offers ONLY Mark completed for an IN_PROGRESS booking', () => {
    const html = renderCard(makeBooking({ status: 'IN_PROGRESS' }));
    assert.match(html, /Mark completed/);
    assert.ok(!/Start service/.test(html), 'an in-progress booking must not offer Start again');
  });

  it('offers NO action at all for terminal statuses', () => {
    for (const status of ['REJECTED', 'CANCELLED', 'COMPLETED'] as BookingStatus[]) {
      const html = renderCard(makeBooking({ status }));
      // Zero buttons in the action area: nothing is offered at all.
      assert.equal(
        (html.match(/<button/g) ?? []).length,
        0,
        `${status} must render no action buttons`,
      );
    }
  });

  it('never offers a cancellation control — that is the customer action', () => {
    for (const status of ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] as BookingStatus[]) {
      assert.ok(
        !/Cancel/.test(renderCard(makeBooking({ status }))),
        `${status} must not offer a cancel control`,
      );
    }
  });

  it('disables the action buttons and shows a spinner while a request is in flight', () => {
    const html = renderCard(makeBooking({ status: 'PENDING' }), 'ACCEPTED');
    assert.match(html, /Accepting\.\.\./);
    assert.match(html, /disabled=""/);
  });

  it('does NOT render any customer authentication or internal data', () => {
    const html = renderCard(makeBooking());
    for (const forbidden of ['password', 'token', 'session', 'hash', 'email', '@']) {
      assert.ok(!new RegExp(forbidden, 'i').test(html), `${forbidden} must not be rendered`);
    }
  });

  it('shows a status badge with text, not colour alone', () => {
    assert.match(renderCard(makeBooking({ status: 'PENDING' })), /Awaiting provider/);
  });
});

describe('ProviderSummaryCards', () => {
  const render = (over: Partial<ReturnType<typeof summariseProviderBookings>> = {}) =>
    renderToStaticMarkup(
      <ProviderSummaryCards
        summary={{
          pending: 2,
          accepted: 1,
          inProgress: 0,
          completed: 5,
          rejected: 1,
          cancelled: 3,
          total: 12,
          ...over,
        }}
      />,
    );

  it('shows every status group with a readable label', () => {
    const html = render();
    for (const label of [
      'Pending requests',
      'Accepted',
      'In progress',
      'Completed',
      'Rejected',
      'Cancelled by customer',
      'Total bookings',
    ]) {
      assert.match(html, new RegExp(label), `${label} must be shown`);
    }
  });

  it('renders even when every count is zero', () => {
    // Unlike the customer dashboard, a provider with an empty queue should see
    // explicit zeros rather than a blank area.
    const html = render({
      pending: 0,
      accepted: 0,
      inProgress: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
      total: 0,
    });
    assert.match(html, /Pending requests/);
  });
});

describe('VerificationNotice', () => {
  it('explains a PENDING verification without implying the provider is bookable', () => {
    const html = renderToStaticMarkup(<VerificationNotice status="PENDING" />);
    assert.match(html, /Awaiting verification/);
    // Phase 18 fixes the wording: it must say plainly that the profile is
    // pending ADMIN verification and that public listings follow approval.
    assert.match(html, /pending administrator verification/i);
    assert.match(html, /public listings after approval/i);
    // Still must not imply the provider is already live.
    assert.ok(!/you are (now )?bookable|customers can book you/i.test(html));
  });

  it('confirms an APPROVED provider', () => {
    assert.match(
      renderToStaticMarkup(<VerificationNotice status="APPROVED" />),
      /Profile verified/,
    );
  });

  it('shows a REJECTED state without inventing a reason', () => {
    const html = renderToStaticMarkup(<VerificationNotice status="REJECTED" />);
    assert.match(html, /not approved/i);
    // The API exposes no rejection reason, so the UI must not state one.
    assert.ok(!/reason (was|given|provided)/i.test(html));
    assert.match(html, /contact support/i);
  });

  it('shows a SUSPENDED state without inventing a reason', () => {
    const html = renderToStaticMarkup(<VerificationNotice status="SUSPENDED" />);
    assert.match(html, /suspended/i);
    assert.ok(!/because|due to|violation/i.test(html), 'no fabricated cause');
  });
});




/* ------------------------------------------------------- provider links -- */

describe('provider self-service links (Phase 18)', () => {
  it('never sends a provider to the PUBLIC directory for "my profile"', () => {
    // Regression: "My profile" and "View my public profile" both pointed at
    // /providers, which is the public search page. A provider clicking
    // "my profile" was shown a list of OTHER people. Every self-referential
    // link in the provider surface must go to /provider/business.
    const dashboard = readFileSync(join(PAGES, 'ProviderDashboardPage.tsx'), 'utf8');
    const selfLinks = [...dashboard.matchAll(/to="(\/[^"]*)"/g)].map((m) => m[1]);

    for (const href of selfLinks) {
      assert.notEqual(
        href,
        '/providers',
        `provider dashboard must not link to the public directory (${href})`,
      );
    }
    assert.ok(
      selfLinks.includes('/provider/business'),
      'the provider must be able to reach their own profile and services',
    );
  });

  it('routes the provider to their own business page, not the customer area', () => {
    const dashboard = readFileSync(join(PAGES, 'ProviderDashboardPage.tsx'), 'utf8');
    for (const href of [...dashboard.matchAll(/to="(\/[^"]*)"/g)].map((m) => m[1])) {
      assert.ok(
        href !== '/dashboard' && href !== '/bookings',
        `a provider must not be sent to a customer route (${href})`,
      );
    }
  });
});