import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminBusinessImages from '../components/admin/AdminBusinessImages';
import ServiceImages from '../components/provider/ServiceImages';
import ServiceList from '../components/providers/ServiceList';
import {
  IMAGE_ACCEPT,
  IMAGE_ACCEPT_LABEL,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_FILES,
  validateFiles,
} from '../lib/api';
import type { AdminProviderImage, PublicService } from '../types';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Service images + admin review gallery - frontend (Phase 21).
 *
 * `ServiceImages` fetches on mount, which server rendering does not run, so what
 * is covered here is everything that IS pure: the empty/loading markup, the
 * shared upload validation, and - most importantly - the customer-facing
 * `ServiceList`, whose optional-image behaviour is the whole point of Part 5.
 *
 * The multipart request itself is covered server-side against real FormData
 * bodies (server/src/tests/service-images.test.ts).
 */

const SERVICE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function fakeFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as File;
}

function service(overrides: Partial<PublicService> = {}): PublicService {
  return {
    id: SERVICE_ID,
    name: 'AC Repair',
    description: 'Split AC servicing and gas refill.',
    priceFrom: '800.00',
    priceTo: '1500.00',
    durationMinutes: 60,
    category: { slug: 'ac-repair', name: 'AC Repair' },
    images: [],
    ...overrides,
  };
}

/* ------------------------------------------------ customer-facing display -- */

describe('ServiceList renders service photos when present', () => {
  it('shows a photo strip with a useful alt text', () => {
    const html = renderToStaticMarkup(
      <ServiceList
        services={[
          service({
            images: [
              { url: 'http://localhost:4000/uploads/providers/ac-unit.png', altText: 'Split AC unit' },
            ],
          }),
        ]}
      />,
    );
    assert.match(html, /ac-unit\.png/, 'the photo must render');
    assert.match(html, /Split AC unit/, 'alt text is rendered, not dropped');
    assert.match(html, /Photos of AC Repair/, 'the strip is labelled for screen readers');
  });

  it('falls back to a descriptive alt when the provider set none', () => {
    const html = renderToStaticMarkup(
      <ServiceList
        services={[service({ images: [{ url: 'http://localhost:4000/a.png', altText: null }] })]}
      />,
    );
    assert.match(html, /alt="AC Repair by this provider"/, 'never an empty alt');
  });

  it('keeps the existing layout when a service has no photos', () => {
    const withPhotos = renderToStaticMarkup(
      <ServiceList services={[service({ images: [{ url: 'http://x/a.png', altText: null }] })]} />,
    );
    const without = renderToStaticMarkup(<ServiceList services={[service()]} />);
    assert.ok(!without.includes('Photos of'), 'no empty strip is rendered');
    // Name, price and duration must survive in BOTH cases.
    for (const html of [withPhotos, without]) {
      assert.match(html, /AC Repair/);
      assert.match(html, /1 hr/);
    }
  });

  it('still reports the empty-catalogue message', () => {
    const html = renderToStaticMarkup(<ServiceList services={[]} />);
    assert.match(html, /no active services/i);
  });
});
/* ------------------------------------------- provider management component -- */

describe('ServiceImages component', () => {
  it('renders the loading shell without touching the network', () => {
    const html = renderToStaticMarkup(<ServiceImages serviceId={SERVICE_ID} />);
    assert.match(html, /Service Images/, 'the section heading is present');
    assert.match(html, /Loading service images/, 'first paint is the loading state');
  });

  it('explains that service photos differ from business photos', () => {
    const html = renderToStaticMarkup(<ServiceImages serviceId={SERVICE_ID} />);
    assert.match(html, /specific to this service/i);
    assert.match(html, /separate from your general business photos/i);
  });

  it('offers a multi-select input with the shared accept list', () => {
    const html = renderToStaticMarkup(<ServiceImages serviceId={SERVICE_ID} />);
    assert.match(html, /type="file"/);
    assert.match(html, /multiple/);
    assert.ok(html.includes(IMAGE_ACCEPT), 'the accept attribute mirrors the server allow-list');
    assert.match(html, /Add photos for this service/);
  });

  it('gives each service instance its own input id so two never collide', () => {
    const a = renderToStaticMarkup(<ServiceImages serviceId="service-a" />);
    const b = renderToStaticMarkup(<ServiceImages serviceId="service-b" />);
    assert.match(a, /service-image-input-service-a/);
    assert.match(b, /service-image-input-service-b/);
    assert.notEqual(a, b, 'the two instances must not render identically');
  });

  it('states the same limits the server enforces', () => {
    const html = renderToStaticMarkup(<ServiceImages serviceId={SERVICE_ID} />);
    assert.ok(html.includes(IMAGE_ACCEPT_LABEL), 'the accepted formats are named');
    assert.match(html, /5 MB each/);
    assert.match(html, new RegExp(String(MAX_IMAGE_FILES)));
  });

  it('offers no "primary" control: that concept does not exist per service', () => {
    const html = renderToStaticMarkup(<ServiceImages serviceId={SERVICE_ID} />);
    assert.ok(!/Primary/.test(html), 'service photos have no primary flag');
  });
});

/* ----------------------------------------------- admin review, read-only --- */

const ADMIN_IMAGES: AdminProviderImage[] = [
  {
    id: 'img-1',
    url: 'http://localhost:4000/uploads/providers/shopfront.jpg',
    altText: 'Shopfront in Panaji',
    isPrimary: true,
    sortOrder: 0,
  },
  {
    id: 'img-2',
    url: 'http://localhost:4000/uploads/providers/van.jpg',
    altText: null,
    isPrimary: false,
    sortOrder: 1,
  },
];

describe('AdminBusinessImages', () => {
  it('shows every photo the provider uploaded', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={ADMIN_IMAGES} />);
    assert.match(html, /shopfront\.jpg/);
    assert.match(html, /van\.jpg/);
    assert.match(html, /2 uploaded/);
  });

  it('marks the primary photo', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={ADMIN_IMAGES} />);
    assert.match(html, /Primary/);
  });

  it('renders the caption when the provider supplied alt text', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={ADMIN_IMAGES} />);
    assert.match(html, /Shopfront in Panaji/);
  });

  it('falls back to a generic alt rather than an empty attribute', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={ADMIN_IMAGES} />);
    assert.match(html, /alt="Business photo uploaded by this provider"/);
  });

  it('is READ-ONLY: it exposes no upload, delete or edit control', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={ADMIN_IMAGES} />);
    assert.ok(!/<input[^>]*type="file"/.test(html), 'an admin must not upload');
    assert.ok(!/<button/i.test(html), 'an admin must not delete or reorder');
    assert.match(html, /Read-only/, 'the screen states this');
  });

  it('explains the empty state instead of rendering a bare section', () => {
    const html = renderToStaticMarkup(<AdminBusinessImages images={[]} />);
    assert.match(html, /0 uploaded/);
    assert.match(html, /has not uploaded any business photos/i);
    assert.ok(!html.includes('Primary'), 'no badge when there is nothing to badge');
  });
});
/* ------------------------------------------------------ shared validation - */

describe('validateFiles is shared by both galleries', () => {
  it('accepts the three supported types', () => {
    assert.equal(
      validateFiles([
        fakeFile('a.jpg', 'image/jpeg'),
        fakeFile('b.png', 'image/png'),
        fakeFile('c.webp', 'image/webp'),
      ]),
      null,
    );
  });

  it('rejects an empty selection', () => {
    assert.match(validateFiles([]) ?? '', /at least one/i);
  });

  it('rejects a non-image', () => {
    assert.match(validateFiles([fakeFile('a.pdf', 'application/pdf')]) ?? '', /not supported/i);
  });

  it('rejects an oversized image', () => {
    assert.match(
      validateFiles([fakeFile('big.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1)]) ?? '',
      /5 MB or smaller/i,
    );
  });

  it('rejects more files than the limit', () => {
    const many = Array.from({ length: MAX_IMAGE_FILES + 1 }, () => fakeFile('a.png', 'image/png'));
    assert.match(validateFiles(many) ?? '', new RegExp(`at most ${MAX_IMAGE_FILES}`));
  });
});

/* ------------------------------------------------------------ source guards */

describe('the two galleries are kept distinct in source', () => {
  it('ServiceList must not fall back to the provider-level gallery', () => {
    const src = readFileSync(join(SRC, 'components/providers/ServiceList.tsx'), 'utf8');
    // Service photos come from the service row only. Reaching for the provider
    // profile here would silently show business photos as service photos.
    assert.ok(!/profileImageUrl|coverImageUrl/.test(src), 'no business-image fallback');
    assert.match(src, /service\.images/, 'reads the per-service images');
  });

  it('the admin review surface never calls an image-mutating API function', () => {
    const src = readFileSync(join(SRC, 'components/admin/AdminBusinessImages.tsx'), 'utf8');
    for (const fn of ['uploadProviderImages', 'deleteProviderImage', 'uploadServiceImages']) {
      assert.ok(!src.includes(fn), `admin review must not call ${fn}`);
    }
  });

  it('the service editor mounts ServiceImages only for a saved service', () => {
    const src = readFileSync(join(SRC, 'pages/ProviderBusinessPage.tsx'), 'utf8');
    // A brand-new service has no id to attach photos to, so the section must be
    // gated on `editing.id` rather than rendered and silently failing.
    assert.match(src, /editing\.id && <ServiceImages/);
  });
});