import { AlertCircle, ArrowLeft, BadgeCheck, Briefcase, MapPin, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getProviderProfile } from '../lib/api';
import { formatPrice } from '../lib/format';
import type { PublicProviderProfile } from '../types';
import ImageGallery from '../components/providers/ImageGallery';
import ReviewList from '../components/providers/ReviewList';
import ServiceList from '../components/providers/ServiceList';
import RatingStars from '../components/RatingStars';

type State =
  | { status: 'loading' }
  | { status: 'ready'; provider: PublicProviderProfile }
  | { status: 'notFound' }
  | { status: 'error' };

/** Skeleton mirroring the two-column layout, avoiding a layout jump. */
function ProfileSkeleton() {
  return (
    <div className="shell py-8" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading provider profile…</p>
      <div className="h-40 animate-pulse rounded-b-2xl bg-brand-100 sm:h-56" aria-hidden="true" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="h-8 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="h-24 animate-pulse rounded bg-slate-100" />
          <div className="h-32 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-48 animate-pulse rounded bg-slate-100" aria-hidden="true" />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/providers"
      className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-brand-600"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to providers
    </Link>
  );
}

/**
 * Public provider profile (ADR-022).
 *
 * Renders whatever `GET /api/providers/:id` returns and nothing more. Only
 * APPROVED providers have a public profile — a pending, rejected or suspended
 * provider returns the same 404 as an unknown id, shown here as a plain
 * "not available" state. That wording is deliberate: it does not reveal
 * whether a provider exists but is unverified.
 */
export default function ProviderProfilePage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    getProviderProfile(id)
      .then((provider) => !cancelled && setState({ status: 'ready', provider }))
      .catch((error: unknown) => {
        if (cancelled) return;
        // 404 = no public profile (unapproved or unknown). Anything else is a
        // transport/server problem, which deserves a different message.
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') return <ProfileSkeleton />;

  if (state.status === 'notFound') {
    return (
      <div className="shell py-20 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
          <SearchX className="h-6 w-6 text-brand-500" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-ink">Profile not available</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          This provider does not have a public profile. Only providers that have completed our
          verification process are listed publicly.
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-20 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50">
          <AlertCircle className="h-6 w-6 text-accent-500" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-ink">Could not load this profile</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          The service is not responding right now. Check that the API is running, then try again.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <BackLink />
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-primary px-5 py-2.5 text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { provider } = state;
  const price = formatPrice(provider.priceFrom);

  return (
    <div>
      <ImageGallery images={provider.images} provider={provider} />

      <div className="shell pb-16 pt-6 sm:pt-8">
        <nav aria-label="Breadcrumb" className="mb-4">
          <BackLink />
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:gap-10">
          <div className="min-w-0">
            <div className="-mt-14 sm:-mt-16 lg:mt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="flex items-center gap-2 text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  {provider.businessName}
                  <BadgeCheck
                    className="h-5 w-5 shrink-0 text-brand-500 sm:h-6 sm:w-6"
                    aria-label="Verified provider"
                  />
                </h1>
                {provider.isAvailable ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    Available now
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-ink-soft">
                    Not currently available
                  </span>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-soft">
                <RatingStars rating={provider.rating} reviewCount={provider.reviewCount} size="md" />
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {provider.city}
                  {provider.serviceAreas.length > 0 && (
                    <span className="text-ink-soft/80">
                      &middot; serves {provider.serviceAreas.join(', ')}
                    </span>
                  )}
                </span>
                {provider.yearsExperience > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {provider.yearsExperience} years experience
                  </span>
                )}
              </div>

              {provider.categories.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {provider.categories.map((category) => (
                    <li key={category.slug}>
                      <Link
                        to={`/providers?category=${category.slug}`}
                        className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink">About</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {provider.description ?? 'This provider has not added a description yet.'}
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink">
                Services
                {provider.services.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-ink-soft">
                    {provider.services.length} listed
                  </span>
                )}
              </h2>
              <ServiceList services={provider.services} />
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink">
                Reviews
                {provider.reviewCount > 0 && (
                  <span className="ml-2 text-sm font-normal text-ink-soft">
                    {provider.reviewCount} total
                  </span>
                )}
              </h2>
              <ReviewList reviews={provider.reviews} totalCount={provider.reviewCount} />
            </section>
          </div>


          {/* Booking sidebar ----------------------------------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="card p-5">
              <p className="text-xs uppercase tracking-wide text-ink-soft">Services from</p>
              <p className="mt-0.5 font-display text-3xl font-bold text-ink">
                {price ?? 'Price on request'}
              </p>

              <dl className="mt-4 space-y-2.5 border-t border-line pt-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-soft">Availability</dt>
                  <dd className="font-medium text-ink">
                    {provider.isAvailable ? 'Available now' : 'Not currently'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-soft">Active services</dt>
                  <dd className="font-medium text-ink">{provider.activeServiceCount}</dd>
                </div>
                {provider.yearsExperience > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-soft">Experience</dt>
                    <dd className="font-medium text-ink">{provider.yearsExperience} yrs</dd>
                  </div>
                )}
                {provider.verifiedAt && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-soft">Verified</dt>
                    <dd className="font-medium text-ink">
                      {new Date(provider.verifiedAt).toLocaleDateString()}
                    </dd>
                  </div>
                )}
              </dl>

              {/* The booking CTA. It is a single honest link for EVERYONE —
                  the booking page decides whether to show a sign-in prompt, a
                  wrong-role notice, or the real form. Doing the check here
                  instead would mean three divergent code paths and no way to
                  keep them in sync. */}
              <Link
                to={`/providers/${provider.id}/book`}
                className="btn btn-primary mt-5 w-full px-4 py-3 text-sm"
              >
                Book a service
              </Link>
              <p className="mt-2 text-center text-xs text-ink-soft">
                You&rsquo;ll be asked to sign in if you&rsquo;re not already.
              </p>

              <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
                Contact details are shared through a booking request, never published publicly.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

