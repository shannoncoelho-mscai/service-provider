import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import BusinessImages, { readableSize, validateFiles } from '../components/provider/BusinessImages';
import {
  ApiError,
  deleteProviderImage,
  IMAGE_ACCEPT,
  IMAGE_ACCEPT_LABEL,
  listMyProviderImages,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_FILES,
  uploadProviderImages,
} from '../lib/api';
import type { ProviderImage } from '../types';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Provider business images — frontend (Phase 20).
 *
 * The component fetches on mount, which server rendering does not run, so these
 * cover the parts that are pure: the markup shell, and the pre-flight file
 * validation that stops an obviously bad file before the request is sent.
 * The multipart request itself is covered server-side against a real FormData
 * body (server/src/tests/images.test.ts).
 */

/** A File stand-in with the fields the validator reads. */
function fakeFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as File;
}

describe('upload limits mirrored on the client', () => {
  it('matches the server rules the UI advertises', () => {
    assert.equal(IMAGE_ACCEPT, 'image/jpeg,image/png,image/webp');
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
    assert.equal(MAX_IMAGE_FILES, 10);
    assert.match(IMAGE_ACCEPT_LABEL, /JPG/);
    assert.match(IMAGE_ACCEPT_LABEL, /PNG/);
    assert.match(IMAGE_ACCEPT_LABEL, /WebP/);
  });
});

describe('validateFiles', () => {
  it('accepts JPG, PNG and WebP', () => {
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
    assert.match(validateFiles([]) ?? '', /at least one image/i);
  });

  it('rejects an unsupported type BEFORE the request', () => {
    for (const type of ['application/pdf', 'image/gif', 'image/svg+xml', 'text/plain']) {
      const problem = validateFiles([fakeFile('doc.pdf', type)]);
      assert.match(problem ?? '', /not supported/i, `${type} must be rejected client-side`);
      assert.match(problem ?? '', new RegExp(IMAGE_ACCEPT_LABEL));
    }
  });

  it('rejects an oversized file and names it', () => {
    const problem = validateFiles([
      fakeFile('huge.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1),
    ]);
    assert.match(problem ?? '', /huge\.jpg/);
    assert.match(problem ?? '', /5 MB or smaller/);
  });

  it('accepts a file exactly at the size limit', () => {
    assert.equal(validateFiles([fakeFile('edge.jpg', 'image/jpeg', MAX_IMAGE_BYTES)]), null);
  });

  it('rejects more than the per-request maximum', () => {
    const many = Array.from({ length: MAX_IMAGE_FILES + 1 }, (_, i) =>
      fakeFile(`p${i}.jpg`, 'image/jpeg'),
    );
    assert.match(validateFiles(many) ?? '', new RegExp(`at most ${MAX_IMAGE_FILES}`));
  });

  it('accepts exactly the per-request maximum', () => {
    const many = Array.from({ length: MAX_IMAGE_FILES }, (_, i) =>
      fakeFile(`p${i}.jpg`, 'image/jpeg'),
    );
    assert.equal(validateFiles(many), null);
  });

  it('names the offending file, not a generic failure', () => {
    const problem = validateFiles([
      fakeFile('ok.jpg', 'image/jpeg'),
      fakeFile('bad.pdf', 'application/pdf'),
    ]);
    assert.match(problem ?? '', /bad\.pdf/);
  });
});

describe('readableSize', () => {
  it('renders sizes a provider can act on', () => {
    assert.match(readableSize(512), /B$/);
    assert.match(readableSize(2048), /KB$/);
    assert.match(readableSize(5 * 1024 * 1024), /5\.0 MB$/);
  });
});

describe('BusinessImages markup', () => {
  const html = renderToStaticMarkup(<BusinessImages />);

  it('renders a labelled Business Images section', () => {
    assert.match(html, /Business Images/);
    assert.match(html, /aria-labelledby="business-images-heading"/);
  });

  it('states the accepted types and the size limit up front', () => {
    assert.match(html, /JPG, PNG or WebP/);
    assert.match(html, /5 MB each/);
    assert.match(html, new RegExp(`up to ${MAX_IMAGE_FILES} at a time`));
  });

  it('offers a multiple file input restricted to the accepted types', () => {
    assert.match(html, /type="file"/);
    assert.match(html, /multiple/);
    assert.match(html, new RegExp(`accept="${IMAGE_ACCEPT}"`));
  });
});


/* ------------------------------------------------------------ the requests -- */

interface Captured {
  url: string;
  method: string;
  contentType: string | undefined;
  isFormData: boolean;
  fieldNames: string[];
}

let captured: Captured | null = null;

function stubFetch(status: number, payload: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const body = init.body as FormData | undefined;
    const headers = init.headers as Record<string, string> | undefined;
    captured = {
      url: String(url),
      method: init.method ?? 'GET',
      // Must be undefined: the browser generates the multipart boundary itself.
      contentType: headers?.['Content-Type'],
      isFormData: body instanceof FormData,
      fieldNames: body instanceof FormData ? Array.from(body.keys()) : [],
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  captured = null;
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});

const IMAGE: ProviderImage = {
  id: 'img-1',
  url: 'http://localhost:4000/uploads/providers/abc.jpg',
  altText: null,
  isPrimary: true,
  sortOrder: 0,
};

const fakeUploadFile = (): File =>
  ({ name: 'shot.jpg', type: 'image/jpeg', size: 2048 }) as File;

describe('image requests', () => {
  it('uploads as multipart FormData, never JSON', async () => {
    stubFetch(201, { images: [IMAGE] });
    await uploadProviderImages([fakeUploadFile()]);

    assert.ok(captured, 'a request must have been made');
    assert.equal(captured.url, '/api/providers/me/images');
    assert.equal(captured.method, 'POST');
    assert.ok(captured.isFormData, 'the body must be FormData');
    // A hand-set JSON Content-Type would destroy the multipart boundary.
    assert.equal(
      captured.contentType,
      undefined,
      'the client must not set Content-Type for a multipart body',
    );
    assert.deepEqual(captured.fieldNames, ['images']);
  });

  it('sends NO provider id — ownership comes from the session', async () => {
    stubFetch(201, { images: [IMAGE] });
    await uploadProviderImages([fakeUploadFile()], { altText: 'Our shopfront' });

    assert.ok(captured);
    assert.deepEqual(
      captured.fieldNames.filter((name) => /id$/i.test(name)),
      [],
      'no id field may accompany an upload',
    );
  });

  it('deletes by image id only, with no provider id in the path', async () => {
    stubFetch(204, null);
    await deleteProviderImage(IMAGE.id);

    assert.ok(captured);
    assert.equal(captured.method, 'DELETE');
    assert.equal(captured.url, `/api/providers/me/images/${IMAGE.id}`);
    assert.ok(!/providerId|userId/.test(captured.url), 'the path carries only the image id');
  });

  it('lists own images from the session-scoped endpoint', async () => {
    stubFetch(200, { images: [IMAGE] });
    const images = await listMyProviderImages();

    assert.ok(captured);
    assert.equal(captured.url, '/api/providers/me/images');
    assert.equal(images.length, 1);
    assert.equal(images[0].isPrimary, true, 'the management shape exposes the primary flag');
  });

  it('refuses an empty selection before making a request', async () => {
    stubFetch(201, { images: [] });
    await assert.rejects(
      () => uploadProviderImages([]),
      (error: unknown) => error instanceof ApiError,
    );
    assert.equal(captured, null, 'no request may be sent for an empty selection');
  });

  it('surfaces the server limit message when an upload is rejected', async () => {
    stubFetch(413, { error: { status: 413, message: 'Each image must be 5 MB or smaller' } });
    await assert.rejects(
      () => uploadProviderImages([fakeUploadFile()]),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 413);
        assert.match(error.message, /5 MB or smaller/);
        return true;
      },
    );
  });

  it('surfaces a delete rejection', async () => {
    stubFetch(404, { error: { status: 404, message: 'Image not found' } });
    await assert.rejects(
      () => deleteProviderImage('missing'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe('BusinessImages composition', () => {
  it('is mounted on the provider business page', () => {
    const page = readFileSync(join(SRC, 'pages', 'ProviderBusinessPage.tsx'), 'utf8');
    assert.match(page, /<BusinessImages \/>/, 'the gallery must be on My Business');
  });
});