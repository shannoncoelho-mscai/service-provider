/**
 * SERVICE image management (Phase 21) + admin review visibility.
 *
 * Run: npm test --workspace server   (requires DB + migrations)
 *
 * Deliberately separate from `images.test.ts` even though the upload policy is
 * literally the same object on the server: these are different tables, different
 * routes and a different ownership question ("is this MY service?" rather than
 * "is this MY provider?"). Sharing one file would obscure both.
 *
 * The cross-provider cases are the heart of this file. A provider who knows
 * another provider's service id must get the SAME 404 as a service that does not
 * exist — otherwise the endpoint enumerates other tenants' catalogues.
 */

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

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  providerA: `simg-a-${runId}@example.com`,
  providerB: `simg-b-${runId}@example.com`,
  customer: `simg-cust-${runId}@example.com`,
  admin: `simg-admin-${runId}@example.com`,
};

let tokenA = '';
let tokenB = '';
let tokenCustomer = '';
let tokenAdmin = '';
let providerAId = '';
let providerBId = '';
let serviceA = '';
let serviceB = '';

/** The server checks the DECLARED MIME type, not magic bytes. */
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
    /* 204 and friends */
  }
  return { status: res.status, data };
}

/** POST a real multipart body to an arbitrary service-image URL. */
async function upload(
  token: string | undefined,
  path: string,
  files: Array<{ name: string; type: string; bytes: Uint8Array }>,
  fields: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    form.append('images', new Blob([file.bytes], { type: file.type }), file.name);
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, data };
}

const JPG = (n = 64) => ({ name: 'photo.jpg', type: 'image/jpeg', bytes: imageBytes('J', n) });
const PNG = (n = 64) => ({ name: 'photo.png', type: 'image/png', bytes: imageBytes('P', n) });
const WEBP = (n = 64) => ({ name: 'photo.webp', type: 'image/webp', bytes: imageBytes('W', n) });

const urlA = () => `/api/providers/me/services/${serviceA}/images`;
const urlB = () => `/api/providers/me/services/${serviceB}/images`;

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

async function makeService(token: string, name: string): Promise<string> {
  const res = await call(
    'POST',
    '/api/providers/me/services',
    { categoryName: 'AC Repair', name, priceFrom: 800, priceTo: 1500, durationMinutes: 60 },
    token,
  );
  assert.equal(res.status, 201, `create service ${name} failed: ${JSON.stringify(res.data)}`);
  return res.data.service.id as string;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const a = await registerProvider(emails.providerA, 'AC Owner', 'ABC AC Services');
  tokenA = a.token;
  providerAId = a.id;
  serviceA = await makeService(tokenA, 'AC Repair');

  const b = await registerProvider(emails.providerB, 'Other Owner', 'Second AC Co');
  tokenB = b.token;
  providerBId = b.id;
  serviceB = await makeService(tokenB, 'Other Service');

  const cust = await call('POST', '/api/auth/register', {
    email: emails.customer,
    password: 'StrongPass123!',
    fullName: 'Casey Customer',
    role: 'CUSTOMER',
  });
  tokenCustomer = cust.data.token as string;

  const adminReg = await call('POST', '/api/auth/register', {
    email: emails.admin,
    password: 'StrongPass123!',
    fullName: 'Admin User',
    role: 'CUSTOMER',
  });
  await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1", [adminReg.data.user.id]);
  const login = await call('POST', '/api/auth/login', {
    email: emails.admin,
    password: 'StrongPass123!',
  });
  tokenAdmin = login.data.token as string;

  assert.ok(existsSync(PROVIDER_UPLOADS_DIR));
});

/**
 * Clean up everything this file created.
 *
 * `admin_action_log.admin_id` is ON DELETE RESTRICT, so the audit rows created
 * by the approve calls below must go BEFORE the users — deleting the users first
 * raises 23503 and, because `after()` would then never reach `server.close()`,
 * the test process hangs instead of exiting.
 */
after(async () => {
  const pattern = `simg-%-${runId}@example.com`;
  const mine = await pool.query<{ id: string }>('SELECT id FROM users WHERE email LIKE $1', [
    pattern,
  ]);
  const ids = mine.rows.map((r) => r.id);
  if (ids.length > 0) {
    await pool.query('DELETE FROM admin_action_log WHERE admin_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }
  server.close();
  await once(server, 'close');
});

/* ------------------------------------------------------------ happy path -- */

test('a provider can upload service images for their own service', async () => {
  const res = await upload(tokenA, urlA(), [JPG(), PNG()], { altText: 'AC unit installed' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.images.length, 2);
  for (const image of res.data.images) {
    assert.match(image.url, /^https?:\/\//, 'a row must store a full URL');
    assert.equal(image.serviceId, serviceA, 'the row belongs to the service in the path');
    assert.equal(image.altText, 'AC unit installed');
  }
});

test('GET: a provider lists their own service images', async () => {
  const res = await call('GET', urlA(), undefined, tokenA);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.images));
  assert.equal(res.data.images.length, 2);
});

test('sort_order is sequential across uploads', async () => {
  const res = await upload(tokenA, urlA(), [WEBP()]);
  assert.equal(res.status, 201);
  assert.deepEqual(
    res.data.images.map((i: any) => i.sortOrder),
    [2],
    'the third image should take sort_order 2',
  );
  await call('DELETE', `${urlA()}/${res.data.images[0].id}`, undefined, tokenA);
});

/* ---------------------------------------------------------------- delete -- */

test('DELETE removes the database row AND the file from disk', async () => {
  const up = await upload(tokenA, urlA(), [PNG()]);
  assert.equal(up.status, 201);
  const image = up.data.images[0];
  const filename = basename(new URL(image.url).pathname);
  const onDisk = `${PROVIDER_UPLOADS_DIR}/${filename}`;
  assert.ok(existsSync(onDisk), 'the file must exist after upload');

  const del = await call('DELETE', `${urlA()}/${image.id}`, undefined, tokenA);
  assert.equal(del.status, 204);

  const row = await pool.query('SELECT 1 FROM service_images WHERE id = $1', [image.id]);
  assert.equal(row.rowCount, 0, 'the row must be gone');
  assert.equal(existsSync(onDisk), false, 'the file must be gone from disk');
});
/* ------------------------------------------------------------- ownership -- */

test("a provider CANNOT list another provider's service images", async () => {
  await upload(tokenA, urlA(), [JPG()]);
  const res = await call('GET', urlA(), undefined, tokenB);
  assert.equal(res.status, 404, "provider B must not read provider A's service");
});

test("a provider CANNOT upload to another provider's service", async () => {
  const res = await upload(tokenB, urlA(), [JPG()]);
  assert.equal(res.status, 404, "provider B must not write into provider A's service");
  const rows = await pool.query(
    'SELECT count(*)::int n FROM service_images WHERE service_id = $1',
    [serviceB],
  );
  assert.equal(rows.rows[0].n, 0, 'nothing may land on the wrong service');
});

test("a provider CANNOT delete another provider's service image", async () => {
  const up = await upload(tokenA, urlA(), [PNG()]);
  const image = up.data.images[0];
  const filename = basename(new URL(image.url).pathname);

  const res = await call('DELETE', `${urlA()}/${image.id}`, undefined, tokenB);
  assert.equal(res.status, 404);

  // The row and file must both survive an unauthorised delete.
  const row = await pool.query('SELECT 1 FROM service_images WHERE id = $1', [image.id]);
  assert.equal(row.rowCount, 1, 'the image must still exist');
  assert.ok(existsSync(`${PROVIDER_UPLOADS_DIR}/${filename}`), 'the file must still exist');
});

test("someone else's service and a non-existent service are indistinguishable", async () => {
  const mine = await call('GET', urlA(), undefined, tokenB);
  const ghost = await call(
    'GET',
    '/api/providers/me/services/11111111-1111-4111-8111-111111111111/images',
    undefined,
    tokenB,
  );
  assert.equal(mine.status, ghost.status);
  assert.equal(mine.data.error?.message, ghost.data.error?.message, 'no enumeration oracle');
});

test('a client-supplied serviceId in the body cannot redirect the upload', async () => {
  const res = await upload(tokenB, urlB(), [JPG()], { serviceId: serviceA });
  assert.equal(res.status, 400, 'serviceId is not an accepted multipart field');
});

/* ------------------------------------------------------------ validation -- */

test('an unsupported image type is rejected', async () => {
  const res = await upload(tokenA, urlA(), [
    { name: 'notes.pdf', type: 'application/pdf', bytes: imageBytes('X', 32) },
  ]);
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /JPG, PNG or WebP/);
});

test('an oversized image is rejected', async () => {
  // 413, not 400: the shared error handler maps Multer's LIMIT_FILE_SIZE to
  // "Payload Too Large", matching images.test.ts for the business gallery.
  const res = await upload(tokenA, urlA(), [JPG(MAX_IMAGE_BYTES + 1024)]);
  assert.equal(res.status, 413);
  assert.match(res.data.error.message, /MB or smaller/);
});

test('more than the maximum number of files is rejected', async () => {
  const many = Array.from({ length: MAX_IMAGE_FILES + 1 }, () => PNG());
  const res = await upload(tokenA, urlA(), many);
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, new RegExp(`${MAX_IMAGE_FILES}`));
});

test('an empty upload is a 400, not a silent no-op', async () => {
  const res = await upload(tokenA, urlA(), []);
  assert.equal(res.status, 400);
});

/* -------------------------------------------------------- authentication -- */

test('service image routes require authentication', async () => {
  assert.equal((await call('GET', urlA())).status, 401);
  assert.equal((await upload(undefined, urlA(), [JPG()])).status, 401);
  assert.equal(
    (await call('DELETE', `${urlA()}/11111111-1111-4111-8111-111111111111`)).status,
    401,
  );
});

test("a CUSTOMER cannot reach a provider's service images", async () => {
  assert.equal((await call('GET', urlA(), undefined, tokenCustomer)).status, 403);
  assert.equal((await upload(tokenCustomer, urlA(), [JPG()])).status, 403);
});
/* ----------------------------------------------------- public visibility -- */

test("an APPROVED provider's service images are public; a PENDING one is not", async () => {
  // A PENDING provider may prepare a gallery but must stay invisible (ADR-022).
  assert.equal((await call('GET', `/api/providers/${providerAId}`)).status, 404);

  const approve = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/approve`,
    {},
    tokenAdmin,
  );
  assert.equal(approve.status, 200, JSON.stringify(approve.data));

  const res = await call('GET', `/api/providers/${providerAId}`);
  assert.equal(res.status, 200);
  const service = res.data.provider.services.find((s: any) => s.id === serviceA);
  assert.ok(service, "the approved provider's service must be public");
  assert.ok(Array.isArray(service.images), 'services always carry an images array');
  assert.ok(service.images.length > 0, 'the uploaded photos must reach the public payload');
  for (const image of service.images) {
    assert.deepEqual(
      Object.keys(image).sort(),
      ['altText', 'url'],
      'the public image DTO stays url/alt only',
    );
  }
});

test('the public image URL is actually fetchable by a browser', async () => {
  const res = await call('GET', `/api/providers/${providerAId}`);
  const service = res.data.provider.services.find((s: any) => s.id === serviceA);
  const image = service.images[0];

  const file = await fetch(image.url);
  assert.equal(file.status, 200, 'the stored file must be served');
  assert.match(file.headers.get('content-type') ?? '', /^image\//);
  // Without this header the SPA on :5173 silently refuses to paint every <img>,
  // which is exactly the bug Phase 21 was opened to fix.
  assert.equal(
    file.headers.get('cross-origin-resource-policy'),
    'cross-origin',
    'uploads must be loadable from the dev frontend origin',
  );
});

test('deactivating a service hides its photos from the public profile', async () => {
  await call('DELETE', `/api/providers/me/services/${serviceA}`, undefined, tokenA);
  const res = await call('GET', `/api/providers/${providerAId}`);
  assert.equal(res.status, 200);
  const ids = res.data.provider.services.map((s: any) => s.id);
  assert.ok(!ids.includes(serviceA), 'a deactivated service is not published');
});

/* --------------------------------------------------------- admin review -- */

test('ADMIN sees the business photos on the review screen; others cannot', async () => {
  // Give the reviewer something real to see.
  await upload(tokenA, '/api/providers/me/images', [JPG()]);

  const res = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenAdmin);
  assert.equal(res.status, 200);
  // The admin detail DTO is nested under `provider`, unlike the service-image
  // routes which return a bare { images } array.
  assert.ok(Array.isArray(res.data.provider.images), 'the review payload carries an images array');
  assert.ok(
    res.data.provider.images.length > 0,
    "the reviewer sees the provider's gallery",
  );

  const denied = await call(
    'GET',
    `/api/admin/providers/${providerAId}`,
    undefined,
    tokenCustomer,
  );
  assert.equal(denied.status, 403, 'a customer must not read the review endpoint');

  const asProvider = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenA);
  assert.equal(asProvider.status, 403, 'a provider must not read the review endpoint');
});

test('the admin review payload exposes images but no internals', async () => {
  const biz = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenAdmin);
  const text = JSON.stringify(biz.data.provider.images);
  for (const leak of ['password', 'passwordHash', 'token', 'userId']) {
    assert.ok(!text.includes(leak), `admin images leaked ${leak}`);
  }
  for (const image of biz.data.provider.images) {
    assert.deepEqual(
      Object.keys(image).sort(),
      ['altText', 'id', 'isPrimary', 'sortOrder', 'url'],
      'the review image shape is fixed and read-only',
    );
  }
});

test('each review screen shows only that provider own images', async () => {
  await upload(tokenB, urlB(), [PNG()]);
  const bServiceImgs = await pool.query('SELECT url FROM service_images WHERE service_id = $1', [
    serviceB,
  ]);
  assert.ok(bServiceImgs.rows.length > 0, 'the fixture must have produced a row');

  // B's own review screen must contain B's own service, and nothing of A's.
  const bView = await call('GET', `/api/admin/providers/${providerBId}`, undefined, tokenAdmin);
  assert.equal(bView.status, 200);
  assert.ok(
    bView.data.provider.services.some((s: any) => s.id === serviceB),
    "B's own service must be on B's review screen",
  );

  const aView = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenAdmin);
  for (const row of bServiceImgs.rows) {
    assert.ok(
      !JSON.stringify(aView.data).includes(row.url),
      "provider B's image must never appear on provider A's review screen",
    );
  }
});

/* -------------------------------------------- orphaned files on failure ---- */

test('a rejected upload leaves no file behind on disk', async () => {
  const before = (await fsp.readdir(PROVIDER_UPLOADS_DIR)).length;

  // Provider B points the URL at provider A's service: ownership fails INSIDE
  // the transaction, after Multer has already written the file to disk. Without
  // explicit cleanup the bytes would be orphaned forever.
  const res = await upload(tokenB, urlA(), [PNG()]);
  assert.equal(res.status, 404);

  const after = (await fsp.readdir(PROVIDER_UPLOADS_DIR)).length;
  assert.equal(after, before, 'the orphaned upload must be cleaned up, not leaked to disk');
});