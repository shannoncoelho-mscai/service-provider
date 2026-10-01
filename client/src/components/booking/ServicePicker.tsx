import { Check, Clock, Wrench } from 'lucide-react';
import { formatPrice } from '../../lib/format';
import { formatDuration } from '../../lib/booking-utils';
import type { PublicService } from '../../types';

function priceLabel(service: PublicService): string {
  const from = formatPrice(service.priceFrom) ?? '—';
  const to = formatPrice(service.priceTo);
  return to && to !== from ? `${from} – ${to}` : from;
}

/**
 * Selectable service cards, implemented as a real radio group.
 *
 * Native `<input type="radio">` is used rather than clickable divs so keyboard
 * users get arrow-key navigation, screen readers announce the group, and the
 * form works without JavaScript focus tricks. The visible card is the label,
 * so there is no duplicate control for a screen reader to trip over.
 *
 * `services` come from the public provider profile, which only ever returns
 * ACTIVE services. The server re-checks that the service belongs to the
 * provider and is active, so a stale page cannot book a withdrawn service.
 */
export default function ServicePicker({
  services,
  value,
  onChange,
  name,
  disabled,
}: {
  services: PublicService[];
  value: string;
  onChange: (id: string) => void;
  name: string;
  disabled?: boolean;
}) {
  if (services.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-canvas p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
          <Wrench className="h-5 w-5 text-brand-400" aria-hidden="true" />
        </div>
        <p className="mt-3 font-semibold text-ink">No services available</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
          This provider has no active services listed, so a booking cannot be made right now.
          Please check back later or choose another provider.
        </p>
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Available services"
      className="grid gap-3 sm:grid-cols-2"
    >
      {services.map((service) => {
        const selected = value === service.id;
        const duration = formatDuration(service.durationMinutes);
        return (
          <label
            key={service.id}
            className={`relative flex cursor-pointer flex-col rounded-2xl border p-4 transition-all ${
              selected
                ? 'border-brand-500 bg-brand-50/60 shadow-lift ring-1 ring-brand-500'
                : 'border-line bg-surface hover:border-brand-300 hover:bg-brand-50/30'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={service.id}
              checked={selected}
              onChange={() => onChange(service.id)}
              disabled={disabled}
              className="sr-only"
            />

            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{service.name}</span>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {service.category.name}
                </span>
              </div>
              {/* Selection is marked by a check icon, not colour alone. */}
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  selected ? 'border-brand-600 bg-brand-600' : 'border-line bg-surface'
                }`}
              >
                {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </span>
            </div>

            {service.description && (
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                {service.description}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 pt-3 text-xs">
              <span className="font-display text-base font-bold text-ink">{priceLabel(service)}</span>
              {duration && (
                <span className="inline-flex items-center gap-1 text-ink-soft">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {duration}
                </span>
              )}
            </div>

            {selected && <span className="sr-only">Selected</span>}
          </label>
        );
      })}
    </div>
  );
}
