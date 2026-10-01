/**
 * Admin provider-verification logic + component tests (ADR-027).
 *
 * The two things most likely to cause harm are tested hardest: which actions a
 * status exposes, and what the allow-list keeps out of the DOM.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  ADMIN_ACTIONS,
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
  VERIFICATION_LABEL,
  adminActionsFor,
  adminProviderView,
  auditEntries,
  canAdminDecide,
  decisionLabel,
  decisionSuccessMessage,
  queueSummary,
  validateAdminReason,
} from '../lib/admin-utils';
import DecisionButtons from '../components/admin/DecisionButtons';
import ProviderReviewCard from '../components/admin/ProviderReviewCard';
import VerificationStatusBadge from '../components/admin/VerificationStatusBadge';
import type { AdminProviderDetail, AdminProviderReview, VerificationStatus } from '../types';

/** Exactly the shape the admin endpoint returns, including `verifiedBy`. */
const PROVIDER: AdminProviderDetail = {
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
  // An ADMIN's user id, present in the payload.
  verifiedBy: '99999999-9999-4999-8999-999999999999',
  verifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  owner: { fullName: 'Alex Morgan', email: 'alex@example.com', isActive: true },
};

const noop = () => {};

/* ------------------------------------------------------- state-dependent -- */

describe('ADMIN_ACTIONS', () => {
  it('offers Approve and Reject to a PENDING provider', () => {
    assert.deepEqual([...adminActionsFor('PENDING')].sort(), ['APPROVED', 'REJECTED']);
    assert.equal(canAdminDecide('PENDING'), true);
  });

  it('offers only Suspend to an APPROVED provider', () => {
    assert.deepEqual([...adminActionsFor('APPROVED')], ['SUSPENDED']);
  });

  it('offers NOTHING to a REJECTED provider', () => {
    assert.deepEqual(ADMIN_ACTIONS.REJECTED, []);
    assert.equal(canAdminDecide('REJECTED'), false);
  });

  it('offers NOTHING to a SUSPENDED provider', () => {
    assert.deepEqual(ADMIN_ACTIONS.SUSPENDED, []);
    assert.equal(canAdminDecide('SUSPENDED'), false);
  });

  it('never offers PENDING as a target — no status can be set back to pending', () => {
    for (const targets of Object.values(ADMIN_ACTIONS)) {
      assert.ok(!targets.includes('PENDING' as never));
    }
  });

  it('never offers CANCELLED, which is not a verification status', () => {
    for (const targets of Object.values(ADMIN_ACTIONS)) {
      assert.ok(!targets.includes('CANCELLED' as never));
    }
  });
});

describe('labels', () => {
  it('names every decision', () => {
    assert.equal(decisionLabel('APPROVED'), 'Approve provider');
    assert.equal(decisionLabel('REJECTED'), 'Reject provider');
    assert.equal(decisionLabel('SUSPENDED'), 'Suspend provider');
  });

  it('names every verification status', () => {
    for (const status of Object.keys(VERIFICATION_LABEL) as VerificationStatus[]) {
      assert.ok(VERIFICATION_LABEL[status].length > 0);
    }
  });

  it('states the outcome in the past tense', () => {
    assert.match(decisionSuccessMessage('APPROVED', 'Acme'), /approved successfully/i);
    assert.match(decisionSuccessMessage('REJECTED', 'Acme'), /rejected successfully/i);
    assert.match(decisionSuccessMessage('SUSPENDED', 'Acme'), /suspended successfully/i);
  });
});

/* ---------------------------------------------------------------- reason -- */

describe('validateAdminReason', () => {
  it('requires a reason when the decision demands one', () => {
    assert.match(validateAdminReason('', true)!, /required/i);
    assert.match(validateAdminReason('   ', true)!, /required/i);
  });

  it('allows an empty reason where the server makes it optional', () => {
    assert.equal(validateAdminReason('', false), null);
  });

  it('enforces the server minimum of 5 characters when one is given', () => {
    assert.match(validateAdminReason('abc', true)!, new RegExp(String(ADMIN_REASON_MIN)));
    assert.equal(validateAdminReason('abcde', true), null);
  });

  it('enforces the server maximum of 500 characters', () => {
    assert.match(validateAdminReason('x'.repeat(ADMIN_REASON_MAX + 1), true)!, /under 500/i);
  });
});

/* ------------------------------------------------------------ allow-list -- */

describe('adminProviderView', () => {
  const view = adminProviderView(PROVIDER);

  it('exposes exactly the allow-listed fields, plus the route id', () => {
    assert.deepEqual(Object.keys(view).sort(), [
      'address',
      'businessName',
      'city',
      'coverImageUrl',
      'createdAt',
      'description',
      'hourlyRate',
      'id',
      'isPublic',
      'ownerEmail',
      'ownerName',
      'phone',
      'profileImageUrl',
      'serviceAreas',
      'verificationStatus',
      'verifiedAt',
      'yearsExperience',
    ]);
  });

  it('NEVER carries verifiedBy — an admin user id must not reach the UI', () => {
    assert.ok(!('verifiedBy' in view));
    assert.ok(!JSON.stringify(view).includes(PROVIDER.verifiedBy!));
  });

  it('NEVER carries owner.isActive — an auth concern, not a review one', () => {
    assert.ok(!JSON.stringify(view).includes('isActive'));
  });

  it('copies serviceAreas rather than aliasing the response array', () => {
    view.serviceAreas.push('Injected');
    assert.deepEqual(PROVIDER.serviceAreas, ['Springfield', 'Shelbyville']);
  });

  it('carries the id only for use as a route parameter', () => {
    assert.equal(view.id, PROVIDER.userId);
  });
});

describe('auditEntries', () => {
  it('reduces the details blob to a reason string', () => {
    const review: AdminProviderReview = {
      ...PROVIDER,
      actions: [
        {
          action: 'PROVIDER_VERIFICATION_CHANGED',
          previousStatus: 'PENDING',
          newStatus: 'REJECTED',
          details: { reason: 'Docs missing' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    };
    const entries = auditEntries(review);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].reason, 'Docs missing');
    assert.equal(entries[0].newStatus, 'REJECTED');
  });

  it('drops a details blob that is not a reason, rather than dumping JSON', () => {
    const review: AdminProviderReview = {
      ...PROVIDER,
      actions: [
        {
          action: 'PROVIDER_VERIFICATION_CHANGED',
          previousStatus: 'PENDING',
          newStatus: 'APPROVED',
          details: { secretInternalThing: 'do not render' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    };
    const entries = auditEntries(review);
    assert.equal(entries[0].reason, null);
    assert.ok(!JSON.stringify(entries).includes('do not render'));
  });

  it('handles a provider with no history', () => {
    assert.deepEqual(auditEntries({ ...PROVIDER, actions: [] }), []);
  });
});

describe('queueSummary', () => {
  it('counts only what the pending list can honestly report', () => {
    const summary = queueSummary([
      PROVIDER,
      { ...PROVIDER, userId: 'b', yearsExperience: 0, description: null },
      { ...PROVIDER, userId: 'c', yearsExperience: 3, description: '   ' },
    ]);
    assert.deepEqual(summary, { total: 3, withExperience: 2, withDescription: 1 });
  });

  it('reports zeros for an empty queue', () => {
    assert.deepEqual(queueSummary([]), { total: 0, withExperience: 0, withDescription: 0 });
  });
});

/* ------------------------------------------------------------- components -- */

const renderButtons = (status: VerificationStatus, busy: 'APPROVED' | 'REJECTED' | 'SUSPENDED' | null = null) =>
  renderToStaticMarkup(
    <DecisionButtons status={status} onDecide={noop} busy={busy} />,
  );

describe('DecisionButtons', () => {
  it('offers exactly Approve and Reject for a PENDING provider', () => {
    const html = renderButtons('PENDING');
    assert.match(html, /Approve provider/);
    assert.match(html, /Reject provider/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  });

  it('offers exactly one button (Suspend) for an APPROVED provider', () => {
    const html = renderButtons('APPROVED');
    assert.match(html, /Suspend provider/);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
  });

  it('renders NO buttons for a REJECTED provider', () => {
    assert.equal(renderButtons('REJECTED'), '');
  });

  it('renders NO buttons for a SUSPENDED provider', () => {
    assert.equal(renderButtons('SUSPENDED'), '');
  });

  it('never renders a control that submits a status value directly', () => {
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as VerificationStatus[]) {
      const html = renderButtons(status);
      // No <select>, and no form input that could post an arbitrary status.
      assert.ok(!/<select/i.test(html), `${status} must not offer a status dropdown`);
      assert.ok(!/name="status"/i.test(html));
    }
  });

  it('disables every button and shows progress while a decision is in flight', () => {
    const html = renderButtons('PENDING', 'APPROVED');
    assert.match(html, /Working\.\.\./);
    assert.match(html, /aria-busy="true"/);
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2, 'both buttons must be disabled');
  });
});

describe('VerificationStatusBadge', () => {
  it('names each status in text, not colour alone', () => {
    assert.match(renderToStaticMarkup(<VerificationStatusBadge status="PENDING" />), /Awaiting verification/);
    assert.match(renderToStaticMarkup(<VerificationStatusBadge status="APPROVED" />), /Approved/);
    assert.match(renderToStaticMarkup(<VerificationStatusBadge status="REJECTED" />), /Rejected/);
    assert.match(renderToStaticMarkup(<VerificationStatusBadge status="SUSPENDED" />), /Suspended/);
  });
});

describe('ProviderReviewCard', () => {
  const render = (over: Partial<Parameters<typeof adminProviderView>[0]> = {}) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ProviderReviewCard
          provider={adminProviderView({ ...PROVIDER, ...over })}
          onDecide={noop}
        />
      </MemoryRouter>,
    );

  it('renders the business name, owner and status', () => {
    const html = render();
    assert.match(html, /Acme Plumbing/);
    assert.match(html, /Alex Morgan/);
    assert.match(html, /Awaiting verification/);
  });

  it('renders the details a reviewer needs', () => {
    const html = render();
    assert.match(html, /Springfield/);
    assert.match(html, /Shelbyville/);
    assert.match(html, /\+1 555 0101/);
    assert.match(html, /9 years/);
    assert.match(html, /Friendly plumbing repairs/);
  });

  it('links to the detail page using the id from the server response', () => {
    assert.match(render(), new RegExp(`href="/admin/providers/${PROVIDER.userId}"`));
  });

  it('does NOT print the provider id as visible text', () => {
    const html = render();
    // Present in the href, absent from the rendered copy.
    const body = html.replace(/href="[^"]*"/g, '');
    assert.ok(!body.includes(PROVIDER.userId));
  });

  it('NEVER renders verifiedBy, the admin user id', () => {
    assert.ok(!render().includes(PROVIDER.verifiedBy!));
  });

  it('NEVER renders any authentication or internal data', () => {
    const html = render();
    for (const forbidden of ['password', 'token', 'session', 'hash', 'isActive', 'verified_by']) {
      assert.ok(!new RegExp(forbidden, 'i').test(html), `${forbidden} must not be rendered`);
    }
  });

  it('offers Approve and Reject on a PENDING card', () => {
    const html = render();
    assert.match(html, /Approve provider/);
    assert.match(html, /Reject provider/);
  });

  it('offers only Suspend on an APPROVED card', () => {
    const html = render({ verificationStatus: 'APPROVED' });
    assert.match(html, /Suspend provider/);
    assert.ok(!/Approve provider/.test(html));
  });

  it('offers no decisions on a REJECTED card', () => {
    assert.ok(!/Approve provider/.test(render({ verificationStatus: 'REJECTED' })));
  });
});



