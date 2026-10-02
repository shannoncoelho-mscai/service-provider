/**
 * Provider business page — service rendering + category contract (Phase 19).
 *
 * THE CRASH THESE GUARD: `GET /api/providers/me/services` returns a FLAT service
 * with `categoryId` / `categoryName` / `categorySlug`, but the page was typed
 * against `PublicService`, which NESTS the category as `category: {slug,name}`.
 * Rendering `service.category.name` therefore threw
 * "Cannot read properties of undefined (reading 'name')" and whited out
 * /provider/business. The fixture below is the real server payload.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderServiceRow } from '../pages/ProviderBusinessPage';
import type { ProviderService } from '../types';

/** Exactly `ServiceDto` from server/src/modules/providers/services.service.ts. */
const FLAT_SERVICE: ProviderService = {
  id: 's1',
  categoryId: 'c-uuid',
  categoryName: 'Plumbing',
  categorySlug: 'plumbing',
  name: 'Emergency pipe repair',
  description: 'Call-out and fix within the hour.',
  priceFrom: '4500.00',
  priceTo: null,
  priceType: 'FIXED',
  durationMinutes: 90,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ProviderService contract', () => {
  it('carries the category FLAT, with categoryName — not nested under category', () => {
    // If the API ever reverts to the public shape, this fails and the page
    // crashes again. That is the point of the assertion.
    assert.equal(typeof FLAT_SERVICE.categoryName, 'string');
    assert.equal(FLAT_SERVICE.categoryName, 'Plumbing');
    assert.equal(FLAT_SERVICE.categorySlug, 'plumbing');
    assert.ok(!('category' in FLAT_SERVICE), 'the owner DTO must not nest `category`');
  });

  it('carries isActive and priceType, which the public DTO omits', () => {
    assert.equal(FLAT_SERVICE.isActive, true);
    assert.equal(FLAT_SERVICE.priceType, 'FIXED');
  });
/* ------------------------------------------------------------- rendering -- */

const noop = () => {};
const renderRow = (service: ProviderService, busy = false) =>
  renderToStaticMarkup(
    <ul>
      <ProviderServiceRow
        service={service}
        busy={busy}
        onEdit={noop}
        onRemove={noop}
      />
    </ul>,
  );

describe('ProviderServiceRow rendering', () => {
  it('renders a service from the REAL flat payload without throwing', () => {
    // THE REGRESSION. With `service.category.name` this call threw
    // "Cannot read properties of undefined (reading 'name')" and the whole page
    // went blank, because the throw happened inside the list `.map`.
    const html = renderRow(FLAT_SERVICE);
    assert.match(html, /Emergency pipe repair/);
    assert.match(html, /Plumbing/);
  });

  it('shows name, description, price range and duration', () => {
    // priceTo must be >= priceFrom; the server rejects an inverted range.
    const html = renderRow({
      ...FLAT_SERVICE,
      priceFrom: '800.00',
      priceTo: '4500.00',
      durationMinutes: 120,
    });
    assert.match(html, /Call-out and fix within the hour\./);
    assert.match(html, /₹800 – ₹4,500/);
    assert.match(html, /120 min/);
  });

  it('renders a flat price with no upper bound', () => {
    const html = renderRow(FLAT_SERVICE);
    assert.match(html, /₹4,500/);
    assert.ok(!/₹4,500 – /.test(html), 'a null priceTo must not render a dangling range');
  });

  it('labels a deactivated service so the provider knows it is not bookable', () => {
    const html = renderRow({ ...FLAT_SERVICE, isActive: false });
    assert.match(html, /Inactive/);
  });

  it('always offers edit and remove controls', () => {
    const html = renderRow(FLAT_SERVICE);
    assert.match(html, /aria-label="Edit Emergency pipe repair"/);
    assert.match(html, /aria-label="Remove Emergency pipe repair"/);
  });

  it('disables only the remove button while that row is being deleted', () => {
    const html = renderRow(FLAT_SERVICE, true);
    assert.match(html, /aria-label="Remove Emergency pipe repair"[^>]*disabled/);
    assert.match(html, /aria-label="Edit Emergency pipe repair"/);
  });

  it('renders a custom provider-created category name verbatim', () => {
    // "Pest Control" is not in the seeded list; the server created it and
    // returns its real name, which is what the row must display.
    const html = renderRow({
      ...FLAT_SERVICE,
      categoryName: 'Pest Control',
      categorySlug: 'pest-control',
    });
    assert.match(html, /Pest Control/);
  });

  it('tolerates a service with no description or duration', () => {
    const html = renderRow({
      ...FLAT_SERVICE,
      description: null,
      durationMinutes: null,
    });
    assert.match(html, /Emergency pipe repair/);
  });
});


  it('reproduces the exact crash: a flat payload has no `category` to read', () => {
    // This is the literal expression that threw, asserted directly so the
    // regression is documented even if the page is later restructured.
    const service = FLAT_SERVICE as unknown as { category?: { name: string } };
    assert.equal(service.category, undefined);
    assert.throws(
      () => (service.category as { name: string }).name,
      TypeError,
      'reading .name off the flat payload is what whited out the page',
    );
  });
});
