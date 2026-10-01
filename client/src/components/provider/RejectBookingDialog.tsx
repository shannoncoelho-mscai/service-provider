import { Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  REASON_MAX,
  formatDateTime,
  validateReason,
} from '../../lib/booking-utils';
import type { Booking } from '../../types';
import { Alert, inputClass } from '../ui';

function explain(error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'The reason was not accepted. Please write at least 3 characters and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'This booking is not on your queue.';
    case 404:
      return 'That booking could not be found.';
    case 409:
      return 'This booking just changed status. Please refresh and try again.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}

/**
 * Rejection dialog — a reason is MANDATORY (ADR-026).
 *
 * The server's `providerStatusSchema` requires `reason` when the target status is
 * REJECTED (a DB CHECK backs it), so this dialog cannot submit without one. The
 * dialog returns the reason to the caller; only the page performs the request, so
 * there is exactly one status-update code path in the app.
 */
export default function RejectBookingDialog({
  booking,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const when = formatDateTime(booking.scheduledAt);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function handleConfirm() {
    if (busy) return;
    const problem = validateReason(reason);
    setFieldError(problem);
    if (problem) return;

    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(explain(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-booking-title"
        aria-describedby="reject-booking-desc"
        tabIndex={-1}
        className="card w-full max-w-md animate-fade-up rounded-b-none p-6 sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50">
            <XCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
          </div>
          <div>
            <h2 id="reject-booking-title" className="font-display text-lg font-bold text-ink">
              Decline this request?
            </h2>
            <p id="reject-booking-desc" className="mt-1 text-sm text-ink-soft">
              {booking.service?.name ?? 'This booking'} for{' '}
              {booking.customerName ?? 'the customer'} on {when.date} will be declined. The
              customer will see the reason you give.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="reject-reason" className="block text-sm font-semibold text-ink">
            Reason
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <p className="mt-1 text-xs text-ink-soft">
            Required. The customer sees this, so please keep it clear and professional.
          </p>
          <textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value.slice(0, REASON_MAX));
              setFieldError(null);
            }}
            disabled={busy}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'reject-reason-error' : undefined}
            placeholder="e.g. Fully booked on that date — we can offer you Friday instead."
            className={`${inputClass} mt-1.5 resize-y`}
          />
          {fieldError && (
            <p id="reject-reason-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldError}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-ghost flex-1 px-4 py-3 text-sm"
          >
            Keep request
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy}
            className="btn flex-1 bg-red-600 px-4 py-3 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Declining...
              </>
            ) : (
              'Decline booking'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
