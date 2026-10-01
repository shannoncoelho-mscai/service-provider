import { Bell, CalendarClock, Star } from 'lucide-react';
import { relativeTime } from '../../lib/booking-utils';
import type { Notification } from '../../types';

/** Icon per notification type. Never the only signal — the title says it too. */
function Icon({ type }: { type: string }) {
  if (type === 'REVIEW_SUBMITTED') return <Star className="h-4 w-4" aria-hidden="true" />;
  if (type === 'BOOKING_CANCELLED') return <CalendarClock className="h-4 w-4" aria-hidden="true" />;
  return <Bell className="h-4 w-4" aria-hidden="true" />;
}

const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-accent-50 text-accent-600',
  red: 'bg-red-50 text-red-500',
  slate: 'bg-slate-100 text-slate-500',
} as const;

/**
 * One notification row.
 *
 * UNREAD IS NOT SHOWN BY COLOUR ALONE: an unread row gets a filled dot AND a
 * bold title AND an "Unread" screen-reader label. Read rows are muted and carry
 * an sr-only "Read", so the state is available without relying on a hue.
 */
export default function NotificationRow({
  notification,
  to,
  onSelect,
}: {
  notification: Notification;
  /** Where it navigates, or null for a row that should not be a link. */
  to: string | null;
  onSelect: (notification: Notification) => void;
}) {
  const unread = notification.readAt === null;
  const tone = TONES[
    (notification.type === 'BOOKING_ACCEPTED' || notification.type === 'BOOKING_COMPLETED'
      ? 'green'
      : notification.type === 'BOOKING_REJECTED'
        ? 'red'
        : notification.type === 'BOOKING_CANCELLED'
          ? 'slate'
          : notification.type === 'REVIEW_SUBMITTED'
            ? 'amber'
            : 'brand') as keyof typeof TONES
  ];

  const body = (
    <>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}
      >
        <Icon type={notification.type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {unread && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
          )}
          <span
            className={`truncate text-sm ${unread ? 'font-semibold text-ink' : 'font-medium text-ink-soft'}`}
          >
            {notification.title}
          </span>
          <span className="sr-only">{unread ? '(Unread)' : '(Read)'}</span>
        </span>
        <span className="mt-0.5 block line-clamp-2 text-xs text-ink-soft">
          {notification.message}
        </span>
        <span className="mt-1 block text-xs text-ink-soft/80">
          {relativeTime(notification.createdAt)}
        </span>
      </span>
    </>
  );

  const className =
    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ' +
    (unread ? 'bg-brand-50/40 hover:bg-brand-50' : 'hover:bg-canvas');

  if (!to) {
    return (
      <li>
        <button type="button" onClick={() => onSelect(notification)} className={className}>
          {body}
        </button>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={() => onSelect(notification)} className={className}>
        {body}
      </button>
    </li>
  );
}


