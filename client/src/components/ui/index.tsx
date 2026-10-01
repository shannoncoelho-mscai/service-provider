import { AlertCircle, Info, Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Inline message box. Never renders a raw API/SQL message — callers pass copy.
 *
 * ACCESSIBILITY: the two variants do not share a role. An error is announced
 * assertively (`role="alert"`) because it interrupts and is time-sensitive; a
 * success/informational message is announced politely (`role="status"`) so it
 * waits for a natural pause. Using `alert` for "Provider approved successfully"
 * would talk over whatever the user was actually listening to.
 *
 * Colour is never the only signal: the variant also picks a different icon
 * (warning vs. info).
 */
export function Alert({
  children,
  variant = 'error',
}: {
  children: ReactNode;
  variant?: 'error' | 'info';
}) {
  const isError = variant === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm ${
        isError
          ? 'border-red-100 bg-red-50 text-red-800'
          : 'border-brand-100 bg-brand-50 text-brand-800'
      }`}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Centred loading state for a whole page or panel.
 *
 * `role="status"` makes the label an announced live region; without it a screen
 * reader user gets a silent spinner and no idea the page is still working.
 * `aria-busy` alone is not announced.
 */
export function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-16"
      aria-busy="true"
    >
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" aria-hidden="true" />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}

/**
 * Full-panel error with a retry affordance.
 *
 * The message is chosen by the caller so a 404 reads as "not found" rather than
 * as a failure, and no raw server text is ever displayed.
 */
export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
        <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="max-w-md text-sm text-ink-soft">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-ghost mt-1 px-4 py-2 text-sm">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Label + control + error, wired for assistive tech.
 *
 * `aria-describedby` points at the error when present, and `aria-invalid` marks
 * the control, so a screen reader announces the reason a field is rejected.
 */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
        {required ? (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-ink-soft">Optional</span>
        )}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-soft">
          {hint}
        </p>
      )}
      <div className="mt-1.5">
        {children({
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1 text-xs text-red-600">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared input styling so every control matches the design system. */
export const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink ' +
  'placeholder:text-ink-soft/60 transition-colors focus:border-brand-400 ' +
  'aria-[invalid=true]:border-red-300 aria-[invalid=true]:bg-red-50/40';

/** Min height of 44px — the accessible touch-target floor on mobile. */
export const touchClass = 'min-h-11';
