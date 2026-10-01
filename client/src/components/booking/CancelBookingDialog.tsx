import { Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cancelBooking } from '../../lib/api';
import { NOTES_MAX, canCustomerCancel, formatDateTime } from '../../lib/booking-utils';
import type { Booking } from '../../types';
import { Alert, inputClass } from '../ui';

function explain(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'This booking can no longer be cancelled. Please refresh to see its current status.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 404:
      return 'That booking could not be found.';
    case 409:
      return 'The status of this booking just changed. Please refresh and try again.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}

/**
 * Cancellation confirmation dialog.
 *
 * Two things matter here:
 *  1. The button only appears when `canCustomerCancel(status)` says so. The
 *     server is still the authority — this merely avoids offering an action that
 *     is known to be refused (ADR-023).
 *  2. It calls PATCH /api/bookings/:id/cancel with ONLY a reason. There is no
 *     code path that sends a `status`, because that endpoint only cancels; the
 *     lifecycle transitions are a provider/admin capability and are not part of
 *     this phase.
 */
export default function CancelBookingDialog({
  booking,
  onClose,
  onCancelled,
}: {
  booking: Booking;
  onClose: () => void;
  onCancelled: (booking: Booking) => void;
}) {
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const when = formatDateTime(booking.scheduledAt);

  useEffect(() => {
    // Focus the dialog so keyboard users land inside it, and restore focus to
    // the trigger on close.
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cancelling) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancelling, onClose]);

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const updated = await cancelBooking(booking.id, reason.trim() || 'Cancelled by customer');
      onCancelled(updated);
    } catch (err) {
      setError(explain(err));
      setCancelling(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        // Click-outside dismisses, but never mid-request.
        if (e.target === e.currentTarget && !cancelling) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-booking-title"
        aria-describedby="cancel-booking-desc"
        tabIndex={-1}
        className="card w-full max-w-md animate-fade-up rounded-b-none p-6 sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50">
            <XCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
          </div>
          <div>
            <h2 id="cancel-booking-title" className="font-display text-lg font-bold text-ink">
              Cancel this booking?
            </h2>
            <p id="cancel-booking-desc" className="mt-1 text-sm text-ink-soft">
              {booking.service?.name ?? 'Your booking'} with{' '}
              {booking.provider?.businessName ?? 'this provider'} on {when.date}
              {when.time ? ` at ${when.time}` : ''} will be cancelled.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="cancel-reason" className="block text-sm font-semibold text-ink">
            Reason
            <span className="ml-1.5 text-xs font-normal text-ink-soft">Optional</span>
          </label>
          <textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, NOTES_MAX))}
            disabled={cancelling}
            placeholder="e.g. Something came up, I need to reschedule."
            className={`${inputClass} mt-1.5 resize-y`}
          />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={cancelling}
            className="btn btn-ghost flex-1 px-4 py-3 text-sm"
          >
            Keep booking
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling || !canCustomerCancel(booking.status)}
            aria-busy={cancelling}
            className="btn flex-1 bg-red-600 px-4 py-3 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Cancelling...
              </>
            ) : (
              'Cancel booking'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
