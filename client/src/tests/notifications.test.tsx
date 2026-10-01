/**
 * Notification component + helper tests (ADR-029).
 *
 * The two behaviours worth testing hard: the unread badge must not appear at
 * zero, and a notification must never be able to steer the browser to a URL the
 * API supplied.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  notificationRoute,
  notificationTone,
  relativeTime,
  unreadBadgeLabel,
} from '../lib/booking-utils';
import { NotificationBell } from '../components/notifications';
import NotificationRow from '../components/notifications/NotificationRow';
import type { Notification } from '../types';

// A real booking id is a UUID (the column type guarantees it). Phase 17
// tightened `notificationRoute` to require one, so the fixture uses a real UUID.
const BOOKING_ID = '11111111-2222-4333-8444-555555555555';

function make(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'BOOKING_ACCEPTED',
    title: 'Your booking was accepted',
    message: 'The provider accepted your booking.',
    relatedBookingId: BOOKING_ID,
    readAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

const noop = () => {};

/* -------------------------------------------------------------- badge -- */

describe('unreadBadgeLabel', () => {
  it('returns null at zero so no badge is rendered', () => {
    assert.equal(unreadBadgeLabel(0), null);
  });

  it('returns null for a negative or non-finite count', () => {
    assert.equal(unreadBadgeLabel(-1), null);
    assert.equal(unreadBadgeLabel(NaN), null);
  });

  it('renders 1 to 99 as a plain number', () => {
    assert.equal(unreadBadgeLabel(1), '1');
    assert.equal(unreadBadgeLabel(42), '42');
    assert.equal(unreadBadgeLabel(99), '99');
  });

  it('caps at 99+ so the navbar cannot overflow', () => {
    assert.equal(unreadBadgeLabel(100), '99+');
    assert.equal(unreadBadgeLabel(5000), '99+');
  });
});

describe('NotificationBell', () => {
  const render = (count: number, open = false) =>
    renderToStaticMarkup(<NotificationBell count={count} open={open} onToggle={noop} />);

  it('renders no badge at zero', () => {
    const html = render(0);
    assert.ok(!/>1</.test(html), 'a zero badge must not be rendered');
    assert.match(html, /none unread/);
  });

  it('renders the unread number', () => {
    assert.match(render(5), />5</);
  });

  it('renders 99+ for a large count', () => {
    assert.match(render(120), /99\+/);
  });

  it('reports its expanded state to assistive tech', () => {
    assert.match(render(0, true), /aria-expanded="true"/);
    assert.match(render(0, false), /aria-expanded="false"/);
  });
});

/* --------------------------------------------------------------- routes -- */

describe('notificationRoute', () => {
  it('builds a booking route from the related booking id', () => {
    assert.equal(notificationRoute(make(), 'CUSTOMER'), '/bookings/' + BOOKING_ID);
  });

  it('sends a provider to their dashboard, which is their only booking view', () => {
    assert.equal(notificationRoute(make(), 'PROVIDER'), '/provider/dashboard');
  });

  it('returns null when there is no related booking', () => {
    assert.equal(notificationRoute(make({ relatedBookingId: null }), 'CUSTOMER'), null);
    assert.equal(notificationRoute(make({ relatedBookingId: null }), 'PROVIDER'), null);
  });

  it('never returns a URL ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â only an internal path built from our own id', () => {
    const route = notificationRoute(make(), 'CUSTOMER');
    assert.ok(route!.startsWith('/'), 'a notification must never navigate off-site');
    assert.ok(!route!.includes('://'), 'no absolute URL may ever be produced');
    assert.ok(!route!.startsWith('//'), 'no protocol-relative URL may ever be produced');
  });

  it('refuses a relatedBookingId that is not a UUID, so it can never escape the route', () => {
    // Phase 17: rather than interpolating an arbitrary string into a path
    // segment and relying on the router to contain it, the value must be a
    // UUID or there is no route at all.
    for (const hostile of [
      'https://evil.example.com/steal',
      '//evil.example.com',
      'javascript:alert(1)',
      '../../../etc/passwd',
      'b1',
    ]) {
      assert.equal(
        notificationRoute(make({ relatedBookingId: hostile }), 'CUSTOMER'),
        null,
        'a non-UUID id must never produce a route: ' + hostile,
      );
    }
  });

});

describe('notificationTone', () => {
  it('gives each known type a tone', () => {
    for (const type of [
      'BOOKING_CREATED',
      'BOOKING_ACCEPTED',
      'BOOKING_REJECTED',
      'BOOKING_CANCELLED',
      'BOOKING_IN_PROGRESS',
      'BOOKING_COMPLETED',
      'REVIEW_SUBMITTED',
    ]) {
      assert.ok(notificationTone(type), `${type} must have a tone`);
    }
  });

  it('falls back to a default for an unknown type', () => {
    assert.equal(notificationTone('SOMETHING_NEW'), 'brand');
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  it('formats recent and older timestamps', () => {
    assert.equal(relativeTime('2026-01-15T11:59:30', now), 'just now');
    assert.equal(relativeTime('2026-01-15T11:30:00', now), '30 min ago');
    assert.equal(relativeTime('2026-01-15T06:00:00', now), '6 hr ago');
    assert.equal(relativeTime('2026-01-13T12:00:00', now), '2 days ago');
  });

  it('returns an empty string for an unparseable date', () => {
    assert.equal(relativeTime('not-a-date', now), '');
  });
});

/* ---------------------------------------------------------------- rows -- */

describe('NotificationRow', () => {
  const render = (n: Notification) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <NotificationRow notification={n} to="/bookings/b1" onSelect={noop} />
      </MemoryRouter>,
    );

  it('shows the title, message and a relative timestamp', () => {
    const html = render(make());
    assert.match(html, /Your booking was accepted/);
    assert.match(html, /The provider accepted your booking/);
    assert.match(html, /ago|just now/);
  });

  it('marks an unread row for assistive tech, not by colour alone', () => {
    assert.match(render(make({ readAt: null })), /\(Unread\)/);
  });

  it('marks a read row for assistive tech', () => {
    assert.match(render(make({ readAt: '2026-10-01T11:00:00.000Z' })), /\(Read\)/);
  });

  it('is a real button so it is keyboard reachable', () => {
    const html = render(make());
    assert.match(html, /<button/);
    assert.match(html, /type="button"/);
  });

  it('renders a row with no route without offering navigation', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationRow notification={make()} to={null} onSelect={noop} />
      </MemoryRouter>,
    );
    assert.ok(!/href=/.test(html), 'a row with no route must not render a link');
  });

  it('never renders anything beyond the payload it is given', () => {
    const html = render(make());
    assert.ok(!/href="http/.test(html), 'no external link may be rendered');
  });
});
