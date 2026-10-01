import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getUnreadCount, listNotifications, markNotificationRead } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { notificationRoute } from '../../lib/booking-utils';
import type { Notification } from '../../types';
import { NotificationBell } from './index';
import NotificationRow from './NotificationRow';

const PANEL_SIZE = 8;

/**
 * The navbar notification bell and its dropdown panel (ADR-029).
 *
 * REFRESH STRATEGY — deliberately NOT polling:
 *   - The unread COUNT is fetched once per session and refreshed whenever the
 *     panel is opened. There is no interval, no WebSocket and no background
 *     timer, so an idle tab costs nothing and no duplicate timer can accumulate.
 *   - Opening the panel re-reads the list: that is the moment a user actually
 *     wants fresh data.
 *   - Navigating within the SPA changes `location.key`, which re-reads the
 *     count, so a provider who accepts a booking and then navigates sees the new
 *     badge.
 *
 * ANONYMOUS USERS FETCH NOTHING. `refreshCount` returns early without a session,
 * so a signed-out visitor never issues a request that could only 401.
 */
export default function NotificationBellWithPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    if (!user) return;
    getUnreadCount()
      .then(setUnread)
      .catch(() => {
        // A failed badge refresh is not worth a visible error; the panel still
        // tries when opened.
      });
  }, [user]);

  // Fetch once per session, and again on every SPA navigation.
  useEffect(() => {
    refreshCount();
  }, [refreshCount, location.key]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Click-away closes the panel. Uses `mousedown` so it fires before a click on
  // the trigger can immediately re-open it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // No bell for a signed-out visitor: nothing to show, nothing to fetch.
  if (!user) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    Promise.all([listNotifications({ pageSize: PANEL_SIZE }), getUnreadCount()])
      .then(([data, count]) => {
        setItems(data.notifications ?? []);
        setUnread(count);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  const select = (notification: Notification) => {
    setOpen(false);
    if (notification.readAt === null) {
      markNotificationRead(notification.id)
        .then(() => setUnread((n) => Math.max(0, n - 1)))
        .catch(() => {});
    }
    // The route is built from a UUID we issued, never from a URL in the payload.
    const target = notificationRoute(notification, user.role);
    if (target) navigate(target);
  };

  return (
    <div className="relative" ref={panelRef}>
      <NotificationBell count={unread} open={open} onToggle={toggle} />

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <Link to="/notifications" className="text-xs font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>

          {loading && items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">Loading...</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">
              You have no notifications yet.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  to={notificationRoute(n, user.role)}
                  onSelect={select}
                />
              ))}
            </ul>
          )}

          <div className="border-t border-line px-4 py-2">
            <Link
              to="/notifications"
              className="block text-center text-xs font-medium text-brand-700 hover:underline"
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}