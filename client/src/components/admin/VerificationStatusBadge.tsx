import { BadgeCheck, Clock, ShieldOff, ShieldX } from 'lucide-react';
import { VERIFICATION_LABEL } from '../../lib/admin-utils';
import type { VerificationStatus } from '../../types';

/**
 * Verification-state badge.
 *
 * Status is carried by an ICON and a TEXT label, never by colour alone
 * (WCAG 1.4.1) — a reviewer must be able to tell "awaiting" from "approved"
 * without relying on hue. The tones reuse the existing brand tokens so the
 * admin area looks like the same product.
 */
const STYLES: Record<VerificationStatus, { className: string; Icon: typeof Clock }> = {
  PENDING: { className: 'bg-accent-50 text-accent-600 border-accent-100', Icon: Clock },
  APPROVED: { className: 'bg-emerald-50 text-emerald-700 border-emerald-100', Icon: BadgeCheck },
  REJECTED: { className: 'bg-red-50 text-red-700 border-red-100', Icon: ShieldX },
  SUSPENDED: { className: 'bg-slate-100 text-slate-700 border-slate-200', Icon: ShieldOff },
};

export default function VerificationStatusBadge({ status }: { status: VerificationStatus }) {
  const { className, Icon } = STYLES[status] ?? STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {VERIFICATION_LABEL[status] ?? status}
    </span>
  );
}
