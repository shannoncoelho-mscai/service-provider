import { Loader2 } from 'lucide-react';
import {
  adminActionsFor,
  canAdminDecide,
  decisionLabel,
} from '../../lib/admin-utils';
import type { AdminDecision, VerificationStatus } from '../../types';

const TONES = {
  APPROVED: 'bg-emerald-600 hover:bg-emerald-700',
  REJECTED: 'bg-red-600 hover:bg-red-700',
  SUSPENDED: 'bg-amber-600 hover:bg-amber-700',
} as const;

/**
 * The decision buttons for a provider's current status.
 *
 * WHICH BUTTONS EXIST is decided entirely by `adminActionsFor(status)`, so a
 * REJECTED or SUSPENDED provider renders none. There is deliberately no generic
 * status dropdown anywhere in the admin UI: an admin cannot type a status and
 * submit it, because there is no endpoint that accepts one — the three
 * decision endpoints are the only way to change a provider's state.
 *
 * `busy` disables every button while a decision is in flight, so a double-click
 * cannot fire two PATCHes. The server would answer the second with 409 anyway,
 * but there is no reason to make it.
 */
export default function DecisionButtons({
  status,
  onDecide,
  busy,
  size = 'md',
}: {
  status: VerificationStatus;
  onDecide: (decision: AdminDecision) => void;
  /** The decision currently in flight, if any. */
  busy?: AdminDecision | null;
  size?: 'sm' | 'md';
}) {
  const actions = adminActionsFor(status);
  if (!canAdminDecide(status)) return null;

  const pad = size === 'sm' ? 'min-h-10 px-3 py-2 text-xs' : 'min-h-11 px-4 py-2.5 text-sm';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((decision) => (
        <button
          key={decision}
          type="button"
          onClick={() => onDecide(decision)}
          disabled={busy != null}
          aria-busy={busy === decision}
          className={`btn inline-flex items-center gap-1.5 text-white disabled:cursor-not-allowed disabled:opacity-60 ${pad} ${TONES[decision]}`}
        >
          {busy === decision && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy === decision ? 'Working...' : decisionLabel(decision)}
        </button>
      ))}
    </div>
  );
}
