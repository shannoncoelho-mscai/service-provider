import { BadgeCheck, Briefcase, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice, initialsOf } from '../../lib/format';
import type { PublicProvider } from '../../types';
import RatingStars from '../RatingStars';

/**
 * Directory provider card.
 *
 * Shows only fields the public API returns — there is no contact detail here
 * because the server never sends it (ADR-021). "View Profile" and "Book
 * Service" are rendered but disabled: both need backend features that belong to
 * later phases, and a dead link or a fake booking flow would be worse than an
 * honest disabled control.
 */
export default function ProviderCard({ provider }: { provider: PublicProvider }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(provider.profileImageUrl) && !imageFailed;
  const price = formatPrice(provider.priceFrom);

  return (
    <article className="card group flex h-full flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift">
      {/* Image ------------------------------------------------------- */}
      <div className="relative h-36 overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-accent-50">
        {showImage ? (
          <img
            src={provider.profileImageUrl ?? undefined}
            alt={`${provider.businessName} storefront`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-brand-300">
            {initialsOf(provider.businessName)}
          </div>
        )}

        {provider.isAvailable ? (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Available now
          </span>
        ) : (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink-soft shadow-soft">
            Unavailable
          </span>
        )}

        {price && (
          <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-soft">
            from {price}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        {/* Name + verified badge */}
        <h2 className="flex items-start gap-1.5 font-semibold leading-snug text-ink">
          <span>{provider.businessName}</span>
          <BadgeCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-brand-500"
            aria-label="Verified provider"
          />
        </h2>

        {/* Location */}
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ink-soft">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {provider.city}
          {provider.serviceAreas.length > 0 && (
            <span className="truncate text-ink-soft/70">+{provider.serviceAreas.length} areas</span>
          )}
        </p>

        {/* Rating + review count */}
        <div className="mt-2.5">
          <RatingStars rating={provider.rating} reviewCount={provider.reviewCount} />
        </div>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-soft">
          {provider.description ?? 'Verified local professional.'}
        </p>

        {/* Categories */}
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {provider.categories.length === 0 && (
            <span className="text-xs text-ink-soft">No categories listed</span>
          )}
          {provider.categories.slice(0, 3).map((category) => (
            <span
              key={category.slug}
              className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
            >
              {category.name}
            </span>
          ))}
          {provider.categories.length > 3 && (
            <span className="px-1 py-1 text-xs text-ink-soft">+{provider.categories.length - 3}</span>
          )}
        </div>

        {/* Footer: experience + actions */}
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between border-t border-line pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-soft">Starting at</p>
              <p className="font-display text-lg font-bold text-ink">{price ?? '—'}</p>
            </div>
            {provider.yearsExperience > 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                {provider.yearsExperience} yrs exp.
              </p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link
              to={`/providers/${provider.id}`}
              className="btn btn-ghost px-3 py-2 text-xs"
            >
              View Profile
            </Link>
            <button
              type="button"
              disabled
              title="Booking arrives in a later phase"
              className="btn btn-primary cursor-not-allowed px-3 py-2 text-xs opacity-60"
            >
              Book Service
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Loading placeholder matching the card's shape, to avoid layout shift. */
export function ProviderCardSkeleton() {
  return (
    <div className="card overflow-hidden" aria-hidden="true">
      <div className="h-36 animate-pulse bg-brand-50" />
      <div className="space-y-3 p-5">
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
        <div className="h-16 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-9 w-full animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}
