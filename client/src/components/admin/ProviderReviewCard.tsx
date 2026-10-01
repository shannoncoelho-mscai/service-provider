import { Briefcase, CalendarDays, MapPin, Phone, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatSubmitted, type AdminProviderView } from '../../lib/admin-utils';
import type { AdminDecision } from '../../types';
import DecisionButtons from './DecisionButtons';
import VerificationStatusBadge from './VerificationStatusBadge';

function Line({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
      <div className="min-w-0">
        <span className="sr-only">{label}: </span>
        <span className="break-words text-ink">{children}</span>
      </div>
    </div>
  );
}

/**
 * A provider awaiting review, in the dashboard queue.
 *
 * DATA: renders ONLY fields from `AdminProviderView`. The component never sees
 * the raw `AdminProviderDetail`, so it cannot render `verifiedBy` (an admin's
 * user id) or `userId` even by accident — the allow-list is enforced upstream
 * by `adminProviderView`.
 *
 * Decisions are delegated to `DecisionButtons`, which is the single place that
 * decides which actions a status allows.
 */
export default function ProviderReviewCard({
  provider,
  onDecide,
  busy,
}: {
  provider: AdminProviderView;
  onDecide: (decision: AdminDecision) => void;
  busy?: AdminDecision | null;
}) {
  return (
    <article className="card flex flex-col p-5 transition-shadow hover:shadow-lift">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <Briefcase className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            {/* break-words: a long business name must wrap, not overflow. */}
            <span className="break-words">{provider.businessName}</span>
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{provider.ownerName}</span>
          </p>
        </div>
        <VerificationStatusBadge status={provider.verificationStatus} />
      </div>

      {provider.description && (
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap break-words text-sm text-ink-soft">
          {provider.description}
        </p>
      )}

      <dl className="mt-4 space-y-2 border-t border-line pt-4">
        <Line icon={MapPin} label="Location">
          {provider.city}
          {provider.serviceAreas.length > 0 && ` · ${provider.serviceAreas.join(', ')}`}
        </Line>
        {provider.phone && (
          <Line icon={Phone} label="Contact number">
            {provider.phone}
          </Line>
        )}
        {provider.yearsExperience > 0 && (
          <Line icon={Briefcase} label="Experience">
            {provider.yearsExperience} {provider.yearsExperience === 1 ? 'year' : 'years'}
          </Line>
        )}
        <Line icon={CalendarDays} label="Submitted">
          {formatSubmitted(provider.createdAt)}
        </Line>
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {/* The id comes from the server's response and is used only as a route
            parameter — it is never rendered as visible text. */}
        <Link
          to={`/admin/providers/${provider.id}`}
          className="inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
        >
          Review details
        </Link>
        <DecisionButtons
          status={provider.verificationStatus}
          onDecide={onDecide}
          busy={busy}
          size="sm"
        />
      </div>
    </article>
  );
}
