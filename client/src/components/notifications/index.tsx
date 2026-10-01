import { Bell, CheckCheck } from 'lucide-react';
import { unreadBadgeLabel } from '../../lib/booking-utils';

/** The bell with its unread pill. */
export function NotificationBell({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label = unreadBadgeLabel(count);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={
        label ? `Notifications, ${count} unread` : 'Notifications, none unread'
      }
      className="relative rounded-lg p-2 text-ink-soft transition-colors hover:bg-brand-50 hover:text-ink"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {label && (
        <span
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-4 text-white"
          aria-hidden="true"
        >
          {label}
        </span>
      )}
    </button>
  );
}

/** "Mark all as read" affordance, shown only when something is unread. */
export function MarkAllButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-60"
    >
      <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
      Mark all as read
    </button>
  );
}
