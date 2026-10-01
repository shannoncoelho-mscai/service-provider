import { AlertCircle, ArrowRight, BadgeCheck, Briefcase, Loader2, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice, initialsOf } from '../../lib/format';
import { searchProviders } from '../../lib/api';
import type { PublicProvider } from '../../types';
import RatingStars from '../RatingStars';
import Reveal from '../Reveal';
import SectionHeading from '../SectionHeading';

type State =
  | { status: 'loading' }
  | { status: 'ready'; providers: PublicProvider[] }
  | { status: 'error' };

function ProviderCard({ provider, index }: { provider: PublicProvider; index: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(provider.profileImageUrl) && !imageFailed;

  return (
    <Reveal delay={index * 80}>
      <article className="card group flex h-full flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift">
        <div className="relative h-28 overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-accent-50">
          {showImage ? (
            <img
              src={provider.profileImageUrl ?? undefined}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-display text-2xl font-bold text-brand-300">
              {initialsOf(provider.businessName)}
            </div>
          )}

          {provider.isAvailable && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Available
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-5">
          <h3 className="flex items-start gap-1.5 font-semibold leading-snug text-ink">
            {provider.businessName}
            <BadgeCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-brand-500"
              aria-label="Verified provider"
            />
          </h3>

          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {provider.city}
            {provider.serviceAreas.length > 0 && (
              <span className="text-ink-soft/70">+{provider.serviceAreas.length} areas</span>
            )}
          </p>

          <div className="mt-3">
            <RatingStars rating={provider.rating} reviewCount={provider.reviewCount} />
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-soft">
            {provider.description ?? 'Verified local professional.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {provider.categories.slice(0, 2).map((category) => (
              <span
                key={category.slug}
                className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
              >
                {category.name}
              </span>
            ))}
          </div>

          {/* Pinned to the bottom so cards align regardless of copy length. */}
          <div className="mt-auto flex items-end justify-between border-t border-line pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-soft">From</p>
              <p className="font-display text-lg font-bold text-ink">
                {formatPrice(provider.priceFrom) ?? '—'}
              </p>
            </div>
            {provider.yearsExperience > 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                {provider.yearsExperience} yrs
              </p>
            )}
          </div>
        </div>
      </article>
    </Reveal>
  );
}

function SkeletonCard() {
  return (
    <div className="card overflow-hidden" aria-hidden="true">
      <div className="h-28 animate-pulse bg-brand-50" />
      <div className="space-y-3 p-5">
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
        <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}


/**
 * Featured Providers — live data from the public search API.
 *
 * Only APPROVED providers can ever appear here: the server filters them out
 * before responding (ADR-021). This component adds no filtering of its own and
 * never displays contact details, because the API does not send them.
 */
export default function FeaturedProviders() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    searchProviders({ sort: 'rating', availability: true, pageSize: 3 })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', providers: data.providers });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="py-16 sm:py-20">
      <div className="shell">
        <Reveal>
          <SectionHeading
            eyebrow="Featured providers"
            title="Top-rated, verified and ready to book"
            description="Every professional here has been manually reviewed by our team and holds a current rating."
          />
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {state.status === 'loading' &&
            [0, 1, 2].map((index) => <SkeletonCard key={index} />)}

          {state.status === 'error' && (
            <div className="card col-span-full flex flex-col items-center gap-3 p-10 text-center">
              <AlertCircle className="h-8 w-8 text-accent-500" aria-hidden="true" />
              <p className="font-semibold text-ink">Could not load featured providers</p>
              <p className="max-w-sm text-sm text-ink-soft">
                The directory service is not responding. Start the API with{' '}
                <code className="rounded bg-brand-50 px-1 py-0.5 font-mono text-brand-700">
                  npm run dev:server
                </code>{' '}
                and refresh.
              </p>
            </div>
          )}

          {state.status === 'ready' && state.providers.length === 0 && (
            <div className="card col-span-full p-10 text-center">
              <p className="font-semibold text-ink">No verified providers yet</p>
              <p className="mt-2 text-sm text-ink-soft">
                Providers appear here as soon as an admin approves them.
              </p>
            </div>
          )}

          {state.status === 'ready' &&
            state.providers.map((provider, index) => (
              <ProviderCard key={provider.id} provider={provider} index={index} />
            ))}
        </div>

        {state.status === 'ready' && state.providers.length > 0 && (
          <Reveal delay={120} className="mt-10 text-center">
            <Link to="/providers" className="btn btn-ghost px-6 py-3">
              View all providers
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Reveal>
        )}

        {state.status === 'loading' && (
          <p className="mt-8 flex items-center justify-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading verified providers…
          </p>
        )}
      </div>
    </section>
  );
}
