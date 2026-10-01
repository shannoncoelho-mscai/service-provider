import {
  Briefcase,
  Inbox,
  Lock,
  RefreshCw,
  ShieldAlert,
  Store,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ApiError,
  getMyProviderProfile,
  listProviderBookings,
  updateProviderBookingStatus,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  PROVIDER_FILTERS,
  filterProviderBookings,
  sortProviderBookings,
  summariseProviderBookings,
  type ProviderFilter,
  type ProviderSummary,
} from '../lib/booking-utils';
import type { Booking, ProviderProfile, ProviderSettableStatus } from '../types';
import ProviderBookingCard from '../components/provider/ProviderBookingCard';
import ProviderSummaryCards from '../components/provider/ProviderSummaryCards';
import RejectBookingDialog from '../components/provider/RejectBookingDialog';
import VerificationNotice from '../components/provider/VerificationNotice';
import { Alert, ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; profile: ProviderProfile; bookings: Booking[]; total: number }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'error' };


/**
 * Map a filter tab to its field on `ProviderSummary`, so a tab can show a count
 * without a second data structure.
 *
 * `filterProviderBookings` compares the raw `BookingStatus`, while `summary`
 * uses camelCase keys (`inProgress`). This is the one place the two
 * vocabularies meet, so the mapping is explicit rather than guessed.
 */
function statusKey(filter: ProviderFilter): keyof ProviderSummary {
  switch (filter) {
    case 'PENDING':
      return 'pending';
    case 'ACCEPTED':
      return 'accepted';
    case 'IN_PROGRESS':
      return 'inProgress';
    case 'COMPLETED':
      return 'completed';
    case 'REJECTED':
      return 'rejected';
    case 'CANCELLED':
      return 'cancelled';
    case 'ALL':
      return 'total';
  }
}
/** Signed-out / wrong-role / expired-session gate. */
function Gate({
  icon: Icon,
  tone,
  title,
  message,
  to,
  cta,
}: {
  icon: typeof Lock;
  tone: 'brand' | 'amber';
  title: string;
  message: string;
  to: string;
  cta: string;
}) {
  return (
    <div className="shell py-12">
      <div className="card mx-auto max-w-md p-8 text-center">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            tone === 'brand' ? 'bg-brand-50' : 'bg-amber-50'
          }`}
        >
          <Icon
            className={`h-6 w-6 ${tone === 'brand' ? 'text-brand-500' : 'text-amber-500'}`}
            aria-hidden="true"
          />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</p>
        <Link to={to} className="btn btn-primary mt-6 w-full px-4 py-3 text-sm">
          {cta}
        </Link>
      </div>
    </div>
  );
}

/** First run: an approved provider with no bookings at all. */
function NoBookingsYet() {
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
        <Briefcase className="h-6 w-6 text-brand-500" aria-hidden="true" />
      </div>
      <h2 className="font-display text-lg font-bold text-ink">No bookings yet</h2>
      <p className="max-w-md text-sm text-ink-soft">
        Once your profile is live and customers find your services, their requests will appear
        here. Make sure your services are listed, current and priced.
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Link to="/providers" className="btn btn-ghost px-4 py-2.5 text-sm">
          <Store className="h-4 w-4" aria-hidden="true" />
          View my public profile
        </Link>
      </div>
    </div>
  );
}

/** A filter (or the queue as a whole) with nothing in it. */
function NothingMatches({ filtered }: { filtered: boolean }) {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
        <Inbox className="h-5 w-5 text-brand-400" aria-hidden="true" />
      </div>
      <h3 className="mt-3 font-display text-base font-bold text-ink">
        {filtered ? 'No bookings match this filter' : 'No pending booking requests'}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
        {filtered
          ? 'Try a different status tab to see the rest of your queue.'
          : 'New customer requests will appear here as soon as they arrive.'}
      </p>
    </div>
  );
}

/**
 * Provider dashboard — `/provider/dashboard` (ADR-026).
 *
 * DATA: one `GET /api/provider/bookings` (plus the provider's own profile) per
 * visit. Every count, filter and sort is applied to that single in-memory
 * response — no statistics endpoint, no per-tab request, no polling. "Refresh"
 * is an explicit user action.
 *
 * SECURITY: the provider id is ALWAYS the session user on the server. Nothing
 * here sends a providerId, and no code path can construct one. The role gate
 * below is UX only; `requireRole('PROVIDER')` and the ownership check inside
 * `loadVisibleBooking` are the real boundary. A provider cannot reach another
 * provider's booking: it is not in their queue, so there is no id to send.
 *
 * STATUS: every action goes through `updateProviderBookingStatus`, which sends
 * only `{ status }` (plus `{ reason }` when rejecting) and is gated by the
 * transition table. After success the queue is re-fetched rather than patched,
 * so a card never shows a status the server did not actually set.
 */
export default function ProviderDashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<ProviderFilter>('ALL');
  const [busy, setBusy] = useState<{ id: string; status: ProviderSettableStatus } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Booking | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    // Both requests are PROVIDER-scoped; Promise.all keeps it to one round of
    // parallel work rather than two sequential ones.
    Promise.all([getMyProviderProfile(), listProviderBookings()])
      .then(([profile, data]) =>
        setState({
          status: 'ready',
          profile,
          bookings: data.bookings ?? [],
          total: data.pagination?.total ?? data.bookings?.length ?? 0,
        }),
      )
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setState({ status: 'forbidden' });
        } else {
          setState({ status: 'error' });
        }
      });
  }, []);

  useEffect(load, [load, location.key]);

  // 1. Signed out — prompt without calling any provider endpoint.
  if (!user) {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Sign in to your provider dashboard"
        message="Your booking queue is private, so you need to sign in first."
        to="/login"
        cta="Sign in"
      />
    );
  }

  // 2. CUSTOMER / ADMIN — not their area.
  if (user.role !== 'PROVIDER') {
    return (
      <Gate
        icon={ShieldAlert}
        tone="amber"
        title="Provider accounts only"
        message={`This dashboard manages bookings assigned to you as a service provider. You are signed in as a ${user.role.toLowerCase()} account.`}
        to={user.role === 'CUSTOMER' ? '/dashboard' : '/'}
        cta={user.role === 'CUSTOMER' ? 'Go to my dashboard' : 'Back to home'}
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading your booking queue..." />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Session expired"
        message="Please sign in again to view your booking queue."
        to="/login"
        cta="Sign in"
      />
    );
  }

  if (state.status === 'forbidden') {
    return (
      <Gate
        icon={ShieldAlert}
        tone="amber"
        title="Provider profile unavailable"
        message="We could not load your provider profile. Please contact support if this persists."
        to="/"
        cta="Back to home"
      />
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load your queue"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { profile, bookings, total } = state;
  const summary = summariseProviderBookings(bookings, total);
  const visible = sortProviderBookings(filterProviderBookings(bookings, filter));
  const verified = profile.verificationStatus === 'APPROVED';

  function explain(error: unknown): string {
    const status = error instanceof ApiError ? error.status : 0;
    switch (status) {
      case 400:
        return 'That action was not accepted. Please check the reason and try again.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'This booking is not on your queue.';
      case 404:
        return 'That booking could not be found.';
      case 409:
        return 'This booking just changed status. The queue has been refreshed.';
      default:
        return 'Something went wrong on our side. Please try again in a moment.';
    }
  }

  /**
   * The single status-update path.
   *
   * `busy` is checked first so a double-click cannot fire two PATCHes: the
   * backend guards with `WHERE status = $current`, so a second identical
   * request would 409 anyway — but there is no reason to make the server do the
   * rejecting.
   */
  async function runAction(
    booking: Booking,
    status: ProviderSettableStatus,
    reason?: string,
  ) {
    if (busy) return;
    setBusy({ id: booking.id, status });
    setActionError(null);
    try {
      await updateProviderBookingStatus(booking.id, status, reason);
      setBusy(null);
      // Re-read rather than patch locally: the counts, the ordering and the
      // badges must reflect what the server actually stored.
      load();
    } catch (error) {
      setBusy(null);
      setActionError(explain(error));
      if (error instanceof ApiError && error.status === 409) load();
    }
  }

  return (
    <div className="shell py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">Booking requests</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {profile.businessName} ·{' '}
            {summary.pending > 0
              ? `${summary.pending} request${summary.pending === 1 ? '' : 's'} waiting on you`
              : 'Nothing waiting on you right now'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="btn btn-ghost px-3.5 py-2.5 text-sm"
            aria-label="Refresh booking queue"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link to="/providers" className="btn btn-ghost px-3.5 py-2.5 text-sm">
            <Store className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">My profile</span>
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <VerificationNotice status={profile.verificationStatus} />
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert>{actionError}</Alert>
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="mt-6">{verified ? <NoBookingsYet /> : null}</div>
      ) : (
        <>
          <div className="mt-6">
            <ProviderSummaryCards summary={summary} />
          </div>

          {/* Status tabs. Client-side: the whole queue is already in memory, so
              switching tabs costs no request. */}
          <div className="mt-6 flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter bookings by status">
            {PROVIDER_FILTERS.map((option) => {
              const isActive = filter === option.value;
              const count =
                option.value === 'ALL' ? summary.total : summary[statusKey(option.value)];
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(option.value)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-soft hover:border-brand-200 hover:bg-brand-50/50'
                  }`}
                >
                  {option.label}
                  <span
                    className={`rounded px-1.5 text-[11px] font-semibold ${
                      isActive ? 'bg-brand-100 text-brand-800' : 'bg-canvas text-ink-soft'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            {visible.length === 0 ? (
              <NothingMatches filtered={filter !== 'ALL'} />
            ) : (
              <ul className="grid gap-4 xl:grid-cols-2">
                {visible.map((booking) => (
                  <li key={booking.id}>
                    <ProviderBookingCard
                      booking={booking}
                      busyStatus={busy?.id === booking.id ? busy.status : null}
                      onAccept={(b) => runAction(b, 'ACCEPTED')}
                      onReject={setRejecting}
                      onStart={(b) => runAction(b, 'IN_PROGRESS')}
                      onComplete={(b) => runAction(b, 'COMPLETED')}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {rejecting && (
        <RejectBookingDialog
          booking={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await runAction(rejecting, 'REJECTED', reason);
            setRejecting(null);
          }}
        />
      )}
    </div>
  );
}
