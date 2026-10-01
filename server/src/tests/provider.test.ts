import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { app } from '../app';
import { pool } from '../config/database';
import { hashPassword } from '../lib/password';

/**
 * Provider onboarding & verification workflow tests (ADR-018/ADR-019).
 *
 * Run:  npm test --workspace server   (requires DB + migrations)
 *
 * Security rules covered:
 *  1. provider cannot approve themselves              (→ 403, status unchanged)
 *  2. provider cannot modify verificationStatus       (→ 400 strict schema)
 *  3. customer cannot access provider admin endpoints (→ 403)
 *  4. provider cannot modify another provider's profile (no cross-id route;
 *     foreign ids in body → 400; other provider's admin detail → 403)
 *  5. only admin can change verification status       (admin routes 200 + audit)
 */

let server: Server;
let base = '';

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emails = {
  providerA: `prov-a-${runId}@example.com`,
  providerB: `prov-b-${runId}@example.com`,
  customer: `cust-${runId}@example.com`,
  admin: `admin-${runId}@example.com`,
};
const BUSINESS_A = 'Fixture Plumbing Co.';
const BUSINESS_B = 'Fixture Electrical Co.';

let tokenA = '';
let tokenB = '';
let tokenCustomer = '';
let tokenAdmin = '';
let providerAId = '';
let providerBId = '';

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

async function verificationStatus(providerId: string): Promise<string> {
  const res = await pool.query<{ verification_status: string }>(
    'SELECT verification_status FROM provider_profiles WHERE user_id = $1',
    [providerId],
  );
  return res.rows[0]?.verification_status ?? 'MISSING';
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Fixtures: test-scoped ADMIN (created directly — public registration
  // cannot mint admins), a second provider, and a customer.
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Workflow Admin', 'ADMIN')`,
    [emails.admin, await hashPassword('AdminPass123!')],
  );

  const b = await call('POST', '/api/auth/register', {
    email: emails.providerB,
    password: 'StrongPass123!',
    fullName: 'Bob Provider',
    role: 'PROVIDER',
    provider: { businessName: BUSINESS_B, city: 'Dallas' },
  });
  assert.equal(b.status, 201);
  tokenB = b.data.token;
  providerBId = b.data.user.id;

  const c = await call('POST', '/api/auth/register', {
    email: emails.customer,
    password: 'StrongPass123!',
    fullName: 'Cara Customer',
    role: 'CUSTOMER',
  });
  assert.equal(c.status, 201);
  tokenCustomer = c.data.token;
});

after(async () => {
  try {
    const admin = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      emails.admin,
    ]);
    if (admin.rows[0]) {
      // admin_action_log.admin_id is ON DELETE RESTRICT — remove test audit
      // rows before deleting the test admin (production rows untouched).
      await pool.query('DELETE FROM admin_action_log WHERE admin_id = $1', [admin.rows[0].id]);
    }
    for (const address of Object.values(emails)) {
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

// --- workflow tests (serial; state transitions are ordered) -----------------

test('provider registers → profile PENDING → NOT publicly visible', async () => {
  const res = await call('POST', '/api/auth/register', {
    email: emails.providerA,
    password: 'StrongPass123!',
    fullName: 'Pat Provider',
    role: 'PROVIDER',
    provider: { businessName: BUSINESS_A, city: 'Austin' },
  });
  assert.equal(res.status, 201);
  tokenA = res.data.token;
  providerAId = res.data.user.id;

  const me = await call('GET', '/api/providers/me', undefined, tokenA);
  assert.equal(me.status, 200);
  assert.equal(me.data.profile.verificationStatus, 'PENDING');
  assert.equal(me.data.profile.isPublic, false);
  assert.equal(me.data.profile.businessName, BUSINESS_A);

  const publicRows = await pool.query('SELECT 1 FROM public_providers WHERE id = $1', [
    providerAId,
  ]);
  assert.equal(publicRows.rowCount, 0, 'PENDING provider must not be publicly visible');
});

test('provider updates own profile; cannot modify verificationStatus or another profile', async () => {
  const updated = await call(
    'PATCH',
    '/api/providers/me',
    {
      businessName: 'Austin Plumbing Pros',
      serviceAreas: ['Austin', 'Round Rock'],
      phone: '+1-512-555-0133',
      profileImageUrl: 'https://cdn.example.com/profile.png',
      coverImageUrl: 'https://cdn.example.com/cover.png',
      yearsExperience: 9,
    },
    tokenA,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.data.profile.businessName, 'Austin Plumbing Pros');
  assert.deepEqual(updated.data.profile.serviceAreas, ['Austin', 'Round Rock']);
  assert.equal(updated.data.profile.verificationStatus, 'PENDING');

  // Rule 2: verification fields are rejected outright (strict schema)
  const smuggleStatus = await call(
    'PATCH',
    '/api/providers/me',
    { verificationStatus: 'APPROVED', isPublic: true, verifiedBy: providerAId },
    tokenA,
  );
  assert.equal(smuggleStatus.status, 400);

  // Rule 4: foreign ids in the body are rejected (no cross-profile writes)
  const crossWrite = await call('PATCH', '/api/providers/me', { userId: providerBId }, tokenA);
  assert.equal(crossWrite.status, 400);

  // /me still returns THIS provider's row
  const me = await call('GET', '/api/providers/me', undefined, tokenA);
  assert.equal(me.data.profile.userId, providerAId);
  assert.equal(me.data.profile.businessName, 'Austin Plumbing Pros');

  // Database truth: A still PENDING; B untouched
  assert.equal(await verificationStatus(providerAId), 'PENDING');
  const b = await pool.query<{ business_name: string }>(
    'SELECT business_name FROM provider_profiles WHERE user_id = $1',
    [providerBId],
  );
  assert.equal(b.rows[0].business_name, BUSINESS_B);
});

// --- required authorization rules -------------------------------------------

test('rule 1+3+4+5: non-admins cannot reach admin endpoints or change status', async () => {
  const adminLogin = await call('POST', '/api/auth/login', {
    email: emails.admin,
    password: 'AdminPass123!',
  });
  assert.equal(adminLogin.status, 200);
  tokenAdmin = adminLogin.data.token;

  // Rule 3: customer cannot access provider admin endpoints
  assert.equal((await call('GET', '/api/admin/providers/pending', undefined, tokenCustomer)).status, 403);
  assert.equal(
    (await call('PATCH', `/api/admin/providers/${providerAId}/approve`, {}, tokenCustomer)).status,
    403,
  );

  // Rule 1: provider cannot approve THEMSELVES
  const selfApprove = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/approve`,
    {},
    tokenA,
  );
  assert.equal(selfApprove.status, 403);

  // Rule 4: provider B cannot approve provider A (no cross-profile power)
  assert.equal(
    (await call('PATCH', `/api/admin/providers/${providerAId}/approve`, {}, tokenB)).status,
    403,
  );

  // Rule 4 + 5: provider cannot read admin queue/details of other providers
  assert.equal((await call('GET', '/api/admin/providers/pending', undefined, tokenA)).status, 403);
  assert.equal(
    (await call('GET', `/api/admin/providers/${providerBId}`, undefined, tokenA)).status,
    403,
  );

  // Rule 3: customer cannot use provider self-service either
  assert.equal((await call('GET', '/api/providers/me', undefined, tokenCustomer)).status, 403);

  // Rule 5: after ALL attempts, status is untouched in the database
  assert.equal(await verificationStatus(providerAId), 'PENDING');
});

test('admin sees pending queue and full provider detail', async () => {
  const pending = await call('GET', '/api/admin/providers/pending', undefined, tokenAdmin);
  assert.equal(pending.status, 200);
  const ids: string[] = pending.data.providers.map((p: any) => p.userId);
  assert.ok(ids.includes(providerAId), 'A must be in the pending queue');
  assert.ok(ids.includes(providerBId), 'B must be in the pending queue');
  assert.equal(pending.data.providers.every((p: any) => p.verificationStatus === 'PENDING'), true);

  const detail = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenAdmin);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.provider.owner.email, emails.providerA);
  assert.equal(detail.data.provider.verificationStatus, 'PENDING');
  assert.deepEqual(detail.data.provider.actions, [], 'no decisions yet');

  // Input validation: non-UUID → 400, unknown UUID → 404
  const badId = await call('GET', '/api/admin/providers/not-a-uuid', undefined, tokenAdmin);
  assert.equal(badId.status, 400);
  const missing = await call(
    'GET',
    '/api/admin/providers/00000000-0000-4000-8000-00000000dead',
    undefined,
    tokenAdmin,
  );
  assert.equal(missing.status, 404);
});

test('admin rejects WITH reason → REJECTED + AdminActionLog, still not public', async () => {
  const res = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/reject`,
    { reason: 'No trade certification provided' },
    tokenAdmin,
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.provider.verificationStatus, 'REJECTED');
  assert.equal(await verificationStatus(providerAId), 'REJECTED');

  const rows = await pool.query<{
    previous_status: string;
    new_status: string;
    details: { reason?: string };
    admin_id: string;
  }>(
    `SELECT previous_status, new_status, details, admin_id
       FROM admin_action_log
      WHERE target_type = 'PROVIDER_PROFILE' AND target_id = $1`,
    [providerAId],
  );
  assert.equal(rows.rowCount, 1, 'decision must create exactly one audit row');
  assert.equal(rows.rows[0].previous_status, 'PENDING');
  assert.equal(rows.rows[0].new_status, 'REJECTED');
  assert.equal(rows.rows[0].details.reason, 'No trade certification provided');

  const publicRows = await pool.query('SELECT 1 FROM public_providers WHERE id = $1', [providerAId]);
  assert.equal(publicRows.rowCount, 0);
});

test('admin approves a REJECTED provider → APPROVED + log → publicly searchable', async () => {
  const res = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/approve`,
    { note: 'Certification received and verified' },
    tokenAdmin,
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.provider.verificationStatus, 'APPROVED');
  assert.equal(res.data.provider.isPublic, true);
  assert.ok(res.data.provider.verifiedBy, 'verified_by must record the admin');

  // THE core business rule: approved → visible in the public directory
  const publicRows = await pool.query('SELECT business_name FROM public_providers WHERE id = $1', [
    providerAId,
  ]);
  assert.equal(publicRows.rowCount, 1);
  assert.equal(publicRows.rows[0].business_name, 'Austin Plumbing Pros');

  const detail = await call('GET', `/api/admin/providers/${providerAId}`, undefined, tokenAdmin);
  const transitions: string[] = detail.data.provider.actions.map(
    (a: any) => `${a.previousStatus}->${a.newStatus}`,
  );
  assert.deepEqual(transitions.sort(), ['PENDING->REJECTED', 'REJECTED->APPROVED']);
});

test('admin suspends → SUSPENDED + log → removed from public view', async () => {
  const res = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/suspend`,
    { reason: 'Repeated customer complaints' },
    tokenAdmin,
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.provider.verificationStatus, 'SUSPENDED');
  assert.equal(await verificationStatus(providerAId), 'SUSPENDED');

  const publicRows = await pool.query('SELECT 1 FROM public_providers WHERE id = $1', [providerAId]);
  assert.equal(publicRows.rowCount, 0, 'SUSPENDED provider must disappear from public view');

  // Rule 5: all three transitions produced audit rows for this provider
  const rows = await pool.query<{ previous_status: string; new_status: string }>(
    `SELECT previous_status, new_status FROM admin_action_log
      WHERE target_type = 'PROVIDER_PROFILE' AND target_id = $1`,
    [providerAId],
  );
  const transitions = rows.rows.map((r) => `${r.previous_status}->${r.new_status}`).sort();
  assert.deepEqual(transitions, [
    'APPROVED->SUSPENDED',
    'PENDING->REJECTED',
    'REJECTED->APPROVED',
  ]);
});

test('state machine & validation: 409 on no-op decisions, reject needs reason', async () => {
  // Already SUSPENDED → suspending again is a no-op → 409
  const again = await call(
    'PATCH',
    `/api/admin/providers/${providerAId}/suspend`,
    { reason: 'again' },
    tokenAdmin,
  );
  assert.equal(again.status, 409);

  // Reject without a reason → 400 (and status untouched)
  const noReason = await call('PATCH', `/api/admin/providers/${providerAId}/reject`, {}, tokenAdmin);
  assert.equal(noReason.status, 400);
  assert.equal(await verificationStatus(providerAId), 'SUSPENDED');

  // Provider B remains untouched by all of A's workflow
  assert.equal(await verificationStatus(providerBId), 'PENDING');
});
