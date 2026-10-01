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
            className="card flex flex-col gap-3 p-5 transition-colors hover:border-brand-200 sm:flex-row sm:items-start sm:justify-between"
          >
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
          </li>
        );
      })}
    </ul>
  );
}
