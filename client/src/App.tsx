import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import SiteFooter from './components/SiteFooter';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import ProvidersPage from './pages/ProvidersPage';
import ProviderProfilePage from './pages/ProviderProfilePage';
import BookingPage from './pages/BookingPage';
import DashboardPage from './pages/DashboardPage';
import MyBookingsPage from './pages/MyBookingsPage';
import BookingDetailPage from './pages/BookingDetailPage';
import NotificationsPage from './pages/NotificationsPage';
import ProviderDashboardPage from './pages/ProviderDashboardPage';
import ProviderBusinessPage from './pages/ProviderBusinessPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminProviderPage from './pages/AdminProviderPage';
import { AuthProvider } from './lib/auth-context';

/**
 * Routing shell. The customer booking flow (ADR-024):
 *   /providers/:id/book   booking request form
 *   /bookings             the customer's own bookings
 *   /bookings/:id         a single booking
 *   /dashboard            the customer overview (ADR-025)
 *   /admin/dashboard        provider verification (ADR-027)
 *   /admin/providers/:id    one provider's review + decision history
 *   /notifications         the signed-in user's notifications (ADR-029)
 *
 * There are deliberately NO client-side "role guards": hiding a route in the
 * browser is not security. Each booking page decides what to show from the
 * session, and the backend independently re-reads the role and ownership from
 * the database on every request (docs/SECURITY.md). The gates here exist purely
 * so nobody is shown a form that can only fail.
 *
 * `main` is intentionally unconstrained in width: marketing sections span the
 * viewport and manage their own `.shell` container, while the inner pages add
 * their own centred wrapper.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="flex min-h-screen flex-col bg-canvas text-ink">
          <Navbar />

          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/providers/:id" element={<ProviderProfilePage />} />
              <Route path="/providers/:id/book" element={<BookingPage />} />
              <Route path="/bookings" element={<MyBookingsPage />} />
              <Route path="/bookings/:id" element={<BookingDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/provider/dashboard" element={<ProviderDashboardPage />} />
              {/* The provider's own profile + service catalogue (Phase 18). */}
              <Route path="/provider/business" element={<ProviderBusinessPage />} />
              <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
              <Route path="/admin/providers/:id" element={<AdminProviderPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/login" element={<LoginPage />} />
              {/* Sign-up entry point. Opens the register tab with the provider
                  role pre-selected, so "Join as provider" lands on the business
                  form rather than making the visitor click through. */}
              <Route
                path="/register"
                element={<LoginPage initialMode="register" initialRole="PROVIDER" />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>

          <SiteFooter />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
