import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import {
  ADDRESS_MAX,
  MAX_ADVANCE_DAYS,
  NOTES_MAX,
  PROBLEM_MAX,
  PROBLEM_MIN,
  localSlotToUtc,
  maxBookableDate,
  todayLocal,
  validateBooking,
  type BookingFormValues,
  type FieldErrors,
} from '../../lib/booking-utils';
import { createBooking } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import type { Booking, PublicProviderProfile } from '../../types';
import { Alert, Field, inputClass, touchClass } from '../ui';
import ServicePicker from './ServicePicker';

const EMPTY: BookingFormValues = {
  serviceId: '',
  date: '',
  time: '',
  problemDescription: '',
  address: '',
  notes: '',
};

/**
 * Turn an ApiError into copy a customer can act on.
 *
 * The server never sends SQL or stack traces (ADR-016/021), and this function
 * adds a second layer: status-specific guidance is preferred for the statuses a
 * customer can actually trigger.
 */
function explain(error: unknown, context: 'create' | 'cancel'): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'Some of the details were not accepted. Please review the form and try again.';
    case 401:
      return 'Your session has expired. Please sign in again to continue.';
    case 403:
      return 'This account is not allowed to make bookings. Only customer accounts can book services.';
    case 404:
      return context === 'cancel'
        ? 'That booking could not be found.'
        : 'This provider or service is no longer available. Please choose another service.';
    case 409:
      return 'That time slot has just been taken or is no longer available. Please pick a different time.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}

/** Read-only provider card shown beside the form. */
export function ProviderSummary({ provider }: { provider: PublicProviderProfile }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Booking with</p>
      <h2 className="mt-1 font-display text-xl font-bold text-ink">{provider.businessName}</h2>
      {provider.description && (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{provider.description}</p>
      )}
      <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Location</dt>
          <dd className="font-medium text-ink">{provider.city}</dd>
        </div>
        {provider.yearsExperience > 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-soft">Experience</dt>
            <dd className="font-medium text-ink">{provider.yearsExperience} yrs</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Rating</dt>
          <dd className="font-medium text-ink">
            {provider.rating === null
              ? 'No reviews yet'
              : `${provider.rating.toFixed(1)} (${provider.reviewCount})`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Live review panel mirroring what will be sent. */
function ReviewSummary({
  provider,
  values,
  services,
}: {
  provider: PublicProviderProfile;
  values: BookingFormValues;
  services: PublicProviderProfile['services'];
}) {
  const service = services.find((s) => s.id === values.serviceId);
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink">Review your request</h3>
      <dl className="mt-3 space-y-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Provider</dt>
          <dd className="text-right font-medium text-ink">{provider.businessName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Service</dt>
          <dd className="text-right font-medium text-ink">
            {service?.name ?? <span className="text-ink-soft">Not selected</span>}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Date</dt>
          <dd className="text-right font-medium text-ink">
            {values.date || <span className="text-ink-soft">Not selected</span>}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Time</dt>
          <dd className="text-right font-medium text-ink">
            {values.time || <span className="text-ink-soft">Not selected</span>}
          </dd>
        </div>
        {service && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Indicative price</dt>
            <dd className="text-right font-medium text-ink">
              {formatPrice(service.priceFrom) ?? '-'}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
        Price shown is the provider&rsquo;s current starting rate. The final price and duration
        are confirmed by the provider when they accept your request.
      </p>
    </div>
  );
}

/**
 * The customer booking form.
 *
 * CONTRACT DISCIPLINE (ADR-024):
 *  - Sends only providerId, serviceId, date, time, problemDescription, address
 *    and (when non-empty) notes. There is no way for this component to send a
 *    customerId or a price: the customer comes from the session and the price
 *    is snapshotted server-side.
 *  - `provider.id` comes from the route via the page, and the service may only
 *    be one of `provider.services` (the picker renders nothing else), so a
 *    mismatched provider/service pair cannot be constructed in the UI.
 *  - Client validation is convenience only. The server revalidates everything.
 */
export default function BookingForm({
  provider,
  onCreated,
}: {
  provider: PublicProviderProfile;
  onCreated: (booking: Booking) => void;
}) {
  const [values, setValues] = useState<BookingFormValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasServices = provider.services.length > 0;
  const services = provider.services;

  function update<K extends keyof BookingFormValues>(key: K, value: BookingFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear the error as soon as the customer starts fixing the field.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guard against a double submit from a double-click or an Enter keypress
    // landing twice before React flushes the disabled state.
    if (submitting) return;

    const found = validateBooking(values, { hasServices });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first problem so keyboard users are not stranded.
      const first = document.getElementById(`booking-${Object.keys(found)[0]}`);
      first?.focus();
      return;
    }

    // Convert the visitor's local selection to the UTC pair the API expects.
    const slot = localSlotToUtc(values.date, values.time);
    if (!slot) {
      setErrors({ date: 'Please choose a valid date and time.' });
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const booking = await createBooking({
        providerId: provider.id,
        serviceId: values.serviceId,
        date: slot.date,
        time: slot.time,
        problemDescription: values.problemDescription.trim(),
        address: values.address.trim(),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
      });
      onCreated(booking);
    } catch (error) {
      setFormError(explain(error, 'create'));
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-8">
      {/* Mobile/tablet: the context panels read as a summary above the form. */}
      <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-24">
        <ProviderSummary provider={provider} />
        <ReviewSummary provider={provider} values={values} services={services} />
      </aside>

      <form onSubmit={handleSubmit} noValidate className="card order-2 p-5 sm:p-6 lg:order-1">
        <h2 className="font-display text-lg font-bold text-ink">Request a service</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Tell the provider what you need. They will review and confirm your request.
        </p>

        {formError && (
          <div className="mt-4">
            <Alert>{formError}</Alert>
          </div>
        )}

        <div className="mt-5 space-y-5">
          {/* Service ---------------------------------------------------- */}
          <div>
            <p className="block text-sm font-semibold text-ink">
              Service
              <span className="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            </p>
            <div className="mt-1.5">
              <ServicePicker
                name="serviceId"
                services={services}
                value={values.serviceId}
                onChange={(id) => update('serviceId', id)}
                disabled={submitting}
              />
            </div>
            {errors.serviceId && (
              <p id="booking-serviceId-error" className="mt-1.5 text-xs text-red-600" role="alert">
                {errors.serviceId}
              </p>
            )}
          </div>

          {/* Problem --------------------------------------------------- */}
          <Field
            id="booking-problemDescription"
            label="Describe the problem"
            required
            error={errors.problemDescription}
            hint={`${PROBLEM_MIN}-${PROBLEM_MAX} characters. The more detail, the better the provider can prepare.`}
          >
            {(aria) => (
              <textarea
                {...aria}
                rows={4}
                value={values.problemDescription}
                onChange={(e) => update('problemDescription', e.target.value)}
                disabled={submitting}
                maxLength={PROBLEM_MAX}
                placeholder="e.g. Kitchen tap has been dripping constantly since Monday and the handle is now stiff."
                className={`${inputClass} ${touchClass} resize-y`}
              />
            )}
          </Field>

          {/* Date + time ----------------------------------------------- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="booking-date"
              label="Preferred date"
              required
              error={errors.date}
              hint={`Up to ${MAX_ADVANCE_DAYS} days ahead`}
            >
              {(aria) => (
                <input
                  {...aria}
                  type="date"
                  value={values.date}
                  onChange={(e) => update('date', e.target.value)}
                  disabled={submitting}
                  min={todayLocal()}
                  max={maxBookableDate()}
                  className={`${inputClass} ${touchClass}`}
                />
              )}
            </Field>

            <Field
              id="booking-time"
              label="Preferred time"
              required
              error={errors.time}
              hint="Your local time"
            >
              {(aria) => (
                <input
                  {...aria}
                  type="time"
                  value={values.time}
                  onChange={(e) => update('time', e.target.value)}
                  disabled={submitting}
                  className={`${inputClass} ${touchClass}`}
                />
              )}
            </Field>
          </div>

          {/* Address --------------------------------------------------- */}
          <Field
            id="booking-address"
            label="Service address"
            required
            error={errors.address}
            hint="Where should the provider go? Only shared with the provider you book."
          >
            {(aria) => (
              <input
                {...aria}
                type="text"
                value={values.address}
                onChange={(e) => update('address', e.target.value)}
                disabled={submitting}
                maxLength={ADDRESS_MAX}
                autoComplete="street-address"
                placeholder="e.g. 42 Maple Street, Apt 3B"
                className={`${inputClass} ${touchClass}`}
              />
            )}
          </Field>

          {/* Notes ----------------------------------------------------- */}
          <Field
            id="booking-notes"
            label="Notes"
            error={errors.notes}
            hint="Access details, parking, pets, or anything else useful."
          >
            {(aria) => (
              <textarea
                {...aria}
                rows={3}
                value={values.notes}
                onChange={(e) => update('notes', e.target.value)}
                disabled={submitting}
                maxLength={NOTES_MAX}
                placeholder="e.g. Buzzer is broken - please call on arrival."
                className={`${inputClass} resize-y`}
              />
            )}
          </Field>
        </div>

        <button
          type="submit"
          disabled={submitting || !hasServices}
          aria-busy={submitting}
          className="btn btn-primary mt-6 w-full px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Submitting booking...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden="true" />
              Request booking
            </>
          )}
        </button>

        <p className="mt-3 text-center text-xs text-ink-soft">
          You will not be charged now. The provider confirms the final price with you.
        </p>
      </form>
    </div>
  );
}
