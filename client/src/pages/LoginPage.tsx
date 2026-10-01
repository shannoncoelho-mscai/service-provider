import { Loader2, LogIn, Store, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { homeForRole, useAuth } from '../lib/auth-context';
import { Alert, Field, inputClass, touchClass } from '../components/ui';

type Mode = 'login' | 'register';
type Role = 'CUSTOMER' | 'PROVIDER';

/**
 * Goa service areas offered as quick-add chips. Purely a convenience: the
 * field is free text, because a provider may well serve a village that is not
 * on this list, and refusing to submit an unlisted area would be wrong.
 */
const SUGGESTED_AREAS = [
  'Panaji',
  'Mapusa',
  'Margao',
  'Ponda',
  'Porvorim',
  'Vasco da Gama',
];

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
 * The auth backend already exists, so this posts to the real endpoints — there
 * is no client-side "pretend login". The token is stored by `lib/auth.ts` and
 * attached to later requests; the password is never kept.
 *
 * Registration serves BOTH roles. A customer signs up to book; a provider signs
 * up to run a business and collect booking requests (Phase 18). The role chosen
 * here only decides what the SERVER is asked to create — the destination after
 * sign-in always comes from `homeForRole(user.role)`, where `user.role` is the
 * value the server returned, never the form selection. A provider registering
 * here lands on /provider/dashboard as PENDING and cannot appear publicly until
 * an admin approves them.
 */
export default function LoginPage({
  initialMode = 'login',
  initialRole = 'CUSTOMER',
}: {
  /** `/register` opens this page already on the create-account tab. */
  initialMode?: Mode;
  /** Pre-selects the account type — "Join as provider" uses PROVIDER. */
  initialRole?: Role;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();

  const from = (location.state as { from?: string } | null)?.from ?? '/bookings';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessCity, setBusinessCity] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [areaDraft, setAreaDraft] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in and navigating here deliberately — go where they meant to
  // go, unless they were sent here by the router with no intent, in which case
  // send them to the home for their role.
  if (user) {
    navigate(location.state ? from : homeForRole(user.role), { replace: true });
    return null;
  }

  function addArea(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Case-insensitive dedupe so "Panaji" and "panaji" cannot both be added.
    if (areas.some((area) => area.toLowerCase() === trimmed.toLowerCase())) return;
    setAreas((current) => [...current, trimmed]);
    setAreaDraft('');
  }

  function removeArea(value: string) {
    setAreas((current) => current.filter((area) => area !== value));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    // Commit a typed-but-unpressed service area before validating, so the last
    // chip is not silently dropped by the Enter key.
    if (mode === 'register' && role === 'PROVIDER') addArea(areaDraft);

    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        const trimmedPhone = phone.trim();
        const years = Number(yearsExperience);
        await signUp({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          ...(trimmedPhone ? { phone: trimmedPhone } : {}),
          role,
          // Only ever attach provider details for a PROVIDER: the server
          // rejects them on a customer registration.
          ...(role === 'PROVIDER'
            ? {
                provider: {
                  businessName: businessName.trim(),
                  city: businessCity.trim(),
                  ...(businessDescription.trim() ? { description: businessDescription.trim() } : {}),
                  ...(trimmedPhone ? { phone: trimmedPhone } : {}),
                  ...(areas.length > 0 ? { serviceAreas: areas } : {}),
                  ...(Number.isFinite(years) && yearsExperience.trim() !== ''
                    ? { yearsExperience: years }
                    : {}),
                },
              }
            : {}),
        });
      }

      // Read the role back off the response the server just sent.
      navigate(
        (location.state as { from?: string } | null)?.from ?? homeForRole(role),
        { replace: true },
      );
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
            : role === 'PROVIDER'
              ? 'Create a provider account to list your services and receive booking requests. We verify every provider before you appear in search.'
              : 'A customer account lets you request and track services.'}
        </p>

        {/* Role choice — shown only while registering. A returning user has
            already picked their role when the account was made; it is decided by
            the server, not by anything on this screen. */}
        {mode === 'register' && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-ink">I want to join as</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Account type">
              {(
                [
                  { value: 'CUSTOMER' as Role, title: 'A customer', body: 'Book and track services' },
                  { value: 'PROVIDER' as Role, title: 'A service provider', body: 'List services and get bookings' },
                ]
              ).map((option) => {
                const selected = role === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRole(option.value)}
                    className={`rounded-xl border p-3.5 text-left transition-colors ${
                      selected
                        ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                        : 'border-line bg-surface hover:border-brand-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      {option.value === 'PROVIDER' && (
                        <Store className="h-4 w-4" aria-hidden="true" />
                      )}
                      {option.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{option.body}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

          {/* Contact number — shared by both roles. For a provider the server also
              copies it onto the business profile. */}
          {mode === 'register' && (
            <div>
              <label htmlFor="phone" className="block text-sm font-semibold text-ink">
                Contact number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
                autoComplete="tel"
                placeholder="+91 98220 12345"
                className={`${inputClass} ${touchClass} mt-1.5`}
              />
              <p className="mt-1 text-xs text-ink-soft">
                Optional. Used to contact you about bookings.
              </p>
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

          {/* ---- Provider business details ---------------------------------- */}
          {mode === 'register' && role === 'PROVIDER' && (
            <>
              <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
                <p className="text-sm font-semibold text-ink">Your business</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  An administrator reviews these details before your profile appears in public
                  search. You can add your services straight after signing up.
                </p>
              </div>

              <Field
                id="businessName"
                label="Business name"
                required
                hint="The name customers will see, e.g. Ganpati Aqua Plumbing."
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={busy}
                    placeholder="Ganpati Aqua Plumbing"
                    className={`${inputClass} ${touchClass} mt-1.5`}
                  />
                )}
              </Field>

              <Field id="businessCity" label="City" required hint="Where your business is based.">
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    required
                    value={businessCity}
                    onChange={(e) => setBusinessCity(e.target.value)}
                    disabled={busy}
                    placeholder="Panaji"
                    className={`${inputClass} ${touchClass} mt-1.5`}
                  />
                )}
              </Field>

              <Field
                id="businessDescription"
                label="Business description"
                hint="What you do, and what makes your work worth booking. Optional."
              >
                {(field) => (
                  <textarea
                    {...field}
                    value={businessDescription}
                    onChange={(e) => setBusinessDescription(e.target.value)}
                    disabled={busy}
                    maxLength={2000}
                    rows={3}
                    placeholder="Family-run plumbing business in Panaji, handling leaks, blockages and fittings since 2015."
                    className={`${inputClass} ${touchClass} mt-1.5 resize-y`}
                  />
                )}
              </Field>

              <Field
                id="yearsExperience"
                label="Years of experience"
                hint="Whole number. Optional, but it helps us verify your business."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    value={yearsExperience}
                    onChange={(e) => setYearsExperience(e.target.value)}
                    disabled={busy}
                    placeholder="5"
                    className={`${inputClass} ${touchClass} mt-1.5`}
                  />
                )}
              </Field>
              {/* Service areas: free text plus quick-add chips. Enter or comma
                  commits the typed value; blur does too, so a chip is never
                  silently lost by tabbing away. */}
              <div>
                <label htmlFor="serviceAreas" className="block text-sm font-semibold text-ink">
                  Service areas
                </label>
                <p className="mt-0.5 text-xs text-ink-soft">
                  Towns you are willing to travel to. Optional — you can add these later.
                </p>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="serviceAreas"
                    type="text"
                    value={areaDraft}
                    onChange={(e) => setAreaDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        // Stop Enter/comma from submitting the whole form.
                        e.preventDefault();
                        addArea(areaDraft);
                      }
                    }}
                    onBlur={() => addArea(areaDraft)}
                    disabled={busy}
                    placeholder="e.g. Mapusa"
                    className={`${inputClass} ${touchClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => addArea(areaDraft)}
                    disabled={busy || !areaDraft.trim()}
                    className="btn btn-ghost shrink-0 px-3.5 text-sm disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                {areas.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {areas.map((area) => (
                      <li key={area}>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                          {area}
                          <button
                            type="button"
                            onClick={() => removeArea(area)}
                            disabled={busy}
                            aria-label={`Remove ${area}`}
                            className="text-brand-700 hover:text-brand-900"
                          >
                            &times;
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUGGESTED_AREAS.filter(
                    (suggestion) =>
                      !areas.some((area) => area.toLowerCase() === suggestion.toLowerCase()),
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => addArea(suggestion)}
                      disabled={busy}
                      className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                    >
                      + {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

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
                {role === 'PROVIDER' ? 'Create provider account' : 'Create account'}
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
