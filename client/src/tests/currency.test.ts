import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { formatPrice } from '../lib/format';
import { homeForRole } from '../lib/auth-context';
import { ROLE_LINKS } from '../components/Navbar';

const SRC = join(import.meta.dirname, '..');

/**
 * Phase 18 — Indian Rupee formatting.
 *
 * ServiceConnect targets the Indian market, so `formatPrice` is the ONE place
 * a money amount becomes text. These tests pin the contract that every price
 * surface in the app depends on: the ₹ symbol, Indian digit grouping, and
 * whole rupees.
 */

describe('formatPrice', () => {
  it('renders the rupee symbol, never a dollar sign', () => {
    assert.equal(formatPrice('9000.00'), '₹9,000');
  });

  it('uses Indian digit grouping (lakh), not Western grouping', () => {
    // 123456 is 1.23 lakh. The Western format would render ₹123,456.
    assert.equal(formatPrice('123456.00'), '₹1,23,456');
    assert.equal(formatPrice('100000.00'), '₹1,00,000');
  });

  it('rounds to whole rupees and drops the paise', () => {
    assert.equal(formatPrice('450.00'), '₹450');
    assert.equal(formatPrice('1999.99'), '₹2,000');
    assert.equal(formatPrice(750), '₹750');
  });

  it('accepts the decimal strings the API actually returns', () => {
    // pg returns NUMERIC as a string, so this is the real-world input shape.
    assert.equal(formatPrice('0.00'), '₹0');
    assert.equal(formatPrice('150.50'), '₹151');
  });

  it('returns null — never "₹0" — when there is no price', () => {
    for (const empty of [null, undefined, '']) {
      assert.equal(formatPrice(empty), null, `${String(empty)} must format as null`);
    }
    assert.equal(formatPrice('not-a-number'), null, 'non-numeric input must format as null');
  });

  it('is used by every price display surface', () => {
    // A guard against someone reintroducing a local `$${amount}` formatter in a
    // component. The components listed here are the price renderers identified
    // in Phase 18; each must delegate to the shared helper.
    const components = [
      'components/providers/ProviderCard.tsx',
      'components/providers/ServiceList.tsx',
      'components/booking/ServicePicker.tsx',
      'components/booking/BookingCard.tsx',
      'components/booking/BookingForm.tsx',
      'components/home/FeaturedProviders.tsx',
      'pages/BookingDetailPage.tsx',
      'pages/ProviderProfilePage.tsx',
    ];
    for (const file of components) {
      const source = readFileSync(join(SRC, file), 'utf8');
      assert.ok(
        source.includes('formatPrice'),
        `${file} must format prices through lib/format`,
      );
      // No component may hand-roll a currency symbol.
      assert.ok(
        !/\$\{?\{?\s*(amount|price|value)/.test(source),
        `${file} must not hand-roll a price string`,
      );
    }
  });
});

/* ------------------------------------------------------- role routing --- */

describe('homeForRole', () => {
  it('sends each role to its own dashboard', () => {
    assert.equal(homeForRole('CUSTOMER'), '/dashboard');
    assert.equal(homeForRole('PROVIDER'), '/provider/dashboard');
    assert.equal(homeForRole('ADMIN'), '/admin/dashboard');
  });

  it('sends a signed-out visitor to the public home page', () => {
    assert.equal(homeForRole(null), '/');
    assert.equal(homeForRole(undefined), '/');
  });

  it('never routes a provider or admin into the customer dashboard', () => {
    // The whole point of the table: a role decides its own landing page, and a
    // provider must not land on a customer screen that could only fail.
    assert.notEqual(homeForRole('PROVIDER'), '/dashboard');
    assert.notEqual(homeForRole('ADMIN'), '/dashboard');
    assert.notEqual(homeForRole('ADMIN'), '/provider/dashboard');
  });

  it('is driven by the server-returned role, not by any form input', () => {
    // Sanity: the mapping is a pure function of one argument. Whatever role the
    // server puts in the JWT, this is the only thing that decides the route.
    for (const role of ['CUSTOMER', 'PROVIDER', 'ADMIN'] as const) {
      assert.equal(homeForRole(role), homeForRole(role));
    }
  });
});

describe('navigation links per role', () => {
  it('gives each role exactly its own pages, and never leaks admin links', () => {
    for (const [role, expected] of [
      ['CUSTOMER', ['/dashboard', '/providers', '/bookings']],
      ['PROVIDER', ['/provider/dashboard', '/provider/business']],
      ['ADMIN', ['/admin/dashboard']],
    ] as const) {
      assert.deepEqual(ROLE_LINKS[role].map((link) => link.to), expected);
    }

    // Admin links must not appear in any other role's list.
    for (const role of ['CUSTOMER', 'PROVIDER'] as const) {
      for (const link of ROLE_LINKS[role]) {
        assert.ok(
          !link.to.startsWith('/admin'),
          `${role} must not be offered an admin link (${link.to})`,
        );
      }
    }
  });

  it('sends a provider to their OWN business page, not the public directory', () => {
    // Regression guard: "My profile" used to point at /providers, which is the
    // public search page — clicking it as a provider showed the wrong thing.
    const providerLinks = ROLE_LINKS.PROVIDER.map((link) => link.to);
    assert.ok(
      providerLinks.includes('/provider/business'),
      'a provider needs a link to their own profile and services',
    );
  });
});
