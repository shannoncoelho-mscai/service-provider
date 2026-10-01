import { CalendarDays, MapPin, Star, Wrench, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  canCustomerCancel,
  canReview,
  formatDateTime,
  formatDuration,
  formatRelative,
  shortAddress,
  summarise,
} from '../../lib/booking-utils';
import { formatPrice } from '../../lib/format';
import type { Booking } from '../../types';
import BookingStatusBadge from './BookingStatusBadge';

const StarIcon = () => <Star className="h-3.5 w-3.5" aria-hidden="true" />;

/**
 * One booking in the customer's list.
 *
 * Shows the fields a customer needs to recognise a booking at a glance and to
 * act on it. It never renders a customer id or any other customer's data — the
 * endpoint only ever returns the signed-in user's bookings.
 */
export default function BookingCard({
  booking,
  onCancel,
}: {
  booking: Booking;
  onCancel: (booking: Booking) => void;
}) {
  const when = formatDateTime(booking.scheduledAt);
  const duration = formatDuration(booking.durationMinutes);
  const cancellable = canCustomerCancel(booking.status);
  // Completed bookings are the only ones a customer can review (ADR-028). The
  // server re-checks, so this is about discoverability, not enforcement.
  const reviewable = canReview(booking.status);

  return (
    <article className="card p-5 transition-shadow hover:shadow-lift">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <Wrench className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            <span className="truncate">{booking.service?.name ?? 'Service removed'}</span>
          </h3>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            {booking.provider?.businessName ?? 'Provider unavailable'}
          </p>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="sr-only">Date and time</dt>
            <dd className="text-ink">
              {when.date}
              {when.time ? ` at ${when.time}` : ''}
            </dd>
            {duration && <p className="text-xs text-ink-soft">About {duration}</p>}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="sr-only">Address</dt>
            <dd className="break-words text-ink" title={booking.address ?? undefined}>
              {shortAddress(booking.address)}
            </dd>
          </div>
        </div>
      </dl>

      <p className="mt-3 line-clamp-2 text-sm text-ink-soft">
        {summarise(booking.problemDescription)}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-soft">Requested {formatRelative(booking.createdAt)}</p>
        <div className="flex items-center gap-2">
          {booking.priceQuote && (
            <span className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">
              {formatPrice(booking.priceQuote)} quoted
            </span>
          )}
          {cancellable && (
            <button
              type="button"
              onClick={() => onCancel(booking)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </button>
          )}
          {reviewable && (
            <Link
              to={`/bookings/${booking.id}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              <StarIcon />
              Leave a review
            </Link>
          )}
          <Link
            to={`/bookings/${booking.id}`}
            className="inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
          >
            View details
          </Link>
        </div>
      </div>
    </article>
  );
}
