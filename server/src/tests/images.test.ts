import assert from 'node:assert/strict';
import { existsSync, promises as fsp } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'node:path';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { PROVIDER_UPLOADS_DIR } from '../config/uploads';
import { MAX_IMAGE_BYTES, MAX_IMAGE_FILES } from '../middleware/upload';

/**
 * Provider business image management tests (Phase 20).
 *
 * Run: npm test --workspace server   (requires DB + migrations)
 *
 * Covers upload policy (type / size / count), ownership (a provider can only
 * ever touch their own rows), the primary-image invariant, and that a delete
 * removes the file from disk as well as the row.
 *
 * Real multipart bodies are built by hand so the tests are honest about what
 * the server actually receives, rather than mocking Multer away.
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  providerA: `img-a-${runId}@example.com`,
  providerB: `img-b-${runId}@example.com`,
  customer: `img-cust-${runId}@example.com`,
  admin: `img-admin-${runId}@example.com`,
};

let tokenA = '';
let tokenB = '';
let tokenCustomer = '';
let tokenAdmin = '';
let providerAId = '';
let providerBId = '';

const API = '/api/providers/me/images';

/** Image bytes. The server checks the DECLARED MIME type, not the magic
 *  number, so filler bytes are enough to exercise the policy. */
function imageBytes(fill: string, bytes = 64): Uint8Array {
  return new Uint8Array(bytes).fill(fill.charCodeAt(0));
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

/** POST a real multipart body. */
async function upload(
  token: string | undefined,
  files: Array<{ name: string; type: string; bytes: Uint8Array }>,
  fields: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    form.append('images', new Blob([file.bytes], { type: file.type }), file.name);
  }
  const res = await fetch(`${base}${API}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

const JPG = (n = 64) => ({ name: 'photo.jpg', type: 'image/jpeg', bytes: imageBytes('J', n) });
const PNG = (n = 64) => ({ name: 'photo.png', type: 'image/png', bytes: imageBytes('P', n) });
const WEBP = (n = 64) => ({ name: 'photo.webp', type: 'image/webp', bytes: imageBytes('W', n) });

async function registerProvider(email: string, fullName: string, business: string) {
  const res = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName,
    role: 'PROVIDER',
    provider: { businessName: business, city: 'Panaji' },
  });
  assert.equal(res.status, 201, `register ${email} failed`);
  return { token: res.data.token as string, id: res.data.user.id as string };
}

async function registerCustomer(email: string) {
  const res = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: 'Casey Customer',
    role: 'CUSTOMER',
  });
  assert.equal(res.status, 201);
  return res.data.token as string;
}

async function adminToken(): Promise<string> {
  const created = await call('POST', '/api/auth/register', {
    email: emails.admin,
    password: 'StrongPass123!',
    fullName: 'Admin User',
    role: 'CUSTOMER',
  });
  const id = created.data.user.id;
  // ADMIN accounts are provisioned out of band, never by public registration,
  // so the test promotes the row directly and then logs in properly.
  await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [id]);
  const login = await call('POST', '/api/auth/login', {
    email: emails.admin,
    password: 'StrongPass123!',
  });
  assert.equal(login.status, 200);
  return login.data.token as string;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const a = await registerProvider(emails.providerA, 'Image Owner', 'Gallery Co');
  tokenA = a.token;
  providerAId = a.id;
  const b = await registerProvider(emails.providerB, 'Other Owner', 'Second Co');
  tokenB = b.token;
  providerBId = b.id;
  tokenCustomer = await registerCustomer(emails.customer);
  tokenAdmin = await adminToken();

  assert.ok(
    existsSync(PROVIDER_UPLOADS_DIR),
    'the upload directory must be created automatically at boot',
  );
});

/**
 * Remove everything this file created.
 *
 * The suites share one database, so leaving approved, service-less providers
 * behind would perturb `search.test.ts`, which asserts a global price ordering
 * (`price_min` is NULL for a provider with no services, and `Number(null)` is
 * 0).
 *
 * Order matters. `admin_action_log.admin_id` is `ON DELETE RESTRICT`, so the log
 * rows this suite created (by approving a provider) must go FIRST — deleting
 * the users first raises 23503 and, because `after()` then never reaches
 * `server.close()`, the whole test process hangs instead of exiting.
 */
after(async () => {
  const pattern = `img-%-${runId}@example.com`;
  const mine = await pool.query<{ id: string }>('SELECT id FROM users WHERE email LIKE $1', [
    pattern,
  ]);
  const ids = mine.rows.map((row) => row.id);

  if (ids.length > 0) {
    await pool.query('DELETE FROM admin_action_log WHERE admin_id = ANY($1::uuid[])', [ids]);
    // Everything else cascades from users (profiles, images, sessions, …).
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }

  server.close();
  await once(server, 'close');
});

/* -------------------------------------------------------------- listing -- */

test('GET: a provider lists only their own images', async () => {
  const res = await call('GET', API, undefined, tokenA);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.images));

  for (const image of res.data.images) {
    const row = await pool.query('SELECT provider_id FROM provider_images WHERE id = $1', [
      image.id,
    ]);
    assert.equal(row.rows[0]?.provider_id, providerAId, 'never another provider row');
  }
});

test('GET: provider A never receives provider B private image data', async () => {
  await upload(tokenB, [JPG()]);
  const mine = await call('GET', API, undefined, tokenA);
  const theirs = await call('GET', API, undefined, tokenB);

  const mineIds = new Set(mine.data.images.map((i: any) => i.id));
  for (const id of theirs.data.images.map((i: any) => i.id)) {
    assert.ok(!mineIds.has(id), 'provider A must not receive provider B rows');
  }
});

/* --------------------------------------------------------------- upload -- */

test('POST: a provider uploads JPG, PNG and WebP together', async () => {
  const res = await upload(tokenA, [JPG(), PNG(), WEBP()]);
  assert.equal(res.status, 201);
  assert.equal(res.data.images.length, 3);

  const extensions = res.data.images.map((i: any) =>
    basename(new URL(i.url).pathname).split('.').pop(),
  );
  assert.deepEqual([...extensions].sort(), ['jpg', 'png', 'webp']);

  for (const image of res.data.images) {
    const row = await pool.query('SELECT provider_id FROM provider_images WHERE id = $1', [
      image.id,
    ]);
    assert.equal(row.rows[0].provider_id, providerAId);
  }
});

test('POST: the stored url is absolute and satisfies the url CHECK', async () => {
  const res = await upload(tokenA, [PNG()]);
  assert.equal(res.status, 201);
  const { url } = res.data.images[0];
  assert.match(url, /^https?:\/\//, 'provider_images.url requires an absolute http(s) URL');
  assert.match(url, /\/uploads\/providers\//);
});

test('POST: the filename is generated, never the uploaded name', async () => {
  const res = await upload(tokenA, [
    { name: '../../etc/passwd.jpg', type: 'image/jpeg', bytes: imageBytes('X', 16) },
  ]);
  assert.equal(res.status, 201);
  const stored = basename(new URL(res.data.images[0].url).pathname);
  assert.ok(!stored.includes('/'), 'no path separator may survive');
  assert.ok(!stored.includes('..'), 'no traversal may survive');
  assert.match(stored, /^[0-9a-f-]{36}\.(jpg|png|webp)$/i, 'a UUID plus our own extension');
});

test('POST: a disallowed MIME type is rejected', async () => {
  for (const type of ['application/pdf', 'text/plain', 'image/gif', 'image/svg+xml']) {
    const res = await upload(tokenA, [{ name: 'x.bin', type, bytes: imageBytes('Z', 32) }]);
    assert.equal(res.status, 400, `${type} must be rejected`);
    assert.match(res.data.error.message, /JPG, PNG or WebP/i);
  }
});

test('POST: an oversized file is rejected and stores nothing', async () => {
  const before = await call('GET', API, undefined, tokenA);
  const res = await upload(tokenA, [PNG(MAX_IMAGE_BYTES + 1024)]);
  assert.equal(res.status, 413, 'an over-limit file must be a 413');
  assert.match(res.data.error.message, /MB or smaller/);

  const after = await call('GET', API, undefined, tokenA);
  assert.equal(
    after.data.images.length,
    before.data.images.length,
    'a rejected upload must not create a row',
  );
});

test('POST: more than the allowed number of files is rejected', async () => {
  const files = Array.from({ length: MAX_IMAGE_FILES + 1 }, () => PNG());
  const res = await upload(tokenA, files);
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, new RegExp(`at most ${MAX_IMAGE_FILES}`));
});

test('POST: exactly the maximum number of files is accepted', async () => {
  const files = Array.from({ length: MAX_IMAGE_FILES }, () => PNG());
  const res = await upload(tokenA, files);
  assert.equal(res.status, 201);
  assert.equal(res.data.images.length, MAX_IMAGE_FILES);
});

test('POST: an empty upload is a 400, not a silent success', async () => {
  const res = await upload(tokenA, []);
  assert.equal(res.status, 400);
});

test('POST: alt text is stored when supplied', async () => {
  const res = await upload(tokenA, [JPG()], { altText: 'Our shopfront in Panaji' });
  assert.equal(res.status, 201);
  assert.equal(res.data.images[0].altText, 'Our shopfront in Panaji');
});
/* ------------------------------------------------- the primary invariant -- */

test('PRIMARY: one primary at most, never two from one request', async () => {
  const email = `img-primary-${runId}@example.com`;
  const created = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: 'Primary Owner',
    role: 'PROVIDER',
    provider: { businessName: `Primary Co ${runId}`, city: 'Panaji' },
  });
  const providerId = created.data.user.id as string;
  const login = await call('POST', '/api/auth/login', { email, password: 'StrongPass123!' });
  const token = login.data.token as string;

  // A single multi-file request must not create several primaries.
  const uploaded = await upload(token, [JPG(), PNG(), WEBP()], { isPrimary: 'true' });
  assert.equal(uploaded.status, 201);
  assert.equal(
    uploaded.data.images.filter((i: any) => i.isPrimary).length,
    1,
    'exactly one image may be primary',
  );
  assert.equal(uploaded.data.images[0].isPrimary, true, 'the first file is the primary');

  // A second request asking for primary is ignored, not honoured.
  const again = await upload(token, [JPG()], { isPrimary: 'true' });
  assert.equal(again.status, 201);
  assert.equal(again.data.images[0].isPrimary, false, 'a later upload must not steal primary');

  const counted = await pool.query(
    'SELECT count(*)::int AS n FROM provider_images WHERE provider_id = $1 AND is_primary',
    [providerId],
  );
  assert.equal(counted.rows[0].n, 1, 'the database holds at most one primary');
});

/* ---------------------------------------------------------------- delete -- */

test('DELETE: a provider removes their own image, row AND file', async () => {
  const uploaded = await upload(tokenA, [JPG()]);
  assert.equal(uploaded.status, 201);
  const image = uploaded.data.images[0];

  const onDisk = `${PROVIDER_UPLOADS_DIR}/${basename(new URL(image.url).pathname)}`;
  assert.ok(existsSync(onDisk), 'the uploaded file must exist before deletion');

  const res = await call('DELETE', `${API}/${image.id}`, undefined, tokenA);
  assert.equal(res.status, 204);

  const row = await pool.query('SELECT 1 FROM provider_images WHERE id = $1', [image.id]);
  assert.equal(row.rowCount, 0, 'the database row must be gone');
  assert.ok(!existsSync(onDisk), 'the file must be removed from disk too');
});

test('DELETE: a provider cannot delete an image owned by somebody else', async () => {
  const theirs = await upload(tokenB, [PNG()]);
  assert.equal(theirs.status, 201);
  const target = theirs.data.images[0];

  const res = await call('DELETE', `${API}/${target.id}`, undefined, tokenA);
  assert.equal(res.status, 404, 'a row owned by somebody else is a 404, not a 403');

  const row = await pool.query('SELECT provider_id FROM provider_images WHERE id = $1', [
    target.id,
  ]);
  assert.equal(row.rows[0].provider_id, providerBId, 'the row must be untouched');
  assert.ok(
    existsSync(`${PROVIDER_UPLOADS_DIR}/${basename(new URL(target.url).pathname)}`),
    'the file must be untouched',
  );
});

test('DELETE: an unknown id is the same 404 as somebody else id', async () => {
  const res = await call(
    'DELETE',
    `${API}/00000000-0000-4000-8000-999999999999`,
    undefined,
    tokenA,
  );
  assert.equal(res.status, 404);
});

test('DELETE: a non-UUID id is a 400', async () => {
  const res = await call('DELETE', `${API}/not-a-uuid`, undefined, tokenA);
  assert.equal(res.status, 400);
});

/* ------------------------------------------------------- role enforcement -- */

test('AUTH: a customer cannot GET, POST or DELETE provider images', async () => {
  assert.equal((await call('GET', API, undefined, tokenCustomer)).status, 403);
  assert.equal((await upload(tokenCustomer, [JPG()])).status, 403);

  const theirs = await upload(tokenA, [JPG()]);
  const del = await call(
    'DELETE',
    `${API}/${theirs.data.images[0].id}`,
    undefined,
    tokenCustomer,
  );
  assert.equal(del.status, 403);
/* -------------------------------------------------------- static serving -- */

test('STATIC: an uploaded file is served at its stored url', async () => {
  const uploaded = await upload(tokenA, [PNG(512)]);
  assert.equal(uploaded.status, 201);

  // The stored URL is built from env.PORT but the test server listens on an
  // ephemeral port, so fetch the PATH against the live server.
  const res = await fetch(`${base}${new URL(uploaded.data.images[0].url).pathname}`);
  assert.equal(res.status, 200, 'the file must be reachable through express.static');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.byteLength, 512, 'the served bytes must match what was uploaded');
});

test('STATIC: directory traversal is not served', async () => {
  for (const attempt of [
    '/uploads/providers/../app.js',
    '/uploads/providers/..%2f..%2f.env',
    '/uploads/providers/../../package.json',
  ]) {
    const res = await fetch(`${base}${attempt}`);
    assert.ok(res.status >= 400, `${attempt} must not be served (got ${res.status})`);
    const text = await res.text();
    assert.ok(!text.includes('DATABASE_URL'), 'no config file may be readable');
    assert.ok(!text.includes('JWT_SECRET'), 'no secret may be readable');
  }
});

/* ------------------------------------------------------- public behaviour -- */

test('PUBLIC: an approved provider gallery shows uploaded images', async () => {
  const queue = await call('GET', '/api/admin/providers/pending', undefined, tokenAdmin);
  assert.equal(queue.status, 200);
  assert.ok(
    queue.data.providers.some((p: any) => p.userId === providerAId),
    'provider A must be in the verification queue',
  );

  const approve = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/approve`,
    {},
    tokenAdmin,
  );
  assert.equal(approve.status, 200);

  const uploaded = await upload(tokenA, [JPG(), WEBP()]);
  assert.equal(uploaded.status, 201);

  const profile = await call('GET', `/api/providers/${providerAId}`);
  assert.equal(profile.status, 200, 'an approved provider is publicly readable');

  // The public route wraps its result: `{ provider: {...} }`.
  const images = profile.data.provider.images;
  const urls = images.map((i: any) => i.url);
  for (const image of uploaded.data.images) {
    assert.ok(urls.includes(image.url), 'the uploaded image must appear on the public profile');
  }

  // The public DTO stays minimal — no row id, no primary flag.
  for (const image of images) {
    assert.deepEqual(
      Object.keys(image).sort(),
      ['altText', 'url'],
      'the public image DTO must not leak management fields',
    );
  }
});

test('PUBLIC: uploading never bypasses verification', async () => {
  const email = `img-hidden-${runId}@example.com`;
  const created = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: 'Hidden Owner',
    role: 'PROVIDER',
    provider: { businessName: `Hidden Co ${runId}`, city: 'Mapusa' },
  });
  const id = created.data.user.id as string;
  const login = await call('POST', '/api/auth/login', { email, password: 'StrongPass123!' });

  // A PENDING provider may upload freely — that must NOT make them public.
  const uploaded = await upload(login.data.token as string, [PNG()]);
  assert.equal(uploaded.status, 201, 'a pending provider may prepare their gallery');

  assert.equal(
    (await call('GET', `/api/providers/${id}`)).status,
    404,
    'uploading must never bypass verification',
  );

  const search = await call('GET', '/api/providers?pageSize=50');
  assert.ok(
    !search.data.providers.some((p: any) => p.id === id),
    'a pending provider must stay out of public search',
  );
});

/* ------------------------------------------------------------- integrity -- */

test('STORAGE: the directory holds only filenames this server generates', async () => {
  const entries = await fsp.readdir(PROVIDER_UPLOADS_DIR);
  assert.ok(entries.length > 0, 'uploads must actually reach the disk');
  for (const entry of entries) {
    assert.match(
      entry,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i,
      `${entry} is not a filename this server would generate`,
    );
  }
});

test('ERRORS: a failure never leaks a filesystem path or internals', async () => {
  const attempts = [
    await upload(tokenA, [{ name: 'x.pdf', type: 'application/pdf', bytes: imageBytes('Z') }]),
    await upload(tokenA, [PNG(MAX_IMAGE_BYTES + 1024)]),
    await call('DELETE', `${API}/not-a-uuid`, undefined, tokenA),
  ];
  for (const res of attempts) {
    const body = JSON.stringify(res.data);
    assert.ok(!body.includes('uploads/providers'), `leaked a path: ${body}`);
    assert.ok(!body.includes('\\'), `leaked a windows path: ${body}`);
    assert.ok(!/Error:|at Object|MulterError/.test(body), `leaked internals: ${body}`);
  }
});

});

test('AUTH: an admin cannot use the provider image endpoints', async () => {
  assert.equal((await call('GET', API, undefined, tokenAdmin)).status, 403);
  assert.equal((await upload(tokenAdmin, [JPG()])).status, 403);
});

test('AUTH: an anonymous request is rejected', async () => {
  assert.equal((await call('GET', API)).status, 401);
  assert.equal((await upload(undefined, [JPG()])).status, 401);
});


test('POST: a provider cannot smuggle providerId through the multipart body', async () => {
  const res = await upload(tokenA, [JPG()], { providerId: providerBId });
  assert.equal(res.status, 400, 'an unknown field must be rejected, not ignored');

  const listed = await call('GET', API, undefined, tokenA);
  for (const image of listed.data.images) {
    const row = await pool.query('SELECT provider_id FROM provider_images WHERE id = $1', [
      image.id,
    ]);
    assert.equal(row.rows[0].provider_id, providerAId);
  }
});
