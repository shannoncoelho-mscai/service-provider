import type {
  AdminDecision,
  AdminProviderDetail,
  AdminProviderReview,
  AdminProviderService,
  AdminProviderImage,
  VerificationStatus,
} from '../types';

/* ==========================================================================
   Admin provider-verification helpers (ADR-027)
   Pure functions. The view-model here is the ONLY bridge between the admin DTO
   and the UI, which is what makes the allow-list enforceable rather than
   aspirational: a component that reads `adminProviderView(...)` cannot render a
   field that was never copied out of the response.
   ========================================================================== */

/**
 * The ONLY shape the admin UI is allowed to render.
 *
 * Deliberately absent from the admin payload and therefore from this view:
 *   - `verifiedBy`  — an ADMIN's user id. The server records who decided, but
 *                     showing one admin's id to another is needless exposure.
 *   - `userId`      — the internal user id. It is the route parameter, but there
 *                     is no reason to print it in the page body.
 *   - `owner.isActive` — an auth concern, not a verification one.
 *
 * Everything present here is either identity, a contact detail a reviewer must
 * check, or the decision-relevant status. No password, hash, session id or token
 * is in `AdminProviderDetail` to begin with.
 */
export interface AdminProviderView {
  /**
   * The provider's user id. Used ONLY as the `/admin/providers/:id` route
   * parameter — it is never rendered as visible text, and it came from the
   * server's response, not from anything the admin typed.
   */
  id: string;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  description: string | null;
  city: string;
  address: string | null;
  phone: string | null;
  serviceAreas: string[];
  yearsExperience: number;
  hourlyRate: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  verificationStatus: VerificationStatus;
  isPublic: boolean;
  createdAt: string;
  verifiedAt: string | null;
  /**
   * The provider's catalogue, for the reviewer. Copied field by field rather
   * than spread, so a future column added to the API cannot silently appear on
   * the admin screen without someone deciding it belongs there.
   */
  services: AdminProviderService[];
  /**
   * The provider's uploaded BUSINESS photos, for inspection before deciding
   * (Phase 21).
   *
   * Copied field by field, exactly like `services`, because this projection is
   * the allow-list that decides what an admin screen can render at all. Note
   * what is absent: there is no `createdAt`, and no mutating affordance is
   * implied anywhere. The review is READ-ONLY — a reviewer must be able to judge
   * the evidence without being able to alter it.
   */
  images: AdminProviderImage[];
}

/** Project an admin DTO onto the renderable view. Pure; copies arrays. */
export function adminProviderView(provider: AdminProviderDetail): AdminProviderView {
  return {
    id: provider.userId,
    businessName: provider.businessName,
    ownerName: provider.owner?.fullName ?? 'Unknown',
    ownerEmail: provider.owner?.email ?? '',
    description: provider.description,
    city: provider.city,
    address: provider.address,
    phone: provider.phone,
    // Copied, not aliased: a later sort must not reorder the API response.
    serviceAreas: [...(provider.serviceAreas ?? [])],
    yearsExperience: provider.yearsExperience,
    hourlyRate: provider.hourlyRate,
    profileImageUrl: provider.profileImageUrl,
    coverImageUrl: provider.coverImageUrl,
    verificationStatus: provider.verificationStatus,
    isPublic: provider.isPublic,
    createdAt: provider.createdAt,
    verifiedAt: provider.verifiedAt,
    services: (provider.services ?? []).map((service) => ({ ...service })),
    // `?? []` guards a server that predates Phase 21, so an older payload
    // renders the empty state instead of throwing in the reviewer's face.
    images: (provider.images ?? []).map((image) => ({ ...image })),
  };
}

/* ------------------------------------------------------------- decisions -- */

/**
 * Which decisions the UI offers from the current status.
 *
 * This is a DELIBERATELY NARROWER set than the server's state machine, which
 * permits approve from REJECTED/SUSPENDED and reject from SUSPENDED. Those
 * "revive" transitions exist in the API but are not surfaced here: re-approving
 * a rejected provider is a policy decision that belongs in a deliberate flow,
 * not a one-click button on a review card. The server stays authoritative, and a
 * no-op transition still returns 409.
 */
export const ADMIN_ACTIONS: Record<VerificationStatus, readonly AdminDecision[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  // The API allows more from these two; this UI does not offer it.
  REJECTED: [],
  SUSPENDED: [],
};

/** The decisions available from a provider's current status. */
export function adminActionsFor(status: VerificationStatus): readonly AdminDecision[] {
  return ADMIN_ACTIONS[status] ?? [];
}

/** Whether any decision is available. */
export function canAdminDecide(status: VerificationStatus): boolean {
  return adminActionsFor(status).length > 0;
}

/** Human label for a status, used in badges and headings. */
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

/** Button copy per decision. */
export function decisionLabel(decision: AdminDecision): string {
  switch (decision) {
    case 'APPROVED':
      return 'Approve provider';
    case 'REJECTED':
      return 'Reject provider';
    case 'SUSPENDED':
      return 'Suspend provider';
  }
}

/** A past-tense success line, so the outcome is stated rather than implied. */
export function decisionSuccessMessage(decision: AdminDecision, businessName: string): string {
  switch (decision) {
    case 'APPROVED':
      return `Provider approved successfully. ${businessName} is now bookable by customers.`;
    case 'REJECTED':
      return `Provider rejected successfully. ${businessName} can no longer receive bookings.`;
    case 'SUSPENDED':
      return `Provider suspended successfully. ${businessName} is hidden from customers.`;
  }
}

/* ---------------------------------------------------------------- reason -- */

/** Server bounds: `rejectSchema` requires 5–500; `suspendSchema` allows 5–500. */
export const ADMIN_REASON_MIN = 5;
export const ADMIN_REASON_MAX = 500;
/** `approveSchema` note: 2–500. */
export const ADMIN_NOTE_MIN = 2;

/**
 * Client-side reason check. UX only; the server revalidates.
 *
 * `required` distinguishes reject (mandatory) from suspend (optional).
 */
export function validateAdminReason(reason: string, required: boolean): string | null {
  const trimmed = reason.trim();
  if (!trimmed) {
    return required ? 'A reason is required.' : null;
  }
  if (trimmed.length < ADMIN_REASON_MIN) {
    return `Please write at least ${ADMIN_REASON_MIN} characters so the decision is clear.`;
  }
  if (trimmed.length > ADMIN_REASON_MAX) {
    return `Please keep this under ${ADMIN_REASON_MAX} characters.`;
  }
  return null;
}

/* --------------------------------------------------------- audit history -- */

/** One rendered audit row. `details` is NOT rendered — see the note below. */
export interface AuditEntryView {
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Project the audit trail.
 *
 * `details` is a `Record<string, unknown>` straight from the database. It is
 * reduced to a `reason` string when it is one and discarded otherwise — a JSON
 * blob has no business being dumped into a page.
 */
export function auditEntries(provider: AdminProviderReview): AuditEntryView[] {
  return (provider.actions ?? []).map((action) => {
    const reason = action.details?.reason;
    return {
      action: action.action,
      previousStatus: action.previousStatus,
      newStatus: action.newStatus,
      reason: typeof reason === 'string' ? reason : null,
      createdAt: action.createdAt,
    };
  });
}

/* ------------------------------------------------------------- formatting -- */

export function formatSubmitted(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatDecisionTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What the dashboard may honestly report about the queue.
 *
 * Only figures derived from the pending list are included. The backend exposes
 * no approved/rejected/suspended list, so there are no such counts here — a
 * "Rejected: 0" card would be a fabrication, not a measurement.
 */
export function queueSummary(providers: AdminProviderDetail[]): {
  total: number;
  withExperience: number;
  withDescription: number;
} {
  return {
    total: providers.length,
    withExperience: providers.filter((p) => p.yearsExperience > 0).length,
    withDescription: providers.filter((p) => Boolean(p.description && p.description.trim())).length,
  };
}

