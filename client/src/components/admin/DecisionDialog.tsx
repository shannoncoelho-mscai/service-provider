import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ADMIN_REASON_MAX,
  decisionLabel,
  validateAdminReason,
} from '../../lib/admin-utils';
import type { AdminDecision } from '../../types';
import { Alert, inputClass } from '../ui';

const TONES = {
  APPROVED: { ring: 'bg-emerald-50', icon: 'text-emerald-600', button: 'bg-emerald-600 hover:bg-emerald-700' },
  REJECTED: { ring: 'bg-red-50', icon: 'text-red-500', button: 'bg-red-600 hover:bg-red-700' },
  SUSPENDED: { ring: 'bg-amber-50', icon: 'text-amber-600', button: 'bg-amber-600 hover:bg-amber-700' },
} as const;

/**
 * Confirmation dialog for one verification decision (ADR-027).
 *
 * Why the shape differs per decision — all three were read from the server's
 * schemas rather than assumed:
 *   APPROVED  `approveSchema`  — optional `note` (2–500). So a plain confirm.
 *   REJECTED  `rejectSchema`   — `reason` REQUIRED (5–500). A textarea that
 *                                cannot submit empty.
 *   SUSPENDED `suspendSchema`  — `reason` OPTIONAL (5–500). Same field, but
 *                                submitting without one is allowed.
 *
 * The dialog never performs the request itself: it validates and hands the
 * reason to `onConfirm`, so there is exactly one action code path in the app
 * and the dialog stays a pure confirmation surface.
 */
export default function DecisionDialog({
  decision,
  businessName,
  onClose,
  onConfirm,
}: {
  decision: AdminDecision;
  businessName: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Only rejection demands a reason; the other two do not.
  const reasonRequired = decision === 'REJECTED';
  const showReasonField = decision !== 'APPROVED';
  const tone = TONES[decision];

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
    const problem = validateAdminReason(reason, reasonRequired);
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
        aria-labelledby="decision-dialog-title"
        aria-describedby="decision-dialog-desc"
        tabIndex={-1}
        className="card w-full max-w-md animate-fade-up rounded-b-none p-6 sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.ring}`}>
            <span className={`text-lg font-bold leading-none ${tone.icon}`} aria-hidden="true">
              {decision === 'APPROVED' ? '?' : '!'}
            </span>
          </div>
          <div className="min-w-0">
            <h2 id="decision-dialog-title" className="font-display text-lg font-bold text-ink">
              {decisionLabel(decision)}?
            </h2>
            <p id="decision-dialog-desc" className="mt-1 text-sm text-ink-soft">
              {decision === 'APPROVED' && (
                <>
                  <span className="font-medium text-ink">{businessName}</span> will become publicly
                  bookable. This is recorded in the audit log.
                </>
              )}
              {decision === 'REJECTED' && (
                <>
                  <span className="font-medium text-ink">{businessName}</span> will not be able to
                  receive bookings. They can still sign in and update their profile.
                </>
              )}
              {decision === 'SUSPENDED' && (
                <>
                  <span className="font-medium text-ink">{businessName}</span> will be hidden from
                  customers and cannot accept new bookings.
                </>
              )}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        {showReasonField && (
          <div className="mt-4">
            <label htmlFor="decision-reason" className="block text-sm font-semibold text-ink">
              Reason
              {reasonRequired ? (
                <span className="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              ) : (
                <span className="ml-1.5 text-xs font-normal text-ink-soft">Optional</span>
              )}
            </label>
            <p className="mt-1 text-xs text-ink-soft">
              {reasonRequired
                ? 'Required. Record why so the decision is auditable.'
                : 'Optional. Stored with the decision in the audit log.'}
            </p>
            <textarea
              id="decision-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value.slice(0, ADMIN_REASON_MAX));
                setFieldError(null);
              }}
              disabled={busy}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'decision-reason-error' : undefined}
              placeholder={
                decision === 'REJECTED'
                  ? 'e.g. Business registration number could not be verified.'
                  : 'e.g. Repeated no-shows reported by customers.'
              }
              className={`${inputClass} mt-1.5 resize-y`}
            />
            {fieldError && (
              <p id="decision-reason-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldError}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-ghost flex-1 px-4 py-3 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy}
            className={`btn flex-1 px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60 ${tone.button}`}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Working...
              </>
            ) : (
              decisionLabel(decision)
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Map an API failure to copy an administrator can act on. Never raw. */
function explain(error: unknown): string {
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'That decision was not accepted. Please check the reason and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'This action requires an admin account.';
    case 404:
      return 'That provider could not be found.';
    case 409:
      return 'This provider has already been reviewed by someone else. The latest status has been loaded.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}
