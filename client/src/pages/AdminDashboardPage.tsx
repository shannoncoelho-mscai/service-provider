import { AlertTriangle, ClipboardCheck, FileText, Lock, RefreshCw, ShieldAlert, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ApiError,
  approveProvider,
  listPendingProviders,
  rejectProvider,
  suspendProvider,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  adminProviderView,
  decisionSuccessMessage,
  queueSummary,
} from '../lib/admin-utils';
import type { AdminDecision, AdminProviderDetail } from '../types';
import DecisionDialog from '../components/admin/DecisionDialog';
import ProviderReviewCard from '../components/admin/ProviderReviewCard';
import { Alert, ErrorState, LoadingState } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; providers: AdminProviderDetail[] }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'error' };

/** Signed-out / wrong-role / expired-session gate. */
function Gate({
  icon: Icon,
  tone,
  title,
  message,
  to,
  cta,
}: {
  icon: typeof Lock;
  tone: 'brand' | 'amber';
  title: string;
  message: string;
  to: string;
  cta: string;
}) {
  return (
    <div className="shell py-12">
      <div className="card mx-auto max-w-md p-8 text-center">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            tone === 'brand' ? 'bg-brand-50' : 'bg-amber-50'
          }`}
        >
          <Icon
            className={`h-6 w-6 ${tone === 'brand' ? 'text-brand-500' : 'text-amber-500'}`}
            aria-hidden="true"
          />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</p>
        <Link to={to} className="btn btn-primary mt-6 w-full px-4 py-3 text-sm">
          {cta}
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, icon: Icon, tone }: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Users;
  tone: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          <p className="mt-1.5 font-display text-3xl font-bold text-ink">
            {value}
            <span className="sr-only"> {label.toLowerCase()}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">{hint}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/**
 * Admin dashboard — `/admin/dashboard` (ADR-027).
 *
 * DATA: one `GET /api/admin/providers/pending` per visit. The backend exposes no
 * list endpoint for approved/rejected/suspended providers, so the dashboard does
 * NOT show counts for them — a "Rejected: 0" card would be a fabrication, not a
 * measurement. Every figure rendered is derived from the pending queue.
 *
 * SECURITY: the role gate below is UX only. `adminRouter` applies
 * `requireAuth` + `requireRole('ADMIN')` before any handler runs, and the server
 * takes the acting admin from the session — nothing here sends an admin id, and
 * there is no such field to send. A CUSTOMER or PROVIDER is turned away before
 * any admin request is made.
 *
 * STATE: after a decision the queue is RE-FETCHED. Nothing is patched locally, so
 * a card never claims a status the server did not actually set, and a provider
 * disappears from the queue only because the server removed it.
 */
export default function AdminDashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [deciding, setDeciding] = useState<{ decision: AdminDecision; provider: AdminProviderDetail } | null>(null);
  const [busy, setBusy] = useState<{ id: string; decision: AdminDecision } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    listPendingProviders()
      .then((providers) => setState({ status: 'ready', providers: providers ?? [] }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setState({ status: 'forbidden' });
        } else {
          setState({ status: 'error' });
        }
      });
  }, []);

  // Re-fetch on navigation only. No polling, no auto-refresh timer.
  useEffect(load, [load, location.key]);

  // 1. Signed out — prompt WITHOUT calling any admin endpoint.
  if (!user) {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Sign in to the admin dashboard"
        message="The admin area is restricted to staff accounts, so you need to sign in first."
        to="/login"
        cta="Sign in"
      />
    );
  }

  // 2. CUSTOMER / PROVIDER — not their area. No admin request is made.
  if (user.role !== 'ADMIN') {
    return (
      <Gate
        icon={ShieldAlert}
        tone="amber"
        title="Admin accounts only"
        message={`Provider verification is handled by ServiceConnect staff. You are signed in as a ${user.role.toLowerCase()} account.`}
        to={user.role === 'PROVIDER' ? '/provider/dashboard' : '/dashboard'}
        cta={user.role === 'PROVIDER' ? 'Go to provider dashboard' : 'Go to my dashboard'}
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="shell py-10">
        <LoadingState label="Loading the verification queue..." />
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <Gate
        icon={Lock}
        tone="brand"
        title="Session expired"
        message="Please sign in again to continue reviewing providers."
        to="/login"
        cta="Sign in"
      />
    );
  }

  if (state.status === 'forbidden') {
    return (
      <Gate
        icon={ShieldAlert}
        tone="amber"
        title="Admin access required"
        message="This account is not permitted to use the admin area."
        to="/"
        cta="Back to home"
      />
    );
  }

  if (state.status === 'error') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Could not load the verification queue"
          message="We could not reach the server. Please check your connection and try again."
          onRetry={load}
        />
      </div>
    );
  }

  const { providers } = state;
  const summary = queueSummary(providers);

  /**
   * The single decision path. `busy` is checked first so a double-click cannot
   * fire two PATCHes; the server would answer the second with 409 anyway.
   */
  async function runDecision(
    provider: AdminProviderDetail,
    decision: AdminDecision,
    reason: string,
  ) {
    if (busy) return;
    setBusy({ id: provider.userId, decision });
    setActionError(null);
    try {
      if (decision === 'APPROVED') {
        await approveProvider(provider.userId);
      } else if (decision === 'REJECTED') {
        await rejectProvider(provider.userId, reason);
      } else {
        await suspendProvider(provider.userId, reason || undefined);
      }
      setBusy(null);
      setNotice(decisionSuccessMessage(decision, provider.businessName));
      // Re-read the queue rather than filtering locally: the server decides
      // who is still pending, and another admin may have acted too.
      load();
    } catch (error) {
      setBusy(null);
      setActionError(explainDecisionError(error));
      // 409 means another admin got there first — re-read to show the truth.
      if (error instanceof ApiError && error.status === 409) load();
    }
  }

  return (
    <div className="shell py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">Admin Dashboard</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Manage provider verification and monitor ServiceConnect providers.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn btn-ghost px-3.5 py-2.5 text-sm"
          aria-label="Refresh the verification queue"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {notice && (
        <div className="mt-5">
          <Alert variant="info">{notice}</Alert>
        </div>
      )}
      {actionError && (
        <div className="mt-5">
          <Alert>{actionError}</Alert>
        </div>
      )}

      {/* Only figures derived from the queue are shown. There is deliberately no
          Approved/Rejected/Suspended card: the backend exposes no such list, so
          any count would be invented. */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat
          label="Pending providers"
          value={summary.total}
          hint="Awaiting a decision"
          icon={Users}
          tone="bg-accent-50 text-accent-600"
        />
        <Stat
          label="With experience listed"
          value={summary.withExperience}
          hint="Years of experience given"
          icon={ClipboardCheck}
          tone="bg-brand-50 text-brand-600"
        />
        <Stat
          label="With a description"
          value={summary.withDescription}
          hint="Business description given"
          icon={FileText}
          tone="bg-slate-100 text-slate-500"
        />
      </div>

      <section aria-labelledby="queue-heading" className="mt-8">
        <h2
          id="queue-heading"
          className="flex items-center gap-2 font-display text-lg font-bold text-ink"
        >
          <AlertTriangle className="h-4 w-4 text-accent-500" aria-hidden="true" />
          Pending Provider Verification
        </h2>

        <div className="mt-4">
          {providers.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 p-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
                <ClipboardCheck className="h-6 w-6 text-emerald-500" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-bold text-ink">Queue is clear</h3>
              <p className="max-w-md text-sm text-ink-soft">
                There are no providers waiting for verification. New submissions will appear here
                as soon as they are made.
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {providers.map((provider) => (
                <li key={provider.userId}>
                  <ProviderReviewCard
                    provider={adminProviderView(provider)}
                    busy={busy?.id === provider.userId ? busy.decision : null}
                    onDecide={(decision) => setDeciding({ decision, provider })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {deciding && (
        <DecisionDialog
          decision={deciding.decision}
          businessName={deciding.provider.businessName}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            const { decision, provider } = deciding;
            setDeciding(null);
            await runDecision(provider, decision, reason);
          }}
        />
      )}
    </div>
  );
}

/** Map an API failure to copy an administrator can act on. Never raw. */
function explainDecisionError(error: unknown): string {
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  switch (status) {
    case 400:
      return 'That decision was not accepted. Please check the reason and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'This action requires an admin account.';
    case 404:
      return 'That provider could not be found.';
    case 409:
      return 'This provider has already been reviewed by someone else. The queue has been refreshed.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}
