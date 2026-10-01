import { ArrowRight, CalendarDays, CheckCircle2, MapPin, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../lib/booking-utils';
import type { Booking } from '../../types';
import BookingStatusBadge from './BookingStatusBadge';

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Post-submit confirmation.
 *
 * Renders only the booking the server returned, so it can never claim more
 * than was actually created. Navigation is offered explicitly — the page never
 * re-submits or auto-books anything, which is what stops a double booking from
 * a refresh or a back-button tap.
 */
export default function BookingConfirmation({
  booking,
  providerId,
}: {
  booking: Booking;
  providerId: string;
}) {
  const when = formatDateTime(booking.scheduledAt);

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="flex flex-col items-center gap-3 bg-gradient-to-br from-brand-50 to-brand-100/60 px-6 py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-soft">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Booking requested</h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">
            Your request has been sent to{' '}
            <span className="font-medium text-ink">{booking.provider?.businessName}</span>. They
            will review it and get back to you. Nothing is confirmed until they accept.
          </p>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      <div className="px-6 py-2">
        <dl className="divide-y divide-line">
          <Row icon={Wrench} label="Service">
            {booking.service?.name ?? '—'}
          </Row>
          <Row icon={CalendarDays} label="Requested date and time">
            {when.date}
            {when.time ? ` at ${when.time}` : ''}
          </Row>
          <Row icon={MapPin} label="Service address">
            {booking.address ?? '—'}
          </Row>
          {booking.problemDescription && (
            <Row icon={Wrench} label="Problem described">
              {booking.problemDescription}
            </Row>
          )}
          {booking.durationMinutes !== null && (
            <Row icon={CalendarDays} label="Estimated duration">
              {booking.durationMinutes} min
            </Row>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-3 border-t border-line px-6 py-5 sm:flex-row">
        <Link
          to="/bookings"
          className="btn btn-primary flex-1 px-4 py-3 text-sm"
        >
          View my bookings
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link to={`/providers/${providerId}`} className="btn btn-ghost flex-1 px-4 py-3 text-sm">
          Back to provider
        </Link>
      </div>
    </div>
  );
}
