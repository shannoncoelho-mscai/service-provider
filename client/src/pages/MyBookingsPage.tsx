import { CalendarDays, ChevronRight, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, listMyBookings } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import type { Booking } from '../types';
import BookingCard from '../components/booking/BookingCard';
import CancelBookingDialog from '../components/booking/CancelBookingDialog';
import { ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; bookings: Booking[] }
  | { status: 'unauthorized' }
  | { status: 'error' };

/** Shown when the customer has never booked anything. */
function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
        <CalendarDays className="h-6 w-6 text-brand-500" aria-hidden="true" />
      </div>
      <h2 className="font-display text-lg font-bold text-ink">No bookings yet</h2>
      <p className="max-w-md text-sm text-ink-soft">
        When you request a service from a provider, it will appear here so you can track it and
        cancel if your plans change.
      </p>
      <Link to="/providers" className="btn btn-primary mt-2 px-5 py-2.5 text-sm">
        Find a provider
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Compact counts so a customer can see at a glance what needs attention. */
function Summary({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) return null;
  const active = bookings.filter(
    (b) => b.status === 'PENDING' || b.status === 'ACCEPTED' || b.status === 'IN_PROGRESS',
  );
  const upcoming = active
    .filter((b) => new Date(b.scheduledAt).getTime() > Date.now())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];

  return (
    <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink-soft">Your bookings</p>
        <p className="mt-0.5 font-display text-2xl font-bold text-ink">
          {bookings.length} total · {active.length} active
        </p>
      </div>
      {upcoming && (
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-soft">Next appointment</p>
          <p className="mt-0.5 text-sm font-medium text-ink">
            {new Date(upcoming.scheduledAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        </div>
      )}
    </div>
  );
}

/** Signed-out / wrong-role / expired-session gate, shared by every state. */
function Gate({
  title,
  message,
  to,
  cta,
}: {
  title: string;
  message: string;
  to: string;
  cta: string;
}) {
  return (
    <div className="shell py-12">
      <div className="card mx-auto max-w-md p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
          <Lock className="h-6 w-6 text-brand-500" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{message}</p>
        <Link to={to} className="btn btn-primary mt-6 w-full px-4 py-3 text-sm">
          {cta}
        </Link>
      </div>
    </div>
  );
}

/**
 * The customer's bookings — `/bookings` (ADR-024).
 *
 * There is no filter or search parameter: the endpoint is scoped to the session
 * user, so the page has nothing to filter on and no way to ask for anybody
 * else's bookings. If the token is missing or expired the API answers 401 and
 * this renders a sign-in prompt instead of an error.
 */
export default function MyBookingsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    listMyBookings()
      .then((bookings) => setState({ status: 'ready', bookings }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else {
          setState({ status: 'error' });
        }
      });
  }, []);

  useEffect(load, [load, location.key]);

  // Signed out: prompt rather than firing a request that can only 401.
  if (!user) {
    return (
      <Gate
        title="Sign in to see your bookings"
        message="Your bookings are private to your account, so you need to sign in first."
        to="/login"
        cta="Sign in"
      />
    );
  }

  // A PROVIDER/ADMIN has no customer bookings. Say so rather than showing a
  // permanently empty list that looks like a bug.
  if (user.role !== 'CUSTOMER') {
    return (
      <Gate
        title="Customer accounts only"
        message={`This page lists bookings you made as a customer. You are signed in as a ${user.role.toLowerCase()} account.`}
        to="/"
        cta="Back to home"
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading your bookings…" />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <Gate
        title="Session expired"
        message="Please sign in again to view your bookings."
        to="/login"
        cta="Sign in"
      />
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load your bookings"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { bookings } = state;

  return (
    <div className="shell py-10">
      <h1 className="font-display text-3xl font-bold text-ink">My bookings</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        Track your service requests and cancel anything you no longer need.
      </p>

      <div className="mt-6">
        <Summary bookings={bookings} />
      </div>

      {bookings.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <BookingCard booking={booking} onCancel={setCancelling} />
            </li>
          ))}
        </ul>
      )}

      {cancelling && (
        <CancelBookingDialog
          booking={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            // Re-fetch so the list, the summary counts and the status badge all
            // reflect what the SERVER now considers true, not a local guess.
            setCancelling(null);
            load();
          }}
        />
      )}
    </div>
  );
}
