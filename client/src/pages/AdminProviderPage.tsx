import { ArrowLeft, Briefcase, CalendarDays, Mail, MapPin, Phone, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  approveProvider,
  getAdminProvider,
  rejectProvider,
  suspendProvider,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatPrice } from '../lib/format';
import {
  VERIFICATION_LABEL,
  adminProviderView,
  auditEntries,
  decisionSuccessMessage,
  formatDecisionTime,
  formatSubmitted,
} from '../lib/admin-utils';
import type { AdminDecision, AdminProviderReview } from '../types';
import DecisionButtons from '../components/admin/DecisionButtons';
import AdminBusinessImages from '../components/admin/AdminBusinessImages';
import DecisionDialog from '../components/admin/DecisionDialog';
import VerificationStatusBadge from '../components/admin/VerificationStatusBadge';
import { Alert, ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; provider: AdminProviderReview }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'notFound' }
  | { status: 'error' };

function Detail({ label, icon: Icon, children }: {
  label: string;
  icon: typeof MapPin;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50">
        <Icon className="h-4 w-4 text-brand-500" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Admin provider review — `/admin/providers/:id` (ADR-027).
 *
 * The id comes from the route, which is only ever populated from a link the
 * server's own pending list rendered. There is no free-text id field anywhere in
 * the admin UI, so an admin cannot hand-type an id to probe the endpoint.
 *
 * DATA ALLOW-LIST: the page renders through `adminProviderView(...)` and
 * `auditEntries(...)`. `verifiedBy` (an admin's user id) and the raw `details`
 * JSON blob are never displayed.
 *
 * STATE: after a decision the provider is RE-FETCHED so the badge reflects what
 * the server actually stored, then the admin is returned to the queue — which
 * has also been re-read, because another admin may have acted in between.
 */
export default function AdminProviderPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [deciding, setDeciding] = useState<AdminDecision | null>(null);
  const [busy, setBusy] = useState<AdminDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getAdminProvider(id)
      .then((provider) => setState({ status: 'ready', provider }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (error instanceof ApiError && error.status === 403) {
          setState({ status: 'forbidden' });
        } else if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      });
  }, [id]);

  useEffect(load, [load]);

  // Role gate BEFORE any admin request — same as the dashboard.
  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="shell py-12">
        <div className="card mx-auto max-w-md p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
            <ShieldAlert className="h-6 w-6 text-amber-500" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">Admin accounts only</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {user
              ? `Provider verification is handled by staff accounts. You are signed in as a ${user.role.toLowerCase()} account.`
              : 'Sign in with a staff account to review providers.'}
          </p>
          <Link
            to={user ? (user.role === 'PROVIDER' ? '/provider/dashboard' : '/dashboard') : '/login'}
            className="btn btn-primary mt-6 w-full px-4 py-3 text-sm"
          >
            {user ? 'Back to my dashboard' : 'Sign in'}
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading provider..." />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <div className="shell py-12">
        <ErrorState title="Session expired" message="Please sign in again to continue." />
      </div>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Admin access required"
          message="This account is not permitted to use the admin area."
        />
      </div>
    );
  }

  if (state.status === 'notFound') {
    return (
      <div className="shell py-12">
        <div className="card mx-auto max-w-md p-10 text-center">
          <h1 className="font-display text-xl font-bold text-ink">Provider not found</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This provider does not exist, or the link is out of date.
          </p>
          <Link to="/admin/dashboard" className="btn btn-primary mt-6 px-4 py-3 text-sm">
            Back to the queue
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load this provider"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { provider } = state;
  const view = adminProviderView(provider);
  const history = auditEntries(provider);

  async function runDecision(decision: AdminDecision, reason: string) {
    if (busy) return;
    setBusy(decision);
    setActionError(null);
    try {
      if (decision === 'APPROVED') {
        await approveProvider(id);
      } else if (decision === 'REJECTED') {
        await rejectProvider(id, reason);
      } else {
        await suspendProvider(id, reason || undefined);
      }
      setBusy(null);
      setNotice(decisionSuccessMessage(decision, view.businessName));
      // Re-read: the badge must show what the server stored, not a guess.
      load();
    } catch (error) {
      setBusy(null);
      setActionError(explain(error));
      // 409 -> another admin acted first; re-read to show the truth.
      if (error instanceof ApiError && error.status === 409) load();
    }
  }

  return (
    <div className="shell py-8">
      <Link
        to="/admin/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the queue
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">
            {view.businessName}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            {view.ownerName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VerificationStatusBadge status={view.verificationStatus} />
          <button
            type="button"
            onClick={load}
            className="btn btn-ghost px-3 py-2 text-sm"
            aria-label="Refresh this provider"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-5">
          <Alert variant="info">{notice}</Alert>
        </div>
      )}
      {actionError && (
        <div className="mt-5">
          <Alert>{actionError}</Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-8">
        <div className="order-2 space-y-6 lg:order-1">
          {view.description && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-ink">Business description</h2>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
                {view.description}
              </p>
            </section>
          )}

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink">
              Services offered
              <span className="ml-2 font-normal text-ink-soft">
                {view.services.length} listed
              </span>
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              What the provider sells and at what price. Prices are in rupees.
            </p>
            {view.services.length === 0 ? (
              <p className="mt-3 rounded-xl bg-canvas px-4 py-4 text-sm text-ink-soft">
                No services listed yet. This provider cannot take bookings until they add at least
                one, so you may wish to ask them to do so before approving.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {view.services.map((service) => (
                  <li key={service.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {service.name}
                        {!service.isActive && (
                          <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                            Inactive
                          </span>
                        )}
                      </p>
                      <p className="text-sm font-semibold text-brand-700">
                        {formatPrice(service.priceFrom)}
                        {service.priceTo && service.priceTo !== service.priceFrom
                          ? ` – ${formatPrice(service.priceTo)}`
                          : ''}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {service.categoryName}
                      {service.durationMinutes ? ` · ${service.durationMinutes} min` : ''}
                    </p>
                    {service.description && (
                      <p className="mt-1 text-sm text-ink-soft">{service.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Business photos (Phase 21) — read-only evidence, placed directly
              after the catalogue so a reviewer reads services and photos as one
              picture of what this provider actually does. */}
          <AdminBusinessImages images={view.images} />

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink">Details for review</h2>
            <dl className="mt-2 divide-y divide-line">
              <Detail label="Business name" icon={Briefcase}>{view.businessName}</Detail>
              <Detail label="Owner name" icon={UserRound}>{view.ownerName}</Detail>
              {view.ownerEmail && (
                <Detail label="Owner email" icon={Mail}>{view.ownerEmail}</Detail>
              )}
              {view.phone && <Detail label="Contact number" icon={Phone}>{view.phone}</Detail>}
              <Detail label="City" icon={MapPin}>{view.city}</Detail>
              {view.address && <Detail label="Business address" icon={MapPin}>{view.address}</Detail>}
              {view.serviceAreas.length > 0 && (
                <Detail label="Service areas" icon={MapPin}>
                  {view.serviceAreas.join(', ')}
                </Detail>
              )}
              <Detail label="Years of experience" icon={Briefcase}>
                {view.yearsExperience > 0 ? view.yearsExperience : 'Not provided'}
              </Detail>
              <Detail label="Submitted" icon={CalendarDays}>
                {formatSubmitted(view.createdAt)}
              </Detail>
              {view.verifiedAt && (
                <Detail label="Last decision" icon={CalendarDays}>
                  {formatDecisionTime(view.verifiedAt)}
                </Detail>
              )}
            </dl>
          </section>

          {history.length > 0 && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-line px-5 py-4 text-sm font-semibold text-ink">
                Decision history
              </h2>
              <ul className="divide-y divide-line">
                {history.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`} className="px-5 py-3.5">
                    <p className="text-sm text-ink">
                      {entry.previousStatus
                        ? `${entry.previousStatus} to ${entry.newStatus}`
                        : `Set to ${entry.newStatus}`}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {formatDecisionTime(entry.createdAt)}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
                        {entry.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-24">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink">Decision</h2>
            <p className="mt-1 text-xs text-ink-soft">
              Currently {VERIFICATION_LABEL[view.verificationStatus]}.
            </p>
            <div className="mt-4">
              <DecisionButtons
                status={view.verificationStatus}
                onDecide={setDeciding}
                busy={busy}
              />
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/dashboard')}
              className="btn btn-ghost mt-3 w-full px-4 py-2.5 text-sm"
            >
              Back to the queue
            </button>
          </section>
        </aside>
      </div>

      {deciding && (
        <DecisionDialog
          decision={deciding}
          businessName={view.businessName}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            const decision = deciding;
            setDeciding(null);
            await runDecision(decision, reason);
          }}
        />
      )}
    </div>
  );
}

function explain(error: unknown): string {
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'That decision was not accepted. Please check the reason and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'This action requires an admin account.';
    case 404:
      return 'That provider could not be found.';
    case 409:
      return 'This provider has already been reviewed by someone else. The latest status has been loaded.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}
