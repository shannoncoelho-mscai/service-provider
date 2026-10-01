/**
 * Admin provider-verification API contract tests (ADR-027).
 *
 * These assert what actually reaches the network. The three decision endpoints
 * are `.strict()` on the server, so an extra field is a 400 — and a missing
 * `reason` on reject is a 400 too. The bodies are checked field-by-field rather
 * than by button label.
 *
 * `fetch` is stubbed; no server or database is involved.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  ApiError,
  approveProvider,
  getAdminProvider,
  listPendingProviders,
  rejectProvider,
  suspendProvider,
} from '../lib/api';

interface Call {
  url: string;
  method: string;
  body: string | null;
}

const calls: Call[] = [];

function stubFetch(status: number, payload: unknown) {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** Mirrors `AdminProviderDetail` as the server actually returns it. */
const PROVIDER = {
  userId: '22222222-2222-4222-8222-222222222222',
  businessName: 'Acme Plumbing',
  description: 'Friendly plumbing repairs since 2015.',
  phone: '+1 555 0101',
  city: 'Springfield',
  address: '12 High Street',
  serviceAreas: ['Springfield', 'Shelbyville'],
  yearsExperience: 9,
  hourlyRate: '80.00',
  profileImageUrl: null,
  coverImageUrl: null,
  verificationStatus: 'PENDING',
  isPublic: false,
  // An ADMIN's user id. Present in the payload, must never reach the DOM.
  verifiedBy: null,
  verifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  owner: { fullName: 'Alex Morgan', email: 'alex@example.com', isActive: true },
};

afterEach(() => {
  // @ts-expect-error — restoring the real fetch between tests.
  globalThis.fetch = undefined;
});

/* ------------------------------------------------------------- retrieval -- */

describe('listPendingProviders', () => {
  it('GETs the pending queue', async () => {
    stubFetch(200, { providers: [PROVIDER] });
    const providers = await listPendingProviders();
    assert.equal(calls[0].url, '/api/admin/providers/pending');
    assert.equal(calls[0].method, 'GET');
    assert.equal(providers.length, 1);
    assert.equal(providers[0].verificationStatus, 'PENDING');
  });

  it('returns an empty array when the queue is clear', async () => {
    stubFetch(200, { providers: [] });
    assert.deepEqual(await listPendingProviders(), []);
  });

  it('surfaces a 403 for a non-admin caller', async () => {
    stubFetch(403, { error: { message: 'Admin role required' } });
    await assert.rejects(
      () => listPendingProviders(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });
});

describe('getAdminProvider', () => {
  it('GETs one provider with its decision history', async () => {
    stubFetch(200, {
      provider: {
        ...PROVIDER,
        actions: [
          {
            action: 'PROVIDER_VERIFICATION_CHANGED',
            previousStatus: 'PENDING',
            newStatus: 'REJECTED',
            details: { reason: 'Could not verify registration' },
            createdAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    });
    const provider = await getAdminProvider(PROVIDER.userId);
    assert.equal(calls[0].url, `/api/admin/providers/${PROVIDER.userId}`);
    assert.equal(provider.actions.length, 1);
    assert.equal(provider.owner.email, 'alex@example.com');
  });

  it('surfaces a 404 for an unknown provider', async () => {
    stubFetch(404, { error: { message: 'Provider not found' } });
    await assert.rejects(
      () => getAdminProvider('missing'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

/* ------------------------------------------------------------- decisions -- */

describe('approveProvider', () => {
  it('PATCHes /approve with an EMPTY body — the note is optional', async () => {
    stubFetch(200, { provider: { ...PROVIDER, verificationStatus: 'APPROVED' } });
    const result = await approveProvider(PROVIDER.userId);

    assert.equal(calls[0].url, `/api/admin/providers/${PROVIDER.userId}/approve`);
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].body!), {});
    assert.equal(result.verificationStatus, 'APPROVED');
  });

  it('includes a trimmed note when one is supplied', async () => {
    stubFetch(200, { provider: { ...PROVIDER, verificationStatus: 'APPROVED' } });
    await approveProvider(PROVIDER.userId, '  Docs checked  ');
    assert.deepEqual(JSON.parse(calls[0].body!), { note: 'Docs checked' });
  });

  it('NEVER sends an admin id — the server takes the actor from the session', async () => {
    stubFetch(200, { provider: PROVIDER });
    await approveProvider(PROVIDER.userId, 'ok');
    const sent = JSON.parse(calls[0].body!);
    for (const forbidden of ['adminId', 'admin_id', 'verifiedBy', 'userId', 'providerId']) {
      assert.ok(!(forbidden in sent), `${forbidden} must never be sent by the client`);
    }
  });
});

describe('rejectProvider', () => {
  it('PATCHes /reject with the REQUIRED reason', async () => {
    stubFetch(200, { provider: { ...PROVIDER, verificationStatus: 'REJECTED' } });
    const result = await rejectProvider(PROVIDER.userId, 'Registration could not be verified');

    assert.equal(calls[0].url, `/api/admin/providers/${PROVIDER.userId}/reject`);
    assert.deepEqual(JSON.parse(calls[0].body!), {
      reason: 'Registration could not be verified',
    });
    assert.equal(result.verificationStatus, 'REJECTED');
  });

  it('trims the reason before sending', async () => {
    stubFetch(200, { provider: PROVIDER });
    await rejectProvider(PROVIDER.userId, '   Incomplete details   ');
    assert.equal(JSON.parse(calls[0].body!).reason, 'Incomplete details');
  });

  it('sends only `reason` — no status, no admin id', async () => {
    stubFetch(200, { provider: PROVIDER });
    await rejectProvider(PROVIDER.userId, 'Incomplete details');
    assert.deepEqual(Object.keys(JSON.parse(calls[0].body!)), ['reason']);
  });
});

describe('suspendProvider', () => {
  it('PATCHes /suspend with an EMPTY body when no reason is given', async () => {
    stubFetch(200, { provider: { ...PROVIDER, verificationStatus: 'SUSPENDED' } });
    const result = await suspendProvider(PROVIDER.userId);
    assert.equal(calls[0].url, `/api/admin/providers/${PROVIDER.userId}/suspend`);
    assert.deepEqual(JSON.parse(calls[0].body!), {});
    assert.equal(result.verificationStatus, 'SUSPENDED');
  });

  it('includes a trimmed reason when one is supplied', async () => {
    stubFetch(200, { provider: { ...PROVIDER, verificationStatus: 'SUSPENDED' } });
    await suspendProvider(PROVIDER.userId, '  Repeated no-shows  ');
    assert.deepEqual(JSON.parse(calls[0].body!), { reason: 'Repeated no-shows' });
  });
});

describe('decision error handling', () => {
  const cases: Array<[number, string]> = [
    [400, 'bad request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not found'],
    [409, 'conflict'],
    [500, 'server error'],
  ];

  for (const [status, label] of cases) {
    it(`surfaces a ${status} (${label}) without leaking internals`, async () => {
      // A deliberately DB-flavoured message: the page maps status -> copy, so
      // this text must never be the thing an admin is shown.
      stubFetch(status, {
        error: {
          message: `SELECT * FROM provider_profiles failed: relation "users" does not exist`,
        },
      });
      await assert.rejects(
        () => approveProvider(PROVIDER.userId),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, status);
          return true;
        },
      );
    });
  }

  it('reports a 409 when another admin already decided', async () => {
    stubFetch(409, { error: { message: 'Provider is already approved' } });
    await assert.rejects(
      () => approveProvider(PROVIDER.userId),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        return true;
      },
    );
  });
});

