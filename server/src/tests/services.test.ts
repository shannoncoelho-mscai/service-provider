import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';
import { categorySlug } from '../modules/providers/services.service';

/**
 * Provider service-management tests (ADR-020).
 *
 * Run:  npm test --workspace server   (requires DB + migrations)
 *
 * The IDOR rules under test — a provider must never be able to reach another
 * provider's service row:
 *   1. listing returns only the caller's own services
 *   2. PATCH   with someone else's :id  → 404, target row unchanged
 *   3. DELETE  with someone else's :id  → 404, target row still active
 *   4. POST    cannot reassign ownership via a body field (strict → 400)
 *   5. PATCH   cannot reassign ownership via a body field (strict → 400)
 *   6. non-UUID / unknown ids behave identically (no enumeration oracle)
 *   7. customers/admins/anonymous are rejected before any ownership logic
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  providerA: `svc-a-${runId}@example.com`,
  providerB: `svc-b-${runId}@example.com`,
  customer: `svc-cust-${runId}@example.com`,
  admin: `svc-admin-${runId}@example.com`,
};

let tokenA = '';
let tokenB = '';
let tokenCustomer = '';
let tokenAdmin = '';
let providerAId = '';
let providerBId = '';
let categoryId = '';
let serviceA = ''; // owned by provider A — the target of every IDOR attempt

const API = '/api/providers/me/services';

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

async function dbRow(id: string): Promise<{ name: string; is_active: boolean; provider_id: string }> {
  const res = await pool.query<{ name: string; is_active: boolean; provider_id: string }>(
    'SELECT name, is_active, provider_id FROM services WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? { name: 'MISSING', is_active: false, provider_id: '' };
}

async function registerProvider(email: string, name: string, business: string) {
  const res = await call('POST', '/api/auth/register', {
    email,
    password: 'StrongPass123!',
    fullName: name,
    role: 'PROVIDER',
    provider: { businessName: business, city: 'Panaji' },
  });
  assert.equal(res.status, 201, `register ${email} failed`);
  return { token: res.data.token as string, id: res.data.user.id as string };
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const cat = await pool.query<{ id: string }>(
    'SELECT id FROM service_categories WHERE is_active ORDER BY sort_order LIMIT 1',
  );
  assert.ok(cat.rows[0], 'seeded categories are required for these tests');
  categoryId = cat.rows[0].id;

  const a = await registerProvider(emails.providerA, 'Sam Owner', 'Owner Plumbing Co.');
  tokenA = a.token;
  providerAId = a.id;
  const b = await registerProvider(emails.providerB, 'Bea Owner', 'Other Electrical Co.');
  tokenB = b.token;
  providerBId = b.id;

  const c = await call('POST', '/api/auth/register', {
    email: emails.customer,
    password: 'StrongPass123!',
    fullName: 'Casey Customer',
    role: 'CUSTOMER',
  });
  assert.equal(c.status, 201);
  tokenCustomer = c.data.token;

  // A test-scoped ADMIN (public registration cannot mint admins).
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Services Admin', 'ADMIN')`,
    [emails.admin, await hashPassword('AdminPass123!')],
  );
  const login = await call('POST', '/api/auth/login', {
    email: emails.admin,
    password: 'AdminPass123!',
  });
  assert.equal(login.status, 200);
  tokenAdmin = login.data.token;
});

after(async () => {
  try {
    // Delete every address this file created, not just the fixed ones in
    // `emails`.
    //
    // The APPROVAL test below registers `svc-pending-${runId}@example.com` on
    // the fly. That address is not in `emails`, so the old loop left the user,
    // their provider_profiles row and their "Window fix" service behind in the
    // database. Because the suite runs services.test.ts BEFORE search.test.ts,
    // search.test.ts then picked that orphaned PENDING provider's service as its
    // keyword fixture — and a PENDING provider is correctly absent from
    // public_providers, so the search assertion failed for a reason that had
    // nothing to do with search. Deleting by the run id catches every fixture
    // this file makes, present or future.
    const addresses = [...Object.values(emails), `svc-pending-${runId}@example.com`];
    for (const address of addresses) {
      // services cascade from provider_profiles; admin_action_log restricts
      // admin deletion, so clear this test admin's (empty) audit trail first.
      await pool.query('DELETE FROM admin_action_log WHERE admin_id IN (SELECT id FROM users WHERE email = $1)', [
        address,
      ]);
      await pool.query('DELETE FROM users WHERE email = $1', [address]);
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await pool.end();
  }
});

// --- CRUD + validation ---------------------------------------------------

test('provider creates, edits, lists and deactivates their own services', async () => {
  const created = await call(
    'POST',
    API,
    {
      categoryId,
      name: 'Emergency pipe repair',
      description: 'Burst pipe repair, 24/7 callout.',
      priceFrom: 120,
      priceTo: 400,
      durationMinutes: 90,
    },
    tokenA,
  );
  assert.equal(created.status, 201);
  serviceA = created.data.service.id;
  assert.equal(created.data.service.name, 'Emergency pipe repair');
  assert.equal(created.data.service.priceFrom, '120.00');
  assert.equal(created.data.service.priceTo, '400.00');
  assert.equal(created.data.service.durationMinutes, 90);
  assert.equal(created.data.service.isActive, true);
  assert.ok(created.data.service.categoryName, 'category name is resolved for the UI');

  const list = await call('GET', API, undefined, tokenA);
  assert.equal(list.status, 200);
  assert.equal(list.data.services.length, 1);
  assert.equal(list.data.services[0].id, serviceA);

  const edited = await call(
    'PATCH',
    `${API}/${serviceA}`,
    { priceFrom: 150, priceTo: 500, name: 'Emergency pipe repair (24/7)' },
    tokenA,
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.data.service.priceFrom, '150.00');
  assert.equal(edited.data.service.name, 'Emergency pipe repair (24/7)');

  const removed = await call('DELETE', `${API}/${serviceA}`, undefined, tokenA);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.service.isActive, false, 'DELETE deactivates, never hard-deletes');

  // Soft-deleted row is still there and still owned by A.
  const row = await dbRow(serviceA);
  assert.equal(row.provider_id, providerAId);
  assert.equal(row.is_active, false);
});

test('validation: name, price range, duration and category are enforced', async () => {
  const cases: Array<[string, unknown, number]> = [
    ['name too short', { categoryId, name: 'ab', priceFrom: 10 }, 400],
    ['negative price', { categoryId, name: 'Negative', priceFrom: -5 }, 400],
    ['price above ceiling', { categoryId, name: 'Too dear', priceFrom: 2_000_000 }, 400],
    ['priceTo below priceFrom', { categoryId, name: 'Inverted', priceFrom: 100, priceTo: 50 }, 400],
    ['too many decimals', { categoryId, name: 'Precise', priceFrom: 10.555 }, 400],
    ['duration under 15', { categoryId, name: 'Quick', priceFrom: 10, durationMinutes: 5 }, 400],
    ['duration not an integer', { categoryId, name: 'Fuzzy', priceFrom: 10, durationMinutes: 45.5 }, 400],
    ['duration over 24h', { categoryId, name: 'Marathon', priceFrom: 10, durationMinutes: 2000 }, 400],
    ['description over 2000 chars', { categoryId, name: 'Wordy', priceFrom: 10, description: 'x'.repeat(2001) }, 400],
    ['missing category', { name: 'Orphan', priceFrom: 10 }, 400],
    ['non-UUID category', { categoryId: 'not-a-uuid', name: 'Bad ref', priceFrom: 10 }, 400],
    ['unknown category', { categoryId: '00000000-0000-4000-8000-000000000000', name: 'Ghost', priceFrom: 10 }, 400],
    ['priceFrom missing', { categoryId, name: 'Priceless' }, 400],
  ];

  for (const [label, body, expected] of cases) {
    const res = await call('POST', API, body, tokenA);
    assert.equal(res.status, expected, `${label} → expected ${expected}, got ${res.status}`);
  }

  // PATCH with an empty body is rejected rather than silently doing nothing.
  assert.equal((await call('PATCH', `${API}/${serviceA}`, {}, tokenA)).status, 400);
  // …and a partial update cannot invert the stored range.
  const invert = await call('PATCH', `${API}/${serviceA}`, { priceTo: 1 }, tokenA);
  assert.equal(invert.status, 400);
  assert.equal((await dbRow(serviceA)).name.includes('x'), false);
  const stillThere = await pool.query<{ price_to: string }>(
    'SELECT price_to FROM services WHERE id = $1',
    [serviceA],
  );
  assert.equal(stillThere.rows[0].price_to, '500.00', 'rejected PATCH must not mutate the row');

  // Duplicate name for the same provider → 409 (UNIQUE provider_id + name).
  const dup = await call('POST', API, { categoryId, name: 'Duplicate me', priceFrom: 20 }, tokenA);
  assert.equal(dup.status, 201);
  const again = await call('POST', API, { categoryId, name: 'Duplicate me', priceFrom: 25 }, tokenA);
  assert.equal(again.status, 409);
  // But another provider may reuse the same name (uniqueness is per provider).
  const other = await call('POST', API, { categoryId, name: 'Duplicate me', priceFrom: 25 }, tokenB);
  assert.equal(other.status, 201);
  await call('DELETE', `${API}/${other.data.service.id}`, undefined, tokenB);
  await call('DELETE', `${API}/${dup.data.service.id}`, undefined, tokenA);
});

// --- IDOR: the security rules this task is really about -------------------

test('IDOR 1: listing returns only services owned by the caller', async () => {
  await call('POST', API, { categoryId, name: 'B-only service', priceFrom: 30 }, tokenB);

  const aList = await call('GET', API, undefined, tokenA);
  const bList = await call('GET', API, undefined, tokenB);
  const aIds = aList.data.services.map((s: any) => s.id);
  const bIds = bList.data.services.map((s: any) => s.id);

  assert.ok(aIds.includes(serviceA), 'A sees its own service');
  assert.ok(!aIds.includes(providerBId), 'A never sees B\'s id as a service');
  assert.ok(bIds.length > 0 && !bIds.includes(serviceA), 'B does not see A\'s service');

  // Database truth: every row in A's listing is genuinely owned by A.
  const owners = await pool.query<{ id: string; provider_id: string }>(
    'SELECT id, provider_id FROM services WHERE id = ANY($1::uuid[])',
    [aIds],
  );
  assert.ok(owners.rows.length > 0);
  for (const row of owners.rows) {
    assert.equal(row.provider_id, providerAId, `service ${row.id} leaked to A`);
  }
});

test('IDOR 2: PATCH with another provider\'s service id → 404 and no mutation', async () => {
  const before = await dbRow(serviceA);

  const attack = await call('PATCH', `${API}/${serviceA}`, { name: 'Hijacked by B' }, tokenB);
  assert.equal(attack.status, 404, 'cross-provider PATCH must be indistinguishable from unknown id');
  assert.equal(attack.data.error.message, 'Service not found');

  const after = await dbRow(serviceA);
  assert.equal(after.name, before.name, "B must not be able to rename A's service");
  assert.equal(after.provider_id, providerAId);

  // The same id read back by its real owner is untouched and still reachable.
  const owner = await call('GET', API, undefined, tokenA);
  assert.ok(owner.data.services.some((s: any) => s.id === serviceA));
});

test('IDOR 3: DELETE with another provider\'s service id → 404 and stays active', async () => {
  const target = await call('POST', API, { categoryId, name: 'A protected service', priceFrom: 60 }, tokenA);
  assert.equal(target.status, 201);
  const targetId = target.data.service.id;

  const attack = await call('DELETE', `${API}/${targetId}`, undefined, tokenB);
  assert.equal(attack.status, 404);

  const row = await dbRow(targetId);
  assert.equal(row.is_active, true, "B must not be able to deactivate A's service");
  assert.equal(row.provider_id, providerAId);
});

test('IDOR 4+5: ownership cannot be reassigned through request bodies', async () => {
  // B tries to create a service directly owned by A.
  const create = await call(
    'POST',
    API,
    { categoryId, name: 'Injected ownership', priceFrom: 10, providerId: providerAId },
    tokenB,
  );
  assert.equal(create.status, 400, 'providerId is not an accepted field');

  // B tries to move an existing service to A.
  const bOwn = await call('POST', API, { categoryId, name: 'B movable', priceFrom: 10 }, tokenB);
  const bOwnId = bOwn.data.service.id;
  const move = await call('PATCH', `${API}/${bOwnId}`, { providerId: providerAId }, tokenB);
  assert.equal(move.status, 400);

  // Neither the snake_case DB column nor `id` are accepted either.
  assert.equal((await call('POST', API, { categoryId, name: 'Snake', priceFrom: 10, provider_id: providerAId }, tokenB)).status, 400);
  assert.equal((await call('PATCH', `${API}/${bOwnId}`, { id: providerAId }, tokenB)).status, 400);
  assert.equal((await call('PATCH', `${API}/${bOwnId}`, { userId: providerAId }, tokenB)).status, 400);

  // Database truth: B's service is still B's, and it does not exist under A.
  assert.equal((await dbRow(bOwnId)).provider_id, providerBId);
  const aList = await call('GET', API, undefined, tokenA);
  assert.ok(!aList.data.services.some((s: any) => s.id === bOwnId));
});

test('IDOR 6: unknown id, other-provider id and malformed id do not differ', async () => {
  const unknownId = '11111111-1111-4111-8111-111111111111';
  const validBody = { name: 'Hijack attempt' }; // valid, so the request reaches the ownership check
  const responses = await Promise.all([
    call('PATCH', `${API}/${serviceA}`, validBody, tokenB), // exists, not B's
    call('PATCH', `${API}/${unknownId}`, validBody, tokenB), // does not exist at all
    call('DELETE', `${API}/${serviceA}`, undefined, tokenB),
    call('DELETE', `${API}/${unknownId}`, undefined, tokenB),
  ]);
  for (const res of responses) {
    assert.equal(res.status, 404);
    assert.equal(res.data.error.message, 'Service not found');
  }
  // A non-UUID is a client error (400) and leaks nothing about existence.
  const malformed = await call('PATCH', `${API}/123`, validBody, tokenB);
  assert.equal(malformed.status, 400);
  // Body validation is independent of ownership: an invalid body is 400 for
  // BOTH a foreign id and an unknown id, so it is not an existence oracle.
  const badBodyOwn = await call('PATCH', `${API}/${serviceA}`, { name: 'x' }, tokenB);
  const badBodyUnknown = await call('PATCH', `${API}/${unknownId}`, { name: 'x' }, tokenB);
  assert.equal(badBodyOwn.status, 400);
  assert.equal(badBodyUnknown.status, 400);
  assert.equal(badBodyOwn.data.error.message, badBodyUnknown.data.error.message);
});

test('rule 7: non-providers and anonymous callers are rejected first', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const path = method === 'PATCH' || method === 'DELETE' ? `${API}/${serviceA}` : API;
    const body = method === 'GET' || method === 'DELETE' ? undefined : { categoryId, name: 'nope', priceFrom: 1 };
    assert.equal((await call(method, path, body)).status, 401, `${method} anonymous → 401`);
    assert.equal((await call(method, path, body, tokenCustomer)).status, 403, `${method} customer → 403`);
    assert.equal((await call(method, path, body, tokenAdmin)).status, 403, `${method} admin → 403`);
  }
  // The target service survived every rejected attempt.
  assert.equal((await dbRow(serviceA)).provider_id, providerAId);
});


/* ==========================================================================
   Phase 19 — custom categories (ADR-031)
   A provider may type a category that does not exist yet. The server must
   resolve it to a real `service_categories` row — the client never mints an id.
   ========================================================================== */

test('custom category: a typed name is created server-side and attached', async () => {
  const name = `CCTV Installation ${runId}`;
  const res = await call(
    'POST',
    API,
    { categoryName: name, name: 'Camera setup', priceFrom: 2500 },
    tokenA,
  );
  assert.equal(res.status, 201);
  // The response echoes the resolved, real category — not the raw text.
  assert.equal(res.data.service.categoryName, name);
  assert.ok(res.data.service.categoryId, 'a real category id must come back');
  assert.equal(res.data.service.categorySlug, categorySlug(name));

  const row = await pool.query('SELECT category_id FROM services WHERE id = $1', [
    res.data.service.id,
  ]);
  assert.equal(row.rows[0].category_id, res.data.service.categoryId);
});

test('custom category: typing a name never writes text into category_id', async () => {
  const res = await call(
    'POST',
    API,
    { categoryName: 'Solar Panel Maintenance', name: 'Panel clean', priceFrom: 1500 },
    tokenA,
  );
  assert.equal(res.status, 201);
  const okUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.match(res.data.service.categoryId, okUuid, 'category_id must remain a UUID');
});

test('custom category: case and whitespace differences do NOT duplicate', async () => {
  const base = `Water Purifier Service ${runId}`;
  const first = await call(
    'POST',
    API,
    { categoryName: base, name: 'Filter change A', priceFrom: 900 },
    tokenA,
  );
  assert.equal(first.status, 201);

  // Same name, different case + padding + internal spacing.
  const messy = `  ${base.toUpperCase().replace(/ /g, '   ')}  `;
  const second = await call(
    'POST',
    API,
    { categoryName: messy, name: 'Filter change B', priceFrom: 900 },
    tokenB,
  );
  assert.equal(second.status, 201);

  assert.equal(
    second.data.service.categoryId,
    first.data.service.categoryId,
    'a differently-cased/padded name must resolve to the same category row',
  );

  const rows = await pool.query('SELECT count(*)::int AS n FROM service_categories WHERE slug = $1', [
    categorySlug(base),
  ]);
  assert.equal(rows.rows[0].n, 1, 'exactly one category row must exist for that slug');
});

test('custom category: the seeded categories are reused, not duplicated', async () => {
  // "Plumbing" already exists with slug `plumbing`.
  const res = await call(
    'POST',
    API,
    { categoryName: '  PLUMBING  ', name: 'Leak trace', priceFrom: 1200 },
    tokenA,
  );
  assert.equal(res.status, 201);
  assert.equal(res.data.service.categorySlug, 'plumbing');

  const seeded = await pool.query(
    `SELECT count(*)::int AS n FROM service_categories
      WHERE slug = 'plumbing' AND name = 'Plumbing'`,
  );
  assert.equal(seeded.rows[0].n, 1, 'the curated category must not be duplicated');
});

test('custom category: a new name sorts AFTER the curated categories', async () => {
  const name = `Laptop Repair ${runId}`;
  await call('POST', API, { categoryName: name, name: 'Screen fix', priceFrom: 800 }, tokenA);
  const res = await call('GET', '/api/providers/categories');
  assert.equal(res.status, 200);
  const names: string[] = res.data.categories.map((c: any) => c.name);
  assert.ok(names.includes(name), 'a provider-created category is usable immediately');
  assert.ok(
    names.indexOf('Plumbing') < names.indexOf(name),
    'curated categories must stay ahead of provider-created ones',
  );
});

test('category selectors: exactly one of categoryId / categoryName is required', async () => {
  const neither = await call('POST', API, { name: 'No category', priceFrom: 100 }, tokenA);
  assert.equal(neither.status, 400, 'neither selector must be a 400');

  const both = await call(
    'POST',
    API,
    { categoryId, categoryName: 'Ambiguous', name: 'Both', priceFrom: 100 },
    tokenA,
  );
  assert.equal(both.status, 400, 'both selectors is ambiguous and must be a 400');
});

test('category selectors: an unknown categoryId is still rejected', async () => {
  const res = await call(
    'POST',
    API,
    {
      categoryId: '00000000-0000-4000-8000-999999999999',
      name: 'Ghost category',
      priceFrom: 100,
    },
    tokenA,
  );
  assert.equal(res.status, 400);
});

test('category selectors: a name with no usable characters is a 400', async () => {
  const res = await call('POST', API, { categoryName: '!!!', name: 'Nonsense', priceFrom: 100 }, tokenA);
  assert.equal(res.status, 400);
});

test('custom category: PATCH moves a service to a newly typed category', async () => {
  const created = await call(
    'POST',
    API,
    { categoryName: 'Pest Control', name: `Spray job ${runId}`, priceFrom: 1200 },
    tokenA,
  );
  assert.equal(created.status, 201);

  const moved = await call(
    'PATCH',
    `${API}/${created.data.service.id}`,
    { categoryName: `AC Installation ${runId}` },
    tokenA,
  );
  assert.equal(moved.status, 200);
  assert.equal(moved.data.service.categoryName, `AC Installation ${runId}`);
  assert.notEqual(moved.data.service.categoryId, created.data.service.categoryId);
});

test('OWNERSHIP: a provider cannot move a service owned by somebody else', async () => {
  const mine = await call(
    'POST',
    API,
    { categoryName: 'Wedding Decoration', name: `Own service ${runId}`, priceFrom: 5000 },
    tokenA,
  );
  assert.equal(mine.status, 201);

  // Provider B tries to re-point provider A's service at a category it names.
  const hijack = await call(
    'PATCH',
    `${API}/${mine.data.service.id}`,
    { categoryName: 'Hijacked Category' },
    tokenB,
  );
  assert.equal(hijack.status, 404, 'a service owned by somebody else is a 404');

  // …and the hijack must not have created a category either.
  const leaked = await pool.query(
    'SELECT count(*)::int AS n FROM service_categories WHERE name = $1',
    ['Hijacked Category'],
  );
  assert.equal(leaked.rows[0].n, 0, 'a rejected write must not create a category');
});

test('OWNERSHIP: a provider cannot delete a service owned by somebody else', async () => {
  const mine = await call(
    'POST',
    API,
    { categoryId, name: `Delete guard ${runId}`, priceFrom: 300 },
    tokenA,
  );
  assert.equal(mine.status, 201);

  const res = await call('DELETE', `${API}/${mine.data.service.id}`, undefined, tokenB);
  assert.equal(res.status, 404);
  const row = await dbRow(mine.data.service.id);
  assert.equal(row.is_active, true, 'the service must still be active');
});

test('APPROVAL: creating a service never makes a PENDING provider public', async () => {
  const fresh = await registerProvider(`svc-pending-${runId}@example.com`, 'Pending Pat', 'Pending Biz');
  const profile = await call('GET', '/api/providers/me', undefined, fresh.token);
  assert.equal(profile.data.profile.verificationStatus, 'PENDING');

  const created = await call(
    'POST',
    API,
    { categoryName: 'Glasswork', name: `Window fix ${runId}`, priceFrom: 900 },
    fresh.token,
  );
  assert.equal(created.status, 201, 'a PENDING provider may prepare their catalogue');

  // Still not public: the public profile endpoint reads through
  // public_providers, which only contains APPROVED providers.
  const pub = await call('GET', `/api/providers/${fresh.id}`);
  assert.equal(pub.status, 404, 'a PENDING provider must stay invisible publicly');

  const stillPending = await call('GET', '/api/providers/me', undefined, fresh.token);
  assert.equal(stillPending.data.profile.verificationStatus, 'PENDING');
});
