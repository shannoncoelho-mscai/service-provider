/** Roles supported by ServiceConnect. Mirrored in client/src/types/index.ts. */
export const ROLES = ['CUSTOMER', 'PROVIDER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Provider verification statuses (mirrors the PostgreSQL enum). */
export const VERIFICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return (
    typeof value === 'string' &&
    (VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

/** The authenticated principal attached to req.user by requireAuth. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Session id from the verified token — used to revoke on logout. */
  sessionId: string;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Booking statuses (mirrors the PostgreSQL `booking_status` enum). */
export const BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** A booking in one of these states can no longer change. */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
];

export function isTerminalStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

/**
 * The complete, single source of truth for booking state changes (ADR-023).
 *
 * Transitions are keyed by CURRENT status. Anything not listed here is
 * refused, so there is no way to reach a state the map does not name — the
 * map is the authority, not a set of "allowed" hints.
 *
 *   PENDING    → ACCEPTED | REJECTED | CANCELLED
 *   ACCEPTED   → IN_PROGRESS | CANCELLED
 *   IN_PROGRESS→ COMPLETED
 *
 * REJECTED, CANCELLED and COMPLETED are terminal: no outgoing edges, which is
 * what blocks REJECTED→COMPLETED, CANCELLED→ACCEPTED and COMPLETED→CANCELLED.
 *
 * Deliberately absent: PENDING→IN_PROGRESS and PENDING→COMPLETED. A provider
 * must accept a job before starting it, so work can never begin on a request
 * the provider has not agreed to.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** Statuses a PROVIDER may set (they act on their own queue). */
export const PROVIDER_SETTABLE_STATUSES: readonly BookingStatus[] = [
  'ACCEPTED',
  'REJECTED',
  'IN_PROGRESS',
  'COMPLETED',
];

/** Statuses a CUSTOMER may set. Only cancellation — never provider-only ones. */
export const CUSTOMER_SETTABLE_STATUSES: readonly BookingStatus[] = ['CANCELLED'];

/** Customer may cancel only while the job has not started. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly BookingStatus[] = ['PENDING', 'ACCEPTED'];

/* ==========================================================================
   In-app notifications (ADR-029)
   Mirrors the `notification_type` enum created in migration 011. The client has
   its own copy in client/src/types; the two are kept in sync deliberately.
   ========================================================================== */

export const NOTIFICATION_TYPES = [
  'BOOKING_CREATED',
  'BOOKING_ACCEPTED',
  'BOOKING_REJECTED',
  'BOOKING_CANCELLED',
  'BOOKING_IN_PROGRESS',
  'BOOKING_COMPLETED',
  'REVIEW_SUBMITTED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

