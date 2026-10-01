import { Mail, ShieldCheck, UserRound } from 'lucide-react';
import { accountView } from '../../lib/booking-utils';
import type { CurrentUser } from '../../types';

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/**
 * A small account summary (ADR-025).
 *
 * STRICT ALLOW-LIST: this renders only the four fields in `accountView()`.
 * The `CurrentUser` object the app holds also contains `id` and `phone`, and
 * neither is read here — so a customer id cannot reach the DOM even by
 * accident. Nothing sensitive is available to leak: `/api/auth/me` returns a
 * `PublicUser` with no password hash, no session id and no token, so the
 * frontend never even holds those values to display.
 *
 * There is no profile-edit form. Editing an account is a separate capability
 * that does not exist yet, and inventing one here would be scope creep.
 */
export default function AccountCard({ user }: { user: CurrentUser }) {
  const view = accountView(user);

  return (
    <section aria-labelledby="account-heading" className="card p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50">
          <UserRound className="h-4 w-4 text-brand-600" aria-hidden="true" />
        </span>
        <h2 id="account-heading" className="text-sm font-semibold text-ink">
          Your account
        </h2>
      </div>

      <dl className="mt-3 divide-y divide-line">
        <Row icon={UserRound} label="Name">
          {view.name}
        </Row>
        <Row icon={Mail} label="Email">
          {view.email}
        </Row>
        <Row icon={ShieldCheck} label="Account type">
          {/* Spelled out so it reads as "Customer", not a raw enum constant. */}
          {view.role === 'CUSTOMER' ? 'Customer' : view.role}
        </Row>
        {view.memberSince && <Row icon={ShieldCheck} label="Member since">{view.memberSince}</Row>}
      </dl>
    </section>
  );
}
