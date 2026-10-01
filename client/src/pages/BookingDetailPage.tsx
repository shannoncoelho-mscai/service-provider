import {
  ArrowLeft,
  CalendarDays,
  Clock,
  MapPin,
  SearchX,
  StickyNote,
  Wallet,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError, getBooking, listMyReviews } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  canCustomerCancel,
  formatDateTime,
  formatDuration,
  formatRelative,
} from '../lib/booking-utils';
import { formatPrice } from '../lib/format';
import type { Booking } from '../types';
import type { MyReview } from '../types';
import BookingStatusBadge from '../components/booking/BookingStatusBadge';
import CancelBookingDialog from '../components/booking/CancelBookingDialog';
import BookingReviewSection from '../components/reviews/BookingReviewSection';
import { ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; booking: Booking }
  | { status: 'notFound' }
  | { status: 'unauthorized' }
  | { status: 'error' };

function Detail({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof MapPin;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
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
 * One booking — `/bookings/:id` (ADR-024).
 *
 * The server scopes this endpoint to the session user, so a booking belonging
 * to someone else answers 404 exactly like a booking that does not exist. That
 * indistinguishability is deliberate: the page shows the same "not found" state
 * either way, so the URL cannot be used to probe for other people's bookings.
 */
export default function BookingDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [cancelling, setCancelling] = useState(false);
  // This booking's own review, if it has one. Loaded alongside the booking so
  // the section can show either the form or the stored review.
  const [review, setReview] = useState<MyReview | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getBooking(id)
      .then((booking) => {
        setState({ status: 'ready', booking });
        // Only COMPLETED bookings can be reviewed, so there is no point
        // asking for reviews for anything else.
        if (booking.status === 'COMPLETED') {
          listMyReviews()
            .then((mine) => {
              // Match on the booking id, never on a client-supplied id.
              setReview(mine.find((r) => r.bookingId === booking.id) ?? null);
            })
            .catch(() => setReview(null));
        } else {
          setReview(null);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'notFound' });
        } else if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else {
          setState({ status: 'error' });
        }
      });
  }, [id]);

  useEffect(load, [load]);

  if (!user) {
    return (
      <div className="shell py-12">
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-bold text-ink">Sign in to view this booking</h1>
          <p className="mt-2 text-sm text-ink-soft">Bookings are private to your account.</p>
          <Link
            to="/login"
            state={{ from: location.pathname }}
            className="btn btn-primary mt-6 w-full px-4 py-3 text-sm"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading booking…" />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <div className="shell py-12">
        <ErrorState title="Session expired" message="Please sign in again to view this booking." />
      </div>
    );
  }

  if (state.status === 'notFound') {
    return (
      <div className="shell py-12">
        <div className="card mx-auto max-w-md p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
            <SearchX className="h-6 w-6 text-brand-500" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">Booking not found</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This booking does not exist, or it is not on your account.
          </p>
          <Link to="/bookings" className="btn btn-primary mt-6 px-4 py-3 text-sm">
            Back to my bookings
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load this booking"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { booking } = state;
  const when = formatDateTime(booking.scheduledAt);
  const duration = formatDuration(booking.durationMinutes);

  return (
    <div className="shell py-10">
      <Link
        to="/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to my bookings
      </Link>

      <div className="mx-auto mt-4 max-w-3xl">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold text-ink">
                {booking.service?.name ?? 'Service removed'}
              </h1>
              <p className="mt-0.5 text-sm text-ink-soft">
                {booking.provider?.businessName ?? 'Provider unavailable'}
              </p>
            </div>
            <BookingStatusBadge status={booking.status} />
          </div>

          <dl className="divide-y divide-line px-6">
            <Detail label="Date" icon={CalendarDays}>
              {when.date}
            </Detail>
            <Detail label="Time" icon={Clock}>
              {when.time || '—'}
              {duration ? ` · about ${duration}` : ''}
            </Detail>
            <Detail label="Problem described" icon={Wrench}>
              {booking.problemDescription || '—'}
            </Detail>
            <Detail label="Service address" icon={MapPin}>
              {booking.address || '—'}
            </Detail>
            {booking.notes && (
              <Detail label="Notes" icon={StickyNote}>
                {booking.notes}
              </Detail>
            )}
            {booking.priceQuote && (
              <Detail label="Quoted price" icon={Wallet}>
                {formatPrice(booking.priceQuote)}
                {duration ? ` · ${duration}` : ''}
              </Detail>
            )}
            {booking.cancellationReason && (
              <Detail label="Cancellation reason" icon={XCircle}>
                {booking.cancellationReason}
              </Detail>
            )}
            {booking.rejectionReason && (
              <Detail label="Reason declined" icon={XCircle}>
                {booking.rejectionReason}
              </Detail>
            )}
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-4">
            <p className="text-xs text-ink-soft">Requested {formatRelative(booking.createdAt)}</p>
            {canCustomerCancel(booking.status) && (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className="btn btn-ghost px-4 py-2 text-sm"
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Cancel booking
              </button>
            )}
          </div>
        </div>
      </div>

      {cancelling && (
        <CancelBookingDialog
          booking={booking}
          onClose={() => setCancelling(false)}
          onCancelled={() => {
            // Re-read the booking so the status shown is the server's, not an
            // optimistic local guess.
            setCancelling(false);
            load();
          }}
        />
      )}

      {/* Review section — only ever renders for a COMPLETED booking. */}
      <div className="mx-auto mt-4 max-w-3xl">
        <BookingReviewSection
          bookingId={booking.id}
          status={booking.status}
          providerName={booking.provider?.businessName ?? null}
          review={review}
          onCreated={(created) => {
            // Show the review the SERVER stored, not the one just typed.
            setReview(created);
            load();
          }}
        />
      </div>
    </div>
  );
}