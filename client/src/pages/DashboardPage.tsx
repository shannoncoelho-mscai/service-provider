import { CalendarDays, Lock, Plus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, listMyBookingsPage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  RECENT_LIMIT,
  UPCOMING_LIMIT,
  firstNameOf,
  formatDateTime,
  greetingFor,
  nextAppointment,
  partitionBookings,
  summariseBookings,
} from '../lib/booking-utils';
import type { Booking } from '../types';
import BookingCard from '../components/booking/BookingCard';
import CancelBookingDialog from '../components/booking/CancelBookingDialog';
import AccountCard from '../components/dashboard/AccountCard';
import RecentBookings from '../components/dashboard/RecentBookings';
import SummaryCards from '../components/dashboard/SummaryCards';
import { ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; bookings: Booking[]; total: number }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'error' };

/** Signed out / wrong role / wrong account type — one shared gate. */
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

/** First run: no bookings at all. Never shows sample data. */
function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
        <CalendarDays className="h-6 w-6 text-brand-500" aria-hidden="true" />
      </div>
      <h2 className="font-display text-lg font-bold text-ink">No bookings yet</h2>
      <p className="max-w-md text-sm text-ink-soft">
        Find a trusted local service provider and book your first service. Your requests and their
        progress will appear here.
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Link to="/providers" className="btn btn-primary px-5 py-2.5 text-sm">
          <Search className="h-4 w-4" aria-hidden="true" />
          Find services
        </Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    listMyBookingsPage()
      .then((data) =>
        // `?? bookings.length` guards a malformed envelope rather than showing
        // "Total bookings 0" for a customer who demonstrably has bookings.
        setState({
          status: 'ready',
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

  // Re-fetch on navigation only. No interval, no polling, no auto-refresh.
  useEffect(load, [load, location.key]);

  // 1. Signed out — prompt instead of firing a request that can only 401.
  if (!user) {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Sign in to your dashboard"
        message="Your bookings and account details are private, so you need to sign in first."
        to="/login"
        cta="Sign in"
      />
    );
  }

  // 2. PROVIDER / ADMIN — this is the customer area, not theirs.
  if (user.role !== 'CUSTOMER') {
    return (
      <Gate
        icon={ShieldAlert}
        tone="amber"
        title="Customer accounts only"
        message={`This dashboard shows bookings you made as a customer. You are signed in as a ${user.role.toLowerCase()} account, so use the ${user.role === 'PROVIDER' ? 'provider' : 'admin'} area instead.`}
        to="/"
        cta="Back to home"
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading your dashboard…" />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Session expired"
        message="Please sign in again to view your dashboard."
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
        title="Not available for this account"
        message="This dashboard is for customer accounts. Your current account does not have access to it."
        to="/"
        cta="Back to home"
      />
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load your dashboard"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { bookings, total } = state;
  const { upcoming, recent } = partitionBookings(bookings);
  const summary = summariseBookings(bookings, total);
  const next = nextAppointment(upcoming);
  const firstName = firstNameOf(user);
  const hasBookings = bookings.length > 0;

  return (
    <div className="shell py-8">
      {/* Greeting — first name only, never a full legal name in large type. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">
            {greetingFor()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {hasBookings
              ? "Here's what's happening with your services."
              : 'Book your first service to get started.'}
          </p>
        </div>

        {/* Primary actions. "Refresh" is an explicit user action — the page
            never re-fetches on a timer. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="btn btn-ghost px-3.5 py-2.5 text-sm"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link to="/providers" className="btn btn-primary px-4 py-2.5 text-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New booking
          </Link>
        </div>
      </div>

      {hasBookings ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr] lg:items-start lg:gap-8">
          {/* Main column: stats, then upcoming, then history. */}
          <div className="order-2 space-y-6 lg:order-1">
            <SummaryCards summary={summary} />

            <section aria-labelledby="upcoming-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="upcoming-heading"
                  className="flex items-center gap-2 font-display text-lg font-bold text-ink"
                >
                  <CalendarDays className="h-4 w-4 text-brand-500" aria-hidden="true" />
                  Upcoming bookings
                </h2>
                {upcoming.length > 0 && (
                  <Link to="/bookings" className="text-sm font-medium text-brand-700 hover:underline">
                    View all bookings
                  </Link>
                )}
              </div>

              {upcoming.length === 0 ? (
                <div className="card mt-3 p-6 text-center">
                  <p className="text-sm text-ink-soft">
                    You have no upcoming bookings. Anything you request will show up here.
                  </p>
                  <Link to="/providers" className="btn btn-ghost mt-4 px-4 py-2 text-sm">
                    <Search className="h-4 w-4" aria-hidden="true" />
                    Find services
                  </Link>
                </div>
              ) : (
                <ul className="mt-3 grid gap-4 sm:grid-cols-2">
                  {upcoming.slice(0, UPCOMING_LIMIT).map((booking) => (
                    <li key={booking.id}>
                      <BookingCard booking={booking} onCancel={setCancelling} />
                    </li>
                  ))}
                </ul>
              )}

              {/* Only say "showing N of M" when the list is actually truncated. */}
              {upcoming.length > UPCOMING_LIMIT && (
                <p className="mt-3 text-center text-xs text-ink-soft">
                  Showing the next {UPCOMING_LIMIT} of {upcoming.length}.{' '}
                  <Link to="/bookings" className="font-medium text-brand-700 hover:underline">
                    View all bookings
                  </Link>
                </p>
              )}
            </section>

            <RecentBookings bookings={recent.slice(0, RECENT_LIMIT)} />

            {recent.length > RECENT_LIMIT && (
              <p className="-mt-3 text-center text-xs text-ink-soft">
                Showing {RECENT_LIMIT} of {recent.length}.{' '}
                <Link to="/bookings" className="font-medium text-brand-700 hover:underline">
                  View all bookings
                </Link>
              </p>
            )}
          </div>

          {/* Side column: next appointment + account. Sticky on desktop. */}
          <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-24">
            {next && (
              <section aria-labelledby="next-heading" className="card overflow-hidden">
                <div className="bg-gradient-to-br from-brand-50 to-brand-100/60 px-5 py-4">
                  <p
                    id="next-heading"
                    className="text-xs font-semibold uppercase tracking-wide text-brand-700"
                  >
                    Next appointment
                  </p>
                  <p className="mt-1 font-display text-lg font-bold text-ink">
                    {next.service?.name ?? 'Service removed'}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {next.provider?.businessName ?? 'Provider unavailable'}
                  </p>
                  <p className="mt-2 text-sm font-medium text-ink">
                    {formatDateTime(next.scheduledAt).date}
                    {formatDateTime(next.scheduledAt).time
                      ? ` at ${formatDateTime(next.scheduledAt).time}`
                      : ''}
                  </p>
                </div>
                <Link
                  to={`/bookings/${next.id}`}
                  className="block px-5 py-3 text-center text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
                >
                  View booking details
                </Link>
              </section>
            )}

            <AccountCard user={user} />
          </aside>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr] lg:items-start lg:gap-8">
          <div className="order-2 lg:order-1">
            <EmptyState />
          </div>
          <aside className="order-1 lg:order-2">
            <AccountCard user={user} />
          </aside>
        </div>
      )}

      {cancelling && (
        /* The EXISTING dialog, so there is exactly one cancellation path in the
           app. It posts { reason } and nothing else. */
        <CancelBookingDialog
          booking={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            // Re-read the bookings so the counts, the badges and the "next
            // appointment" card all reflect the server, not a local guess.
            setCancelling(null);
            load();
          }}
        />
      )}
    </div>
  );
}


