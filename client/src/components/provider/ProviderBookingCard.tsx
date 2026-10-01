import { CalendarDays, Clock, Loader2, MapPin, UserRound, Wrench } from 'lucide-react';
import { formatDateTime, formatDuration, formatRelative } from '../../lib/booking-utils';
import type { Booking } from '../../types';
import BookingStatusBadge from '../booking/BookingStatusBadge';

function Info({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="break-words text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** Inline spinner for whichever action is in flight. */
function Busy({ children }: { children: string }) {
  return (
    <>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {children}
    </>
  );
}

/**
 * One booking on the provider's queue.
 *
 * CUSTOMER DATA — strict allow-list. Everything shown comes from the `BookingDto`
 * the provider booking endpoint already returns: the counterparty display name,
 * the service address, the problem description and the customer's own notes. The
 * DTO has no customer email, phone, password hash, session id, token or customer
 * id, so the frontend never holds them and no second request is made to
 * "enrich" the customer. The provider's own contact details are deliberately not
 * rendered either — this is a job ticket, not a contacts sheet.
 *
 * ACTION GATING: a button is rendered only for the transition the server allows
 * from the current status, so `PENDING -> IN_PROGRESS`, `REJECTED -> COMPLETED`
 * and `CANCELLED -> ACCEPTED` are not merely rejected, they cannot be triggered
 * from this UI at all.
 */
export default function ProviderBookingCard({
  booking,
  onAccept,
  onReject,
  onStart,
  onComplete,
  busyStatus,
}: {
  booking: Booking;
  onAccept: (booking: Booking) => void;
  onReject: (booking: Booking) => void;
  onStart: (booking: Booking) => void;
  onComplete: (booking: Booking) => void;
  /** The target status currently in flight for this card, if any. */
  busyStatus?: string | null;
}) {
  const when = formatDateTime(booking.scheduledAt);
  const duration = formatDuration(booking.durationMinutes);
  const busy = busyStatus != null;

  return (
    <article className="card p-5 transition-shadow hover:shadow-lift">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <Wrench className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            <span className="truncate">{booking.service?.name ?? 'Service removed'}</span>
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-ink-soft">
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {booking.customerName ?? 'Customer'}
          </p>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Info icon={CalendarDays} label="Requested date">
          {when.date}
        </Info>
        <Info icon={Clock} label="Requested time">
          {when.time || '-'}
          {duration ? ` · about ${duration}` : ''}
        </Info>
        <div className="sm:col-span-2">
          <Info icon={MapPin} label="Service address">
            {booking.address ?? 'No address provided'}
          </Info>
        </div>
      </dl>

      {booking.problemDescription && (
        <div className="mt-4 rounded-xl bg-canvas p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Problem described
          </p>
          {/* whitespace-pre-wrap + break-words keeps a long description readable
              instead of producing one enormous line or overflowing. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
            {booking.problemDescription}
          </p>
        </div>
      )}

      {booking.notes && (
        <div className="mt-3 rounded-xl border border-line p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Customer notes
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
            {booking.notes}
          </p>
        </div>
      )}

      {(booking.rejectionReason || booking.cancellationReason) && (
        <p className="mt-3 text-xs text-ink-soft">
          {booking.rejectionReason
            ? `Declined: ${booking.rejectionReason}`
            : `Cancelled: ${booking.cancellationReason}`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-soft">Requested {formatRelative(booking.createdAt)}</p>

        <div className="flex flex-wrap items-center gap-2">
          {booking.status === 'PENDING' && (
            <>
              <button
                type="button"
                onClick={() => onAccept(booking)}
                disabled={busy}
                className="btn btn-primary min-h-10 px-4 py-2 text-sm disabled:opacity-60"
              >
                {busyStatus === 'ACCEPTED' ? <Busy>Accepting...</Busy> : 'Accept'}
              </button>
              <button
                type="button"
                onClick={() => onReject(booking)}
                disabled={busy}
                className="btn btn-ghost min-h-10 border-red-200 px-4 py-2 text-sm text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
              >
                Reject
              </button>
            </>
          )}

          {booking.status === 'ACCEPTED' && (
            <button
              type="button"
              onClick={() => onStart(booking)}
              disabled={busy}
              className="btn btn-primary min-h-10 px-4 py-2 text-sm disabled:opacity-60"
            >
              {busyStatus === 'IN_PROGRESS' ? <Busy>Starting...</Busy> : 'Start service'}
            </button>
          )}

          {booking.status === 'IN_PROGRESS' && (
            <button
              type="button"
              onClick={() => onComplete(booking)}
              disabled={busy}
              className="btn btn-primary min-h-10 px-4 py-2 text-sm disabled:opacity-60"
            >
              {busyStatus === 'COMPLETED' ? <Busy>Completing...</Busy> : 'Mark completed'}
            </button>
          )}
          {/* Terminal statuses render NO action: the server forbids every
              transition out of them, so the UI offers nothing to try. */}
        </div>
      </div>
    </article>
  );
}
