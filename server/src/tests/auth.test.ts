import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Auth & RBAC integration tests (ADR-017).
 *
 * Run:  npm test --workspace server
 * Requires: PostgreSQL running + migrations applied (dev database).
 * The app listens on an ephemeral port; requests use global fetch.
 * Every account created here is deleted in `after()`.
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const email = (label: string) => `auth-${label}-${runId}@example.com`;
const cleanupEmails: string[] = [];

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

const register = (overrides: Record<string, unknown> = {}, label = 'x') => {
  const payload = {
    email: email(label),
    password: 'StrongPass123!',
    fullName: 'Test Person',
    role: 'CUSTOMER',
    ...overrides,
  };
  cleanupEmails.push(String(payload.email));
  return call('POST', '/api/auth/register', payload);
};

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Hermetic ADMIN account for the "admin may access admin routes" test
  // (public registration must not be able to mint admins).
  const adminEmail = email('admin');
  cleanupEmails.push(adminEmail);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Test Admin', 'ADMIN')`,
    [adminEmail, await hashPassword('AdminPass123!')],
  );
});

after(async () => {
  try {
    for (const address of cleanupEmails) {
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

// --- required scenarios ----------------------------------------------------

test('registration: successful customer registration returns token, no password hash', async () => {
  const address = email('ok-customer');
  cleanupEmails.push(address);
  const { status, data } = await call('POST', '/api/auth/register', {
    email: address,
    password: 'StrongPass123!',
    fullName: 'Carla Customer',
    role: 'CUSTOMER',
  });

  assert.equal(status, 201);
  assert.equal(data.user.email, address);
  assert.equal(data.user.role, 'CUSTOMER');
  assert.equal(data.tokenType, 'Bearer');
  assert.ok(typeof data.expiresIn === 'number' && data.expiresIn > 0);
  assert.ok(data.token && data.token.split('.').length === 3, 'expected a JWT');
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('password_hash'), 'password hash leaked');
  assert.ok(!serialized.includes('scrypt$'), 'password hash leaked');

  const me = await call('GET', '/api/auth/me', undefined, data.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, address);
});

test('registration: duplicate email → 409 with safe message', async () => {
  const address = email('dupe');
  cleanupEmails.push(address);
  const first = await call('POST', '/api/auth/register', {
    email: address, password: 'StrongPass123!', fullName: 'Dupe Tester', role: 'CUSTOMER',
  });
  assert.equal(first.status, 201);

  const second = await call('POST', '/api/auth/register', {
    email: address, password: 'DifferentPass456!', fullName: 'Dupe Tester', role: 'CUSTOMER',
  });
  assert.equal(second.status, 409);
  assert.match(second.data.error.message, /already exists/i);
  assert.ok(!JSON.stringify(second.data).includes('scrypt$'));
});

test('registration: rejects role=ADMIN (frontend cannot assign roles)', async () => {
  const address = email('sneaky-admin');
  cleanupEmails.push(address);
  const { status, data } = await call('POST', '/api/auth/register', {
    email: address, password: 'StrongPass123!', fullName: 'Sneaky User', role: 'ADMIN',
  });
  assert.equal(status, 400);
  assert.ok(!data.token, 'no token may be issued');
});

test('registration: input validation rejects short password and missing provider details', async () => {
  const weak = await register({ password: 'short', email: email('weak') }, 'weak');
  assert.equal(weak.status, 400);

  const incompleteProvider = await register(
    { role: 'PROVIDER', provider: undefined, email: email('prov-nodetails') },
    'prov-nodetails',
  );
  assert.equal(incompleteProvider.status, 400);
});

test('login: invalid credentials → uniform 401 for unknown email AND wrong password', async () => {
  const address = email('login-target');
  cleanupEmails.push(address);
  const created = await call('POST', '/api/auth/register', {
    email: address, password: 'StrongPass123!', fullName: 'Login Target', role: 'CUSTOMER',
  });
  assert.equal(created.status, 201);

  const unknownEmail = await call('POST', '/api/auth/login', {
    email: email('never-existed'), password: 'Whatever123!',
  });
  const wrongPassword = await call('POST', '/api/auth/login', {
    email: address, password: 'WrongPassword999!',
  });

  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.status, 401);
  // Identical message → cannot distinguish "no such account" from "bad password"
  assert.equal(unknownEmail.data.error.message, wrongPassword.data.error.message);
  assert.match(wrongPassword.data.error.message, /invalid email or password/i);
  assert.ok(!JSON.stringify(wrongPassword.data).includes('scrypt$'));
});

test('protected endpoint without authentication → 401', async () => {
  const me = await call('GET', '/api/auth/me');
  assert.equal(me.status, 401);

  const adminPing = await call('GET', '/api/admin/ping');
  assert.equal(adminPing.status, 401);
});

test('RBAC: customer token → admin endpoint rejected with 403', async () => {
  const created = await register({ email: email('rbac-customer') }, 'rbac-customer');
  assert.equal(created.status, 201);

  const denied = await call('GET', '/api/admin/ping', undefined, created.data.token);
  assert.equal(denied.status, 403);
  assert.match(denied.data.error.message, /permissions/i);
});

test('RBAC: provider token → admin endpoint rejected with 403', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('rbac-provider'),
      provider: { businessName: 'RBAC Test Repairs', city: 'Panaji' },
    },
    'rbac-provider',
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.user.role, 'PROVIDER');

  const denied = await call('GET', '/api/admin/ping', undefined, created.data.token);
  assert.equal(denied.status, 403);
});

test('RBAC: admin token → admin endpoint allowed with 200', async () => {
  const login = await call('POST', '/api/auth/login', {
    email: email('admin'), password: 'AdminPass123!',
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'ADMIN');

  const allowed = await call('GET', '/api/admin/ping', undefined, login.data.token);
  assert.equal(allowed.status, 200);
});

test('logout: revokes the session — token stops working immediately', async () => {
  const created = await register({ email: email('logout') }, 'logout');
  assert.equal(created.status, 201);
  const token = created.data.token;

  const before = await call('GET', '/api/auth/me', undefined, token);
  assert.equal(before.status, 200);

  const logout = await call('POST', '/api/auth/logout', undefined, token);
  assert.equal(logout.status, 200);

  const afterLogout = await call('GET', '/api/auth/me', undefined, token);
  assert.equal(afterLogout.status, 401);
});

test('login: provider registration creates a PENDING (not public) profile', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('pending-provider'),
      provider: { businessName: 'Pending Plumbing Co.', city: 'Mapusa' },
    },
    'pending-provider',
  );
  assert.equal(created.status, 201);

  const profile = await pool.query<{ verification_status: string; is_public: boolean }>(
    `SELECT p.verification_status, p.is_public
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.email = $1`,
    [created.data.user.email],
  );
  assert.equal(profile.rowCount, 1);
  assert.equal(profile.rows[0].verification_status, 'PENDING');
  assert.equal(profile.rows[0].is_public, false, 'unapproved provider must not be public');
});

/* ==========================================================================
   Phase 18 — Indian provider onboarding
   A provider must be able to supply a complete business profile at sign-up,
   and MUST still land as PENDING/non-public whatever they send.
   ========================================================================== */

test('provider registration stores business name, description, phone, areas and experience', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('full-provider'),
      provider: {
        businessName: 'Ganpati Aqua Plumbing',
        city: 'Panaji',
        description: 'Family-run plumbing business since 2015.',
        phone: '+91-98220-12345',
        serviceAreas: ['Panaji', 'Dona Paula'],
        yearsExperience: 9,
        hourlyRate: 7500,
      },
    },
    'full-provider',
  );
  assert.equal(created.status, 201);

  const row = await pool.query(
    `SELECT p.business_name, p.description, p.phone, p.city,
            p.service_areas, p.years_experience, p.hourly_rate,
            p.verification_status, p.is_public
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.email = $1`,
    [created.data.user.email],
  );
  assert.equal(row.rowCount, 1);
  const p = row.rows[0];
  assert.equal(p.business_name, 'Ganpati Aqua Plumbing');
  assert.equal(p.description, 'Family-run plumbing business since 2015.');
  assert.equal(p.phone, '+91-98220-12345');
  assert.equal(p.city, 'Panaji');
  assert.deepEqual(p.service_areas, ['Panaji', 'Dona Paula']);
  assert.equal(p.years_experience, 9);
  // The rate is stored as a plain NUMERIC — never a currency string.
  assert.equal(String(p.hourly_rate), '7500.00');
  assert.match(String(p.hourly_rate), /^[0-9.]+$/, 'price must be numeric, not a currency string');

  // Supplying a full profile must NOT make the provider public.
  assert.equal(p.verification_status, 'PENDING');
  assert.equal(p.is_public, false);
});

test('provider registration cannot set its own verification status', async () => {
  // A hand-crafted body trying to self-approve must not work: the endpoint
  // reads no status from the payload, and the schema is strict.
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('sneaky-provider'),
      provider: {
        businessName: 'Sneaky Services',
        city: 'Margao',
        verificationStatus: 'APPROVED',
      },
    },
    'sneaky-provider',
  );
  const row = await pool.query<{ verification_status: string; is_public: boolean }>(
    `SELECT p.verification_status, p.is_public
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.email = $1`,
    [created.data.user.email],
  );
  if (created.status === 201) {
    assert.equal(row.rows[0].verification_status, 'PENDING');
    assert.equal(row.rows[0].is_public, false);
  } else {
    assert.equal(created.status, 400, 'an unknown field must be a 400, not a silent accept');
  }
});

test('provider registration rejects service areas that are not a list of strings', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('bad-areas'),
      provider: { businessName: 'Bad Areas Co.', city: 'Ponda', serviceAreas: 'Panaji' },
    },
    'bad-areas',
  );
  assert.equal(created.status, 400);
});

test('provider registration rejects a negative years of experience', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('bad-years'),
      provider: { businessName: 'Bad Years Co.', city: 'Ponda', yearsExperience: -3 },
    },
    'bad-years',
  );
  assert.equal(created.status, 400);
});

test('provider registration rejects a non-positive price', async () => {
  const created = await register(
    {
      role: 'PROVIDER',
      email: email('bad-price'),
      provider: { businessName: 'Bad Price Co.', city: 'Ponda', hourlyRate: 0 },
    },
    'bad-price',
  );
  assert.equal(created.status, 400);
});
