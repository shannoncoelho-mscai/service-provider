import { ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../lib/booking-utils';
import type { Booking } from '../../types';
import BookingStatusBadge from '../booking/BookingStatusBadge';

/**
 * Compact one-line row for a finished booking.
 *
 * Deliberately a different shape from `BookingCard`: the dashboard's history
 * section is a scannable list, not a grid of full cards, so it omits the
 * problem description, price and cancel control. The full record is one click
 * away on /bookings/:id, so nothing is lost.
 */
function RecentRow({ booking }: { booking: Booking }) {
  const when = formatDateTime(booking.scheduledAt);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-brand-50/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {booking.service?.name ?? 'Service removed'}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-soft">
          {booking.provider?.businessName ?? 'Provider unavailable'}
          <span className="mx-1.5" aria-hidden="true">
            &middot;
          </span>
          {when.date}
          {when.time ? ` at ${when.time}` : ''}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        <Link
          to={`/bookings/${booking.id}`}
          className="inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
          aria-label={`View details for ${booking.service?.name ?? 'booking'}`}
        >
          View
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

/**
 * "Recent bookings" — the COMPLETED / CANCELLED / REJECTED history.
 *
 * Capped by the caller. A dashboard is an overview, not an archive: rendering
 * hundreds of rows would be slow and unreadable, so the full history lives at
 * /bookings and this section links there when there is more to see.
 */
export default function RecentBookings({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) {
    return (
      <section aria-labelledby="recent-heading" className="card p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
          <History className="h-5 w-5 text-brand-400" aria-hidden="true" />
        </div>
        <h2 id="recent-heading" className="mt-3 font-display text-base font-bold text-ink">
          No past bookings yet
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
          Completed, cancelled and declined bookings will appear here once you have had a service.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="recent-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2
          id="recent-heading"
          className="flex items-center gap-2 font-display text-base font-bold text-ink"
        >
          <History className="h-4 w-4 text-brand-500" aria-hidden="true" />
          Recent bookings
        </h2>
        <Link
          to="/bookings"
          className="inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {bookings.map((booking) => (
          <RecentRow key={booking.id} booking={booking} />
        ))}
      </ul>
    </section>
  );
}
