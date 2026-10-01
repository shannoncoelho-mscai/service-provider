import { ArrowLeft, CalendarDays, SearchX, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getProviderProfile } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import type { Booking, PublicProviderProfile } from '../types';
import BookingConfirmation from '../components/booking/BookingConfirmation';
import BookingForm from '../components/booking/BookingForm';
import { ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; provider: PublicProviderProfile }
  | { status: 'notFound' }
  | { status: 'error' };

/**
 * Sign-in prompt for an anonymous visitor.
 *
 * The booking page, not the provider profile, is where this is decided. That
 * way the CTA on the profile can be a single honest link for everyone, and no
 * unauthenticated POST is ever attempted — a 401 after the fact is a much worse
 * experience than being asked to sign in first.
 */
function SignInPrompt({ providerName }: { providerName: string | null }) {
  const location = window.location.pathname;
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
        <CalendarDays className="h-6 w-6 text-brand-500" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">Sign in to book</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        You need a ServiceConnect account to request a service
        {providerName ? (
          <>
            {' '}
            from <span className="font-medium text-ink">{providerName}</span>
          </>
        ) : null}
        . It takes a moment to create one.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          to="/login"
          state={{ from: location }}
          className="btn btn-primary flex-1 px-4 py-3 text-sm"
        >
          Sign in
        </Link>
        <Link
          to="/login"
          state={{ from: location, mode: 'register' }}
          className="btn btn-ghost flex-1 px-4 py-3 text-sm"
        >
          Create account
        </Link>
      </div>
      <Link
        to="/providers"
        className="mt-5 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Browse other providers
      </Link>
    </div>
  );
}

/** Shown to a signed-in PROVIDER or ADMIN trying to use the customer flow. */
function WrongRoleNotice({ role }: { role: string }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
        <ShieldAlert className="h-6 w-6 text-amber-500" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">Customer accounts only</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        You are signed in as a {role.toLowerCase()}. Booking is a customer feature, so this form is
        not available on your account.
      </p>
      <Link
        to="/"
        className="btn btn-primary mt-6 w-full px-4 py-3 text-sm"
      >
        Back to home
      </Link>
    </div>
  );
}

/**
 * Customer booking flow — `/providers/:id/book` (ADR-024).
 *
 * Route structure:
 *   /providers/:id/book   this page — pick a service, describe the problem, request
 *   /bookings             the customer's own bookings
 *   /bookings/:id         one booking
 *
 * SECURITY: the provider id in the URL is only ever used to FETCH the public
 * profile. Everything the form submits comes from that fetched profile, so a
 * hand-edited URL cannot smuggle in a different provider. The role check below
 * is UX only; the backend re-reads the role from the database and re-validates
 * ownership on every request.
 */
export default function BookingPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  // A created booking swaps the page to the confirmation state; it is never
  // submitted twice, and the form is replaced rather than reset.
  const [created, setCreated] = useState<Booking | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setCreated(null);

    getProviderProfile(id)
      .then((provider) => !cancelled && setState({ status: 'ready', provider }))
      .catch((error: unknown) => {
        if (cancelled) return;
        // 404 = no public profile (unapproved or unknown) — the same wording the
        // profile page uses, so it does not leak whether an id exists.
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

  // The provider must load before we can name it in the sign-in prompt, so the
  // anonymous case renders after the fetch rather than flashing a blank shell.
  if (state.status === 'loading') return <LoadingState label="Loading provider…" />;

  if (state.status === 'notFound') {
    return (
      <div className="shell py-16">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
            <SearchX className="h-6 w-6 text-brand-500" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">Provider not available</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This provider is not accepting bookings right now.
          </p>
          <Link to="/providers" className="btn btn-primary mt-6 px-4 py-3 text-sm">
            Find another provider
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-16">
        <ErrorState
          title="Could not load this provider"
          message="We could not load the provider details. Please check your connection and try again."
        />
      </div>
    );
  }

  const { provider } = state;

  // 1. Signed out → prompt. No POST is attempted without a session.
  if (!user) {
    return (
      <div className="shell py-12">
        <SignInPrompt providerName={provider.businessName} />
      </div>
    );
  }

  // 2. Signed in as a provider/admin → explain, do not offer the form.
  if (user.role !== 'CUSTOMER') {
    return (
      <div className="shell py-12">
        <WrongRoleNotice role={user.role} />
      </div>
    );
  }

  // 3. Created → confirmation replaces the form entirely.
  if (created) {
    return (
      <div className="shell py-10">
        <div className="mx-auto max-w-2xl">
          <BookingConfirmation booking={created} providerId={provider.id} />
        </div>
      </div>
    );
  }

  return (
    <div className="shell py-8">
      <Link
        to={`/providers/${provider.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {provider.businessName}
      </Link>

      {/* The form owns its two-column layout: context panels above the form on
          mobile/tablet, beside it on desktop. */}
      <div className="mt-4">
        <BookingForm provider={provider} onCreated={setCreated} />
      </div>
    </div>
  );
}

