import { AlertTriangle, BadgeCheck, Clock, ShieldOff } from 'lucide-react';
import type { VerificationStatus } from '../../types';

/**
 * Verification-state banner (ADR-026).
 *
 * IMPORTANT — no invented reasons. The API deliberately does not expose the
 * admin's rejection or suspension rationale to the provider (see
 * `ProviderProfileDto`), so this component states only the fact and points at
 * support. Inventing a plausible-sounding reason would be telling the provider
 * something the system does not actually know.
 */
const COPY: Record<
  VerificationStatus,
  { Icon: typeof Clock; tone: string; title: string; body: string }
> = {
  PENDING: {
    Icon: Clock,
    tone: 'border-accent-100 bg-accent-50 text-accent-600',
    title: 'Awaiting verification',
    body: 'Your provider profile is pending administrator verification. You will appear in public listings after approval. Booking requests will start appearing here once you are approved.',
  },
  APPROVED: {
    Icon: BadgeCheck,
    tone: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    title: 'Profile verified',
    body: 'Your profile is public and customers can book your services.',
  },
  REJECTED: {
    Icon: ShieldOff,
    tone: 'border-red-100 bg-red-50 text-red-700',
    title: 'Profile not approved',
    body: 'Your provider profile was not approved, so it is not visible to customers and cannot receive bookings. Please contact support if you believe this is a mistake.',
  },
  SUSPENDED: {
    Icon: AlertTriangle,
    tone: 'border-red-100 bg-red-50 text-red-700',
    title: 'Account suspended',
    body: 'Your provider account is suspended. Your profile is hidden from customers and no new bookings can be accepted. Please contact support for details.',
  },
};

/**
 * Shown above the queue for every verification state, so a provider always
 * knows where they stand. APPROVED still gets a short positive banner.
 */
export default function VerificationNotice({ status }: { status: VerificationStatus }) {
  const { Icon, tone, title, body } = COPY[status] ?? COPY.PENDING;
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-2xl border p-4 ${tone}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{body}</p>
      </div>
    </div>
  );
}
