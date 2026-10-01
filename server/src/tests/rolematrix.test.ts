import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Role-matrix regression tests (Phase 17).
 *
 * The audit probed every route with every role by hand; this locks the result in
 * so a future route added without a guard fails loudly. Each row states the
 * expected status for anonymous / customer / provider / admin.
 *
 * Run:  npm test --workspace server
 */

let server: Server;
let base = '';
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const tok: Record<string, string> = { customer: '', provider: '', admin: '', inactive: '' };

const U = '00000000-0000-4000-8000-000000000000';

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  for (const [key, role] of [
    ['customer', 'CUSTOMER'],
    ['provider', 'PROVIDER'],
    ['admin', 'ADMIN'],
  ] as const) {
    const email = `rm-${key}-${runId}@example.com`;
    // Public registration cannot mint an admin, so roles are seeded directly.
    await pool.query('INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)', [
      email,
      await hashPassword('MatrixTest123!'),
      'Matrix ' + key,
      role,
    ]);
    if (role === 'PROVIDER') {
      const id = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
      await pool.query(
        'INSERT INTO provider_profiles (user_id, business_name, city) VALUES ($1,$2,$3)',
        [id, 'Matrix Plumbing ' + runId, 'Springfield'],
      );
    }
    const r = await call('POST', '/auth/login', { email, password: 'MatrixTest123!' });
    const token = (JSON.parse(r.text) as { token?: string }).token;
    assert.ok(token, 'fixture login must return a token for ' + key);
    tok[key] = token;
  }

  // A deactivated account: must not be able to log in OR use a held token.
  const email = `rm-inactive-${runId}@example.com`;
  await pool.query('INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES ($1,$2,$3,$4,FALSE)', [
    email,
    await hashPassword('MatrixTest123!'),
    'Matrix Inactive',
    'CUSTOMER',
  ]);
  const login = await call('POST', '/auth/login', { email, password: 'MatrixTest123!' });
  assert.equal(login.status, 401, 'a deactivated account must not be able to log in');
});

after(async () => {
  try {
    await pool.query(
      `DELETE FROM admin_action_log WHERE admin_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`%${runId}%`],
    );
    await pool.query(
      `DELETE FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`%${runId}%`],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${runId}%`]);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await pool.end();
  }
});

/* ---------------------------------------------------------------- matrix -- */

/** [method, path, body, anon, customer, provider, admin] */
const MATRIX: Array<[string, string, unknown, number, number, number, number]> = [
  // PUBLIC — no session required, same result for everybody.
  ['GET', '/health', undefined, 200, 200, 200, 200],
  ['GET', '/providers', undefined, 200, 200, 200, 200],
  ['GET', '/providers/categories', undefined, 200, 200, 200, 200],
  ['GET', `/providers/${U}`, undefined, 404, 404, 404, 404],

  // AUTHENTICATED, ANY ROLE — each user sees only their own rows.
  ['GET', '/auth/me', undefined, 401, 200, 200, 200],
  ['GET', '/notifications', undefined, 401, 200, 200, 200],
  ['GET', '/notifications/unread-count', undefined, 401, 200, 200, 200],
  ['PATCH', '/notifications/read-all', {}, 401, 200, 200, 200],

  // CUSTOMER ONLY — 403 (not 401) once authenticated but wrong role.
  ['GET', '/bookings/my', undefined, 401, 200, 403, 403],
  ['POST', '/bookings', {}, 401, 400, 403, 403],
  ['GET', `/bookings/${U}`, undefined, 401, 404, 403, 403],
  ['PATCH', `/bookings/${U}/cancel`, { reason: 'a valid reason' }, 401, 404, 403, 403],
  ['GET', '/reviews/my', undefined, 401, 200, 403, 403],
  ['POST', '/reviews', { bookingId: U, rating: 5 }, 401, 404, 403, 403],

  // PROVIDER ONLY
  ['GET', '/providers/me', undefined, 401, 403, 200, 403],
  ['PATCH', '/providers/me', { businessName: 'X' }, 401, 403, 400, 403],
  ['GET', '/providers/me/services', undefined, 401, 403, 200, 403],
  ['GET', '/provider/bookings', undefined, 401, 403, 200, 403],
  ['PATCH', `/provider/bookings/${U}/status`, { status: 'ACCEPTED' }, 401, 403, 404, 403],

  // ADMIN ONLY
  ['GET', '/admin/providers/pending', undefined, 401, 403, 403, 200],
  ['GET', `/admin/providers/${U}`, undefined, 401, 403, 403, 404],
  ['PATCH', `/admin/providers/${U}/approve`, {}, 401, 403, 403, 404],
  ['PATCH', `/admin/providers/${U}/reject`, { reason: 'a valid reason' }, 401, 403, 403, 404],
  ['PATCH', `/admin/providers/${U}/suspend`, {}, 401, 403, 403, 404],
];

describe('audit - role matrix', () => {
  for (const [method, path, body, anon, customer, provider, admin] of MATRIX) {
    const label = `${method} ${path.replace(U, ':id')}`;

    test(`${label} — anonymous ${anon}`, async () => {
      assert.equal((await call(method, path, body)).status, anon);
    });
    test(`${label} — customer ${customer}`, async () => {
      assert.equal((await call(method, path, body, tok.customer)).status, customer);
    });
    test(`${label} — provider ${provider}`, async () => {
      assert.equal((await call(method, path, body, tok.provider)).status, provider);
    });
    test(`${label} — admin ${admin}`, async () => {
      assert.equal((await call(method, path, body, tok.admin)).status, admin);
    });
  }
});

/* ------------------------------------------------------- token handling -- */

describe('audit - token handling', () => {
  const bad: Array<[string, string]> = [
    ['malformed', 'not-a-jwt'],
    ['empty', ''],
    ['no-signature', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9'],
    ['garbage', 'a.b.c'],
  ];

  for (const [label, token] of bad) {
    test(`a ${label} token is rejected with 401`, async () => {
      const res = await call('GET', '/auth/me', undefined, token);
      assert.equal(res.status, 401);
    });
  }

  test('a missing Authorization header is 401', async () => {
    assert.equal((await call('GET', '/auth/me')).status, 401);
  });

  test('logout revokes the session immediately', async () => {
    const email = `rm-logout-${runId}@example.com`;
    await pool.query('INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)', [
      email,
      await hashPassword('MatrixTest123!'),
      'Matrix Logout',
      'CUSTOMER',
    ]);
    const login = await call('POST', '/auth/login', { email, password: 'MatrixTest123!' });
    const token = (JSON.parse(login.text) as { token: string }).token;

    assert.equal((await call('GET', '/auth/me', undefined, token)).status, 200);
    assert.equal((await call('POST', '/auth/logout', {}, token)).status, 200);
    assert.equal(
      (await call('GET', '/auth/me', undefined, token)).status,
      401,
      'the token must stop working the moment it is revoked',
    );
  });

  test('an error response never contains SQL, a stack trace or a file path', async () => {
    const probes: Array<[string, string, unknown]> = [
      ['POST', '/bookings', { providerId: U }],
      ['POST', '/reviews', { bookingId: U, rating: 99 }],
      ['PATCH', `/admin/providers/${U}/approve`, {}],
      ['GET', `/bookings/${U}`, undefined],
    ];
    for (const [method, path, body] of probes) {
      const res = await call(method, path, body, tok.admin);
      const text = res.text.toLowerCase();
      for (const leak of [
        'select ',
        'insert into',
        'relation ',
        'pg_',
        'at object.',
        '.ts:',
        'node_modules',
        'postgres',
        'stack',
      ]) {
        assert.ok(!text.includes(leak), `${method} ${path} leaked "${leak}": ${res.text.slice(0, 200)}`);
      }
    }
  });
});
