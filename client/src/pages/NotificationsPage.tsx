import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { notificationRoute } from '../lib/booking-utils';
import type { Notification } from '../types';
import NotificationRow from '../components/notifications/NotificationRow';
import { ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; notifications: Notification[]; total: number }
  | { status: 'error' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
] as const;

/**
 * `/notifications` — the user's full notification history (ADR-029).
 *
 * Nothing here duplicates the bell: the panel is a peek at the most recent
 * handful, this is the place to read and filter them properly.
 *
 * NO POLLING. The list loads when the page is opened and when the filter
 * changes, which is what "refresh-on-navigation" means. An interval here would
 * re-fetch forever for a page most people open once.
 */
export default function NotificationsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    listNotifications({ pageSize: 50, unreadOnly: filter === 'unread' })
      .then((data) =>
        setState({
          status: 'ready',
          notifications: data.notifications ?? [],
          total: data.pagination?.total ?? 0,
        }),
      )
      .catch(() => setState({ status: 'error' }));
  }, [filter]);

  useEffect(load, [load, location.key]);

  // Signed out: no request at all — the API would only 401.
  if (!user) {
    return (
      <div className="shell py-12">
        <div className="card mx-auto max-w-md p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
            <Bell className="h-6 w-6 text-brand-500" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">Sign in to see notifications</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Notifications are private to your account, so you need to sign in first.
          </p>
          <Link
            to="/login"
            state={{ from: location.pathname }}
            className="btn btn-primary mt-6 w-full px-4 py-3 text-sm"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const markAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markAllNotificationsRead();
      load();
    } catch {
      // Swallowed deliberately: the list simply stays as it was. An error toast
      // for a failed "mark as read" would be more alarming than helpful.
    } finally {
      setBusy(false);
    }
  };

  const select = (notification: Notification) => {
    if (notification.readAt === null) {
      // Fire and forget: a failure to mark read must not block navigation.
      markNotificationRead(notification.id).catch(() => {});
    }
  };

  return (
    <div className="shell py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">Notifications</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Updates about your bookings and, if you are a provider, your queue.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn btn-ghost px-3.5 py-2.5 text-sm"
          aria-label="Refresh notifications"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex gap-1 rounded-xl bg-canvas p-1"
          role="tablist"
          aria-label="Filter notifications"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`min-h-9 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === option.value
                  ? 'bg-surface text-ink shadow-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {state.status === 'ready' && state.notifications.some((n) => n.readAt === null) && (
          <button
            type="button"
            onClick={markAll}
            disabled={busy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-60"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all as read
          </button>
        )}
      </div>

      <div className="mt-4">
        {state.status === 'loading' ? (
          <LoadingState label="Loading notifications..." />
        ) : state.status === 'error' ? (
          <ErrorState
            title="Could not load notifications"
            message="We could not reach the server. Please check your connection and try again."
            onRetry={load}
          />
        ) : state.notifications.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
              <Bell className="h-6 w-6 text-brand-400" aria-hidden="true" />
            </div>
            <h2 className="font-display text-lg font-bold text-ink">
              {filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            </h2>
            <p className="max-w-md text-sm text-ink-soft">
              {filter === 'unread'
                ? 'You are all caught up.'
                : 'Updates about your bookings will appear here.'}
            </p>
          </div>
        ) : (
          <>
            <ul className="card divide-y divide-line overflow-hidden">
              {state.notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  to={notificationRoute(n, user.role)}
                  onSelect={select}
                />
              ))}
            </ul>
            {state.total > state.notifications.length && (
              <p className="mt-3 text-center text-xs text-ink-soft">
                Showing the {state.notifications.length} most recent of {state.total}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
