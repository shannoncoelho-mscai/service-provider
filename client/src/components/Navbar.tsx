import { LayoutDashboard, LogOut, Menu, User, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import NotificationBellWithPanel from './notifications/NotificationBellWithPanel';

const PUBLIC_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/providers', label: 'Find a pro' },
];

/**
 * Links per role (Phase 18).
 *
 * Each role sees the pages it can actually use, so nobody is shown a screen
 * that could only fail:
 *
 *   CUSTOMER  Dashboard, Find a pro, My bookings, Notifications
 *   PROVIDER  Booking requests, My business, Notifications
 *   ADMIN     Provider verification
 *   signed out  Home, Find a pro (+ Sign in / Join as provider below)
 *
 * IMPORTANT: this is presentation only. Hiding a link is not authorization —
 * `requireAuth`/`requireRole` on the server re-read the role from the database
 * on every request, so editing the browser gets nobody past the API.
 */
interface NavLink {
  to: string;
  label: string;
}

/** Exported so the navigation-per-role contract can be asserted in tests. */
export const ROLE_LINKS: Record<'CUSTOMER' | 'PROVIDER' | 'ADMIN', NavLink[]> = {
  CUSTOMER: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/providers', label: 'Find a pro' },
    { to: '/bookings', label: 'My bookings' },
  ],
  PROVIDER: [
    { to: '/provider/dashboard', label: 'Booking requests' },
    { to: '/provider/business', label: 'My business' },
  ],
  ADMIN: [
    { to: '/admin/dashboard', label: 'Provider verification' },
  ],
};

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-brand-50/60 hover:text-ink',
  ].join(' ');

/**
 * Responsive navigation: inline links on ≥md screens, hamburger panel below.
 * The panel closes on route change so tapping a link never leaves it hanging.
 *
 * Role-specific links are a convenience, NOT authorization. The customer
 * pages re-check the role themselves, the provider dashboard re-checks it, and
 * the backend enforces ownership and role regardless of what the navbar renders.
 */
export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // Close the mobile panel whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);


  // Signed-out visitors get the public directory; every signed-in role gets its
  // own area. ADMIN sees only verification, never the customer or provider UI.
  const links = user ? ROLE_LINKS[user.role] : PUBLIC_LINKS;

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const AccountLinks = user ? (
    <div className="flex items-center gap-2">
      {/*
        Full-page notifications link. The bell opens a dropdown, which is a poor
        target on touch and unreachable by keyboard shortcut; this is the
        canonical "see everything" route for customer and provider alike.
      */}
      <NavLink to="/notifications" className={navLinkClasses}>
        Notifications
      </NavLink>
      <span
        className="hidden max-w-40 truncate text-sm text-ink-soft lg:inline"
        title={user.email}
      >
        {user.fullName}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        className="btn btn-ghost px-3 py-2 text-sm"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Link
        to="/register"
        className="btn btn-ghost hidden px-3 py-2 text-sm sm:inline-flex"
      >
        Join as provider
      </Link>
      <Link to="/login" className="btn btn-primary px-4 py-2 text-sm">
        Sign in
      </Link>
    </div>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-md">
      <nav aria-label="Main" className="shell flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-soft">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-ink">
            ServiceConnect
          </span>
        </Link>

        {/*
          One bell, visible at every breakpoint.

          It deliberately sits OUTSIDE the desktop/mobile split below. It used
          to be rendered inside both, which mounted two panels and therefore
          issued two identical `GET /api/notifications/unread-count` requests on
          every single page load. The links and the account controls still swap
          at `md`; the bell does not need to.
        */}
        <div className="flex items-center gap-1">
          <NotificationBellWithPanel />

          {/* Desktop navigation */}
          <div className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={navLinkClasses}
                end={link.to === '/'}
              >
                {link.label}
              </NavLink>
            ))}
            <div className="ml-3">{AccountLinks}</div>
          </div>

          {/* Mobile: only the hamburger is breakpoint-specific now. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-brand-50 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div id="mobile-menu" className="border-t border-line bg-white px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={navLinkClasses}
                end={link.to === '/'}
              >
                {link.label}
              </NavLink>
            ))}
            {user ? (
              <>
                <div className="mt-3 flex items-center gap-2 border-t border-line px-3 pt-4 text-sm text-ink-soft">
                  {user.role === 'CUSTOMER' ? (
                    <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <User className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="truncate">{user.fullName}</span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="btn btn-ghost mt-3 w-full px-4 py-2.5 text-sm"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </>
            ) : (
              <div className="mt-3 space-y-2 border-t border-line pt-4">
                <Link to="/login" className="btn btn-primary block w-full px-4 py-2.5 text-sm">
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="btn btn-ghost block w-full px-4 py-2.5 text-sm"
                >
                  Join as provider
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
