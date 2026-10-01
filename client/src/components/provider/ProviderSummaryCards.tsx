import { CheckCircle2, Clock, Inbox, PlayCircle, Ticket, XCircle } from 'lucide-react';
import type { ProviderSummary } from '../../lib/booking-utils';

/**
 * One provider queue count.
 *
 * The number is paired with a text label (and an `sr-only` repeat) so the figure
 * is never conveyed by colour or icon alone.
 */
function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Clock;
  tone: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {label}
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">
            {value}
            <span className="sr-only"> {label.toLowerCase()}</span>
          </p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/**
 * The provider's headline numbers, all derived from the single
 * `GET /api/provider/bookings` response. Nothing here hides when a count is
 * zero — a provider with no pending requests should be able to see that at a
 * glance, so these cards render even at zero (unlike the customer dashboard's
 * all-zero grid, which would read as a failure on a first-run account).
 */
export default function ProviderSummaryCards({ summary }: { summary: ProviderSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Stat
        label="Pending requests"
        value={summary.pending}
        icon={Inbox}
        tone="bg-accent-50 text-accent-600"
      />
      <Stat
        label="Accepted"
        value={summary.accepted}
        icon={CheckCircle2}
        tone="bg-brand-50 text-brand-600"
      />
      <Stat
        label="In progress"
        value={summary.inProgress}
        icon={PlayCircle}
        tone="bg-brand-100 text-brand-700"
      />
      <Stat
        label="Completed"
        value={summary.completed}
        icon={CheckCircle2}
        tone="bg-emerald-50 text-emerald-600"
      />
      <Stat
        label="Rejected"
        value={summary.rejected}
        icon={XCircle}
        tone="bg-red-50 text-red-500"
      />
      <Stat
        label="Cancelled by customer"
        value={summary.cancelled}
        icon={XCircle}
        tone="bg-slate-100 text-slate-500"
      />
      <Stat
        label="Total bookings"
        value={summary.total}
        icon={Ticket}
        tone="bg-slate-100 text-slate-500"
      />
      {/* Balances the 7-item grid to 8 so the final row is not left ragged. */}
      <div aria-hidden="true" className="hidden lg:block" />
    </div>
  );
}
