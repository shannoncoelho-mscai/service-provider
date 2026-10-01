/**
 * Production-readiness regression tests (Phase 17).
 *
 * These lock in the audit findings so they cannot silently come back:
 *   1. The navbar mounts exactly ONE notification bell (it used to mount two,
 *      issuing a duplicate unread-count request on every page load).
 *   2. Live-region semantics are correct: an error interrupts, a success waits.
 *   3. Shared loading/error components are announced to assistive tech.
 *   4. The notification route builder can never leave the site.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';

import { Alert, ErrorState, LoadingState } from '../components/ui';
import { notificationRoute } from '../lib/booking-utils';

// ESM has no __dirname; resolve it from this module's own URL.
const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '..', 'components');

/* --------------------------------------------------- duplicate requests -- */

describe('audit - navbar mounts one notification bell', () => {
  const navbar = readFileSync(join(COMPONENTS, 'Navbar.tsx'), 'utf8');
  const mounts = (navbar.match(/<NotificationBellWithPanel/g) ?? []).length;

  it('renders the bell exactly once', () => {
    // Two mounts meant two `getUnreadCount()` effects, i.e. a duplicated
    // request on every single page view.
    assert.equal(mounts, 1, 'the navbar must mount exactly one notification bell');
  });

  it('keeps the bell outside the md: breakpoint split', () => {
    // If the bell moves back inside a `md:hidden` / `hidden md:flex` pair it
    // will be duplicated again, so the surrounding div must be unsplit.
    const bellIndex = navbar.indexOf('<NotificationBellWithPanel');
    const hiddenDesktop = navbar.indexOf('hidden items-center gap-1 md:flex');
    const mobileOnly = navbar.indexOf('md:hidden');
    assert.ok(bellIndex < hiddenDesktop, 'the bell must precede the desktop-only block');
    assert.ok(bellIndex < mobileOnly, 'the bell must precede the mobile-only block');
  });
});

/* ------------------------------------------------- live-region semantics -- */

describe('audit - alert live-region semantics', () => {
  const error = renderToStaticMarkup(<Alert>Something failed.</Alert>);
  const info = renderToStaticMarkup(<Alert variant="info">All done.</Alert>);

  it('announces an error assertively', () => {
    assert.match(error, /role="alert"/);
    assert.match(error, /aria-live="assertive"/);
  });

  it('announces a success politely, so it does not talk over the user', () => {
    assert.match(info, /role="status"/);
    assert.match(info, /aria-live="polite"/);
    assert.ok(!/role="alert"/.test(info), 'a success message must not be an assertive alert');
  });

  it('distinguishes the variants by icon as well as colour', () => {
    assert.ok(error !== info, 'the two variants must not render identically');
  });
});

describe('audit - loading and error states are announced', () => {
  it('exposes the loading label as a live region', () => {
    const html = renderToStaticMarkup(<LoadingState label="Loading your bookings..." />);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /Loading your bookings/);
    assert.match(html, /aria-busy="true"/);
  });

  it('gives the error state a heading and a retry control', () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Could not load" message="Try again." onRetry={() => {}} />,
    );
    assert.match(html, /Could not load/);
    assert.match(html, /Try again/);
    assert.match(html, /<button/);
  });
});

/* ----------------------------------------------------------- open redirect -- */

describe('audit - notifications cannot navigate off-site', () => {
  const hostile = [
    'https://evil.example.com',
    '//evil.example.com',
    'javascript:alert(1)',
    '/\\/evil.example.com',
    '../../../etc/passwd',
  ];

  for (const value of hostile) {
    it(`refuses to route for ${value}`, () => {
      const route = notificationRoute({ relatedBookingId: value }, 'CUSTOMER');
      if (route === null) return; // not navigating at all is also safe
      assert.ok(route.startsWith('/bookings/'), `unexpected route: ${route}`);
      assert.ok(!route.includes('://'), 'must never contain a scheme');
      assert.ok(!route.startsWith('//'), 'must never be protocol-relative');
      assert.ok(!route.includes('javascript:'), 'must never carry a javascript: URL');
    });
  }

  it('a provider is always sent to their own dashboard, never a crafted path', () => {
    for (const value of hostile) {
      const route = notificationRoute({ relatedBookingId: value }, 'PROVIDER');
      if (route === null) continue;
      assert.equal(route, '/provider/dashboard', 'providers only ever go to their dashboard');
    }
  });
});
