import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Alert, inputClass, touchClass } from '../components/ui';

type Mode = 'login' | 'register';

function explain(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'That email and password combination is not correct.';
    if (err.status === 409) return 'An account with that email already exists.';
    if (err.status === 400) return 'Please check the details you entered and try again.';
  }
  return 'Something went wrong on our side. Please try again in a moment.';
}

/**
 * Sign in / create an account.
 *
 * The auth backend already exists (Step 004), so this posts to the real
 * endpoints — there is no client-side "pretend login". The token is stored by
 * `lib/auth.ts` and attached to later requests; the password is never kept.
 *
 * Booking needs a CUSTOMER account, so registration defaults to the customer
 * role. Provider self-registration is deliberately not offered here: the
 * provider onboarding area is a later phase, and offering it without the admin
 * approval workflow would be misleading.
 */
export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();

  const from = (location.state as { from?: string } | null)?.from ?? '/bookings';
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in and navigating here deliberately — go where they meant to go.
  if (user) {
    navigate(from, { replace: true });
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp({ email: email.trim(), password, fullName: fullName.trim(), role: 'CUSTOMER' });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(explain(err));
      setBusy(false);
    }
  }

  return (
    <div className="shell py-12">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-3xl font-bold text-ink">
          {mode === 'login' ? 'Sign in' : 'Create your account'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {mode === 'login'
            ? 'Welcome back. Sign in to manage your bookings.'
            : 'A customer account lets you request and track services.'}
        </p>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="card mt-5 space-y-4 p-6">
          {mode === 'register' && (
            <div>
              <label htmlFor="fullName" className="block text-sm font-semibold text-ink">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={busy}
                autoComplete="name"
                placeholder="Alex Morgan"
                className={`${inputClass} ${touchClass} mt-1.5`}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoComplete="email"
              placeholder="you@example.com"
              className={`${inputClass} ${touchClass} mt-1.5`}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              className={`${inputClass} ${touchClass} mt-1.5`}
            />
            {mode === 'register' && (
              <p className="mt-1 text-xs text-ink-soft">At least 8 characters.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="btn btn-primary w-full px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Please wait...
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create account
              </>
            )}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-soft">
          {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="font-semibold text-brand-700 underline-offset-2 hover:underline"
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
