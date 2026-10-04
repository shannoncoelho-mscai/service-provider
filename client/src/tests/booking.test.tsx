/**
 * Booking form logic + component rendering tests (ADR-024).
 *
 * Component tests use `react-dom/server` to render to static markup. That is
 * enough to assert what a customer is actually shown (empty states, status
 * badges, confirmation copy) without pulling in a DOM emulator, and it matches
 * the dependency-light style of the server test suite.
 *
 * The pure helpers in `lib/booking-utils.ts` carry the validation logic, so
 * they are tested directly and exhaustively.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  PROBLEM_MAX,
  canCustomerCancel,
  formatDuration,
  localSlotToUtc,
  maxBookableDate,
  shortAddress,
  summarise,
  todayLocal,
  validateBooking,
  type BookingFormValues,
} from '../lib/booking-utils';
import BookingStatusBadge from '../components/booking/BookingStatusBadge';
import BookingCard from '../components/booking/BookingCard';
import BookingConfirmation from '../components/booking/BookingConfirmation';
import BookingForm from '../components/booking/BookingForm';
import ServicePicker from '../components/booking/ServicePicker';
import { Alert, ErrorState, LoadingState } from '../components/ui';
import type { Booking, PublicService } from '../types';

/** A fixed "now" so date-boundary tests never depend on the clock. */
const NOW = new Date(2026, 0, 15, 12, 0, 0); // 15 Jan 2026, 12:00 local

const VALID: BookingFormValues = {
  serviceId: 's1',
  date: '2026-01-20',
  time: '14:00',
  problemDescription: 'Kitchen tap has been dripping since Monday.',
  address: '42 Maple Street',
  notes: '',
};

const check = (over: Partial<BookingFormValues> = {}) => ({
  hasServices: true,
  now: NOW,
  values: { ...VALID, ...over },
});

/* ---------------------------------------------------------------- dates -- */

describe('localSlotToUtc', () => {
  it('converts a local selection to the UTC pair the API expects', () => {
    // Constructed as LOCAL, then read back as UTC — the round trip must be
    // lossless regardless of the machine's timezone.
    const local = new Date(2026, 5, 1, 14, 30);
    const isoDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    const result = localSlotToUtc(isoDate, '14:30');

    assert.ok(result);
    assert.equal(result.time, local.toISOString().slice(11, 16));
    // The composed instant must equal what the customer actually picked.
    assert.equal(new Date(`${result.date}T${result.time}:00Z`).getTime(), local.getTime());
  });

  it('rejects a malformed date', () => {
    assert.equal(localSlotToUtc('not-a-date', '14:00'), null);
  });

  it('rejects a malformed time', () => {
    assert.equal(localSlotToUtc('2026-06-01', '99:99'), null);
  });

  it('rejects an impossible calendar date that Date would roll over', () => {
    assert.equal(localSlotToUtc('2026-02-31', '14:00'), null);
  });
});

describe('date bounds', () => {
  it('todayLocal reflects the local calendar day', () => {
    assert.equal(todayLocal(NOW), '2026-01-15');
  });

  it('maxBookableDate is one year out', () => {
    assert.equal(maxBookableDate(NOW), '2027-01-15');
  });
});

/* ------------------------------------------------------------ validation -- */

describe('validateBooking', () => {
  it('accepts a complete, valid submission', () => {
    assert.deepEqual(validateBooking(check().values, { hasServices: true, now: NOW }), {});
  });

  it('requires a service', () => {
    const errors = validateBooking(check({ serviceId: '' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.serviceId!, /choose a service/i);
  });

  it('blocks booking when the provider has no services at all', () => {
    const errors = validateBooking(check().values, { hasServices: false, now: NOW });
    assert.match(errors.serviceId!, /no services available/i);
  });

  it('requires a problem description', () => {
    const errors = validateBooking(check({ problemDescription: '   ' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.problemDescription!, /describe the problem/i);
  });

  it('rejects a problem description under 3 characters', () => {
    const errors = validateBooking(check({ problemDescription: 'ab' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.problemDescription!, /at least 3 characters/i);
  });

  it('rejects a problem description over 2000 characters', () => {
    const errors = validateBooking(check({ problemDescription: 'x'.repeat(PROBLEM_MAX + 1) }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.problemDescription!, /under 2000 characters/i);
  });

  it('requires an address', () => {
    const errors = validateBooking(check({ address: '' }).values, { hasServices: true, now: NOW });
    assert.match(errors.address!, /address where the service is needed/i);
  });

  it('does not require notes', () => {
    const errors = validateBooking(check({ notes: '' }).values, { hasServices: true, now: NOW });
    assert.equal(errors.notes, undefined);
  });

  it('rejects a past date', () => {
    const errors = validateBooking(check({ date: '2026-01-01' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.date!, /today or a future date/i);
  });

  it('rejects a date beyond the one-year horizon', () => {
    const errors = validateBooking(check({ date: '2027-06-01' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.date!, /up to a year in advance/i);
  });

  it('rejects a time that has already passed today', () => {
    const errors = validateBooking(check({ date: '2026-01-15', time: '09:00' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.time!, /already passed|at least 30 minutes/i);
  });

  it('rejects a time inside the minimum lead time', () => {
    const errors = validateBooking(check({ date: '2026-01-15', time: '12:10' }).values, {
      hasServices: true,
      now: NOW,
    });
    assert.match(errors.time!, /at least 30 minutes/i);
  });

  it('reports every empty required field at once', () => {
    const errors = validateBooking(
      { serviceId: '', date: '', time: '', problemDescription: '', address: '', notes: '' },
      { hasServices: true, now: NOW },
    );
    assert.equal(Object.keys(errors).length, 5);
  });
});

/* --------------------------------------------------------------- helpers -- */

describe('canCustomerCancel', () => {
  it('allows cancelling a pending or accepted booking', () => {
    assert.equal(canCustomerCancel('PENDING'), true);
    assert.equal(canCustomerCancel('ACCEPTED'), true);
  });

  it('refuses every terminal or in-progress status', () => {
    for (const status of ['REJECTED', 'CANCELLED', 'COMPLETED', 'IN_PROGRESS'] as const) {
      assert.equal(canCustomerCancel(status), false, `${status} must not be cancellable`);
    }
  });
});

describe('summarise', () => {
  it('collapses whitespace and truncates long text', () => {
    assert.equal(summarise('a\n\n  b   c'), 'a b c');
    assert.equal(summarise('x'.repeat(200)).length, 120);
  });

  it('renders a dash for missing text rather than a blank', () => {
    assert.equal(summarise(null), '—');
  });
});

describe('shortAddress', () => {
  it('truncates a long address with an ellipsis', () => {
    const long = '42 Maple Street, Apartment 3B, Riverside, Very Long Town Name, Country';
    assert.ok(shortAddress(long)!.endsWith('…'));
    assert.ok(shortAddress(long)!.length <= 58);
  });

  it('keeps a short address intact', () => {
    assert.equal(shortAddress('42 Maple Street'), '42 Maple Street');
  });
});

describe('formatDuration', () => {
  it('formats minutes, whole hours and mixed durations', () => {
    assert.equal(formatDuration(45), '45 min');
    assert.equal(formatDuration(120), '2 hr');
    assert.equal(formatDuration(150), '2 hr 30 min');
    assert.equal(formatDuration(null), null);
  });
});

/* ------------------------------------------------------------- components -- */

const SERVICE: PublicService = {
  id: 's1',
  name: 'Plumbing repair',
  description: 'Leaks, taps and blocked drains.',
  priceFrom: '90.00',
  priceTo: '150.00',
  durationMinutes: 90,
  category: { slug: 'plumbing', name: 'Plumbing' },
  // Service photos (Phase 21). Empty here: this fixture exercises the booking
  // card, and the "no photos" path is the one worth pinning for it.
  images: [],
};

const BOOKING: Booking = {
  id: 'b1',
  status: 'PENDING',
  scheduledAt: '2026-12-01T14:00:00.000Z',
  durationMinutes: 90,
  address: '42 Maple Street',
  notes: null,
  problemDescription: 'Kitchen tap is dripping constantly.',
  priceQuote: '90.00',
  cancellationReason: null,
  rejectionReason: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  service: { id: 's1', name: 'Plumbing repair' },
  provider: { id: 'p1', businessName: 'Acme Plumbing' },
  customerName: 'Alex',
};

describe('ServicePicker', () => {
  it('renders one radio per active service, inside a labelled group', () => {
    const html = renderToStaticMarkup(
      <ServicePicker services={[SERVICE]} value="" onChange={() => {}} name="serviceId" />,
    );
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /aria-label="Available services"/);
    assert.match(html, /type="radio"/);
    assert.match(html, /value="s1"/);
  });

  it('shows name, price range and duration for each service', () => {
    const html = renderToStaticMarkup(
      <ServicePicker services={[SERVICE]} value="" onChange={() => {}} name="serviceId" />,
    );
    assert.match(html, /Plumbing repair/);
    assert.match(html, /₹90 – ₹150/);
    assert.match(html, /1 hr 30 min/);
  });

  it('marks the selected service as checked', () => {
    const html = renderToStaticMarkup(
      <ServicePicker services={[SERVICE]} value="s1" onChange={() => {}} name="serviceId" />,
    );
    assert.match(html, /checked=""/);
  });

  it('shows a clear empty state and no radio when there are no services', () => {
    const html = renderToStaticMarkup(
      <ServicePicker services={[]} value="" onChange={() => {}} name="serviceId" />,
    );
    assert.match(html, /No services available/);
    assert.ok(!/type="radio"/.test(html), 'no selectable service may be offered');
  });
});

describe('BookingStatusBadge', () => {
  it('renders the status as text, not colour alone', () => {
    const html = renderToStaticMarkup(<BookingStatusBadge status="PENDING" />);
    assert.match(html, /Awaiting provider/);
  });

  it('gives every status a human label', () => {
    assert.match(renderToStaticMarkup(<BookingStatusBadge status="ACCEPTED" />), /Confirmed/);
    assert.match(renderToStaticMarkup(<BookingStatusBadge status="COMPLETED" />), /Completed/);
    assert.match(renderToStaticMarkup(<BookingStatusBadge status="CANCELLED" />), /Cancelled/);
    assert.match(renderToStaticMarkup(<BookingStatusBadge status="REJECTED" />), /Declined/);
  });
});

describe('BookingCard', () => {
  // BookingCard renders a react-router <Link>, so it needs a router context.
  const render = (booking: Booking) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BookingCard booking={booking} onCancel={() => {}} />
      </MemoryRouter>,
    );

  it('shows provider, service, status, address and problem summary', () => {
    const html = render(BOOKING);
    assert.match(html, /Plumbing repair/);
    assert.match(html, /Acme Plumbing/);
    assert.match(html, /Awaiting provider/);
    assert.match(html, /42 Maple Street/);
    assert.match(html, /Kitchen tap is dripping/);
  });

  it('offers a cancel action for a PENDING booking', () => {
    assert.match(render(BOOKING), /Cancel/);
  });

  it('hides the cancel action once a booking can no longer be cancelled', () => {
    const html = render({ ...BOOKING, status: 'COMPLETED' });
    assert.ok(!/Cancel\s*<\/button>/.test(html), 'completed bookings must not offer cancel');
  });

  it('links to the booking detail page', () => {
    assert.match(render(BOOKING), /href="\/bookings\/b1"/);
  });
});

describe('BookingConfirmation', () => {
  const render = () =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BookingConfirmation booking={BOOKING} providerId="p1" />
      </MemoryRouter>,
    );

  it('confirms the booking and names the provider and service', () => {
    const html = render();
    assert.match(html, /Booking requested/);
    assert.match(html, /Acme Plumbing/);
    assert.match(html, /Plumbing repair/);
  });

  it('shows the address and a PENDING status', () => {
    const html = render();
    assert.match(html, /42 Maple Street/);
    assert.match(html, /Awaiting provider/);
  });

  it('offers navigation to my bookings and back to the provider', () => {
    const html = render();
    assert.match(html, /href="\/bookings"/);
    assert.match(html, /View my bookings/);
    assert.match(html, /href="\/providers\/p1"/);
    assert.match(html, /Back to provider/);
  });

  it('does not render a second submit control', () => {
    // The confirmation must not be able to create another booking.
    const html = render();
    assert.ok(!/Request booking/.test(html));
    assert.ok(!/<form/.test(html));
  });
});

describe('UI states', () => {
  it('renders a loading state with an accessible busy flag', () => {
    const html = renderToStaticMarkup(<LoadingState label="Loading your bookings…" />);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading your bookings/);
  });

  it('renders an error state with role=alert semantics via the Alert box', () => {
    const html = renderToStaticMarkup(<Alert>Something went wrong.</Alert>);
    assert.match(html, /role="alert"/);
  });

  it('renders an error state with a retry affordance', () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Could not load" message="Try again." onRetry={() => {}} />,
    );
    assert.match(html, /Could not load/);
    assert.match(html, /Try again/);
  });
});

describe('BookingForm', () => {
  const PROVIDER = {
    id: 'p1',
    businessName: 'Acme Plumbing',
    description: 'Friendly plumbing repairs.',
    city: 'Springfield',
    serviceAreas: ['Springfield'],
    yearsExperience: 9,
    profileImageUrl: null,
    coverImageUrl: null,
    verifiedAt: null,
    rating: 4.8,
    reviewCount: 21,
    priceFrom: '90.00',
    activeServiceCount: 1,
    isAvailable: true,
    categories: [{ slug: 'plumbing', name: 'Plumbing' }],
    services: [SERVICE],
    images: [],
    reviews: [],
  };

  const render = (provider: typeof PROVIDER) =>
    renderToStaticMarkup(<BookingForm provider={provider} onCreated={() => {}} />);

  it('renders a labelled control for every required field', () => {
    const html = render(PROVIDER);
    for (const id of [
      'booking-problemDescription',
      'booking-date',
      'booking-time',
      'booking-address',
      'booking-notes',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${id} must be rendered`);
    }
    assert.match(html, /Describe the problem/);
    assert.match(html, /Preferred date/);
    assert.match(html, /Preferred time/);
    assert.match(html, /Service address/);
  });

  it('uses a real date input and a real time input', () => {
    const html = render(PROVIDER);
    assert.match(html, /type="date"/);
    assert.match(html, /type="time"/);
  });

  it('marks notes as optional', () => {
    assert.match(render(PROVIDER), /Notes[\s\S]{0,120}Optional/);
  });

  it('renders the provider as read-only context, never an editable field', () => {
    const html = render(PROVIDER);
    assert.match(html, /Acme Plumbing/);
    // The provider must not be user-editable: there is no control bound to it.
    assert.ok(!/name="providerId"/.test(html), 'providerId must not be a form control');
  });

  it('offers only the services belonging to this provider', () => {
    const html = render(PROVIDER);
    assert.match(html, /value="s1"/);
    assert.ok(!/value="other-service"/.test(html));
  });

  it('NEVER renders a customer id input', () => {
    const html = render(PROVIDER);
    assert.ok(!/customerId/i.test(html), 'the customer identity must never be a form field');
  });

  it('shows the starting price as information, with a server-authoritative note', () => {
    const html = render(PROVIDER);
    assert.match(html, /₹90/);
    assert.match(html, /final price and duration are confirmed by the provider/i);
  });

  it('disables submission and shows an empty state when the provider has no services', () => {
    const html = render({ ...PROVIDER, services: [] });
    assert.match(html, /No services available/);
    assert.match(html, /disabled=""/);
  });

  it('renders a single submit control', () => {
    const html = render(PROVIDER);
    assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  });
});




