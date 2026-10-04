import { Clock } from 'lucide-react';
import { formatPrice } from '../../lib/format';
import type { PublicService } from '../../types';

function durationLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function priceLabel(service: PublicService): string {
  const from = formatPrice(service.priceFrom) ?? '—';
  const to = formatPrice(service.priceTo);
  return to && to !== from ? `${from} – ${to}` : from;
}

/** The provider's public service menu, with price and duration. */
export default function ServiceList({ services }: { services: PublicService[] }) {
  if (services.length === 0) {
    return (
      <p className="card p-6 text-center text-sm text-ink-soft">
        This provider has no active services listed right now.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-3">
      {services.map((service) => {
        const duration = durationLabel(service.durationMinutes);
        return (
          <li
            key={service.id}
            className="card p-5 transition-colors hover:border-brand-200"
          >
            {/* Two-column on desktop: description left, price right. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{service.name}</h3>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    {service.category.name}
                  </span>
                </div>
                {service.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                    {service.description}
                  </p>
                )}
                {duration && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-ink-soft">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    About {duration}
                  </p>
                )}
              </div>

              <div className="shrink-0 sm:text-right">
                <p className="text-xs uppercase tracking-wide text-ink-soft">Price</p>
                <p className="font-display text-lg font-bold text-ink">{priceLabel(service)}</p>
              </div>
            </div>

            {/*
              Service photos (Phase 21). Rendered ONLY when the provider uploaded
              any — a service with no photos keeps exactly the layout it had
              before this feature, so photos stay genuinely optional rather than
              becoming an expected field. The strip sits below the two-column
              block so the price is never squeezed beside it.

              These are NOT the provider's business gallery: those appear higher
              up the page and show who the business is, these show what this
              particular job looks like.
            */}
            {service.images.length > 0 && (
              <ul
                className="mt-4 flex gap-3 overflow-x-auto pb-1"
                aria-label={`Photos of ${service.name}`}
              >
                {service.images.map((image) => (
                  <li key={image.url} className="shrink-0">
                    <img
                      src={image.url}
                      alt={image.altText ?? `${service.name} by this provider`}
                      loading="lazy"
                      className="h-24 w-32 rounded-xl border border-line bg-brand-50 object-cover sm:h-28 sm:w-40"
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
