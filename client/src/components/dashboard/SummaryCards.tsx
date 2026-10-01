import { CalendarCheck, CheckCircle2, Clock, Ticket } from 'lucide-react';
import type { DashboardSummary } from '../../lib/booking-utils';

/**
 * One headline number.
 *
 * The value is rendered as TEXT, not only as a large numeral, and the label
 * says what the number counts ("awaiting a reply", "all time"). A bare "12"
 * with an icon would be ambiguous and would fail anyone who cannot see the icon.
 */
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Clock;
  tone: 'brand' | 'amber' | 'green' | 'slate';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-accent-50 text-accent-600',
    green: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-500',
  } as const;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          {/* Announced as a phrase so a screen reader does not read four
              disconnected numbers in a row. */}
          <p className="mt-1.5 font-display text-3xl font-bold text-ink">
            {value}
            <span className="sr-only"> {label.toLowerCase()}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">{hint}</p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/**
 * The four dashboard numbers, all derived from the one bookings response.
 * Renders nothing when the customer has no bookings — an all-zero grid reads
 * as failure, so the empty state speaks instead.
 */
export default function SummaryCards({ summary }: { summary: DashboardSummary }) {
  if (summary.total === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        label="Upcoming"
        value={summary.upcoming}
        hint="Awaiting or confirmed"
        icon={CalendarCheck}
        tone="brand"
      />
      <StatCard
        label="Pending"
        value={summary.pending}
        hint="Awaiting a reply"
        icon={Clock}
        tone="amber"
      />
      <StatCard
        label="Completed"
        value={summary.completed}
        hint="Jobs finished"
        icon={CheckCircle2}
        tone="green"
      />
      <StatCard
        label="Total bookings"
        value={summary.total}
        hint="All time"
        icon={Ticket}
        tone="slate"
      />
    </div>
  );
}
