import type {
  Booking,
  BookingStatus,
  CurrentUser,
  ProviderSettableStatus,
} from '../types';

/* ==========================================================================
   Booking form helpers (ADR-024)
   Pure functions only — no React, no fetch. Everything the booking form needs
   to turn raw input into a valid request lives here so it can be unit tested
   directly.
   ========================================================================== */

/** Mirrors the DB CHECK constraint: 3–2000 characters, enforced server-side. */
export const PROBLEM_MIN = 3;
export const PROBLEM_MAX = 2000;
/** Mirrors the notes CHECK constraint. */
export const NOTES_MAX = 1000;
/** Mirrors the address CHECK constraint. */
export const ADDRESS_MAX = 500;

/** Client-side convenience: don't let people book a slot starting in <30 min. */
export const MIN_LEAD_MINUTES = 30;
/** Mirrors the server's 1-year booking horizon. */
export const MAX_ADVANCE_DAYS = 365;

export type BookingFormValues = {
  serviceId: string;
  date: string;
  time: string;
  problemDescription: string;
  address: string;
  notes: string;
};

export type FieldErrors = Partial<Record<keyof BookingFormValues, string>>;

/* ---------------------------------------------------------------- dates -- */

/** Today as YYYY-MM-DD in the browser's LOCAL calendar (not UTC). */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD `days` from today, in the local calendar. Used for `max`. */
export function maxBookableDate(now: Date = new Date()): string {
  const copy = new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_ADVANCE_DAYS);
  return todayLocal(copy);
}

/**
 * Customer dashboard helpers (ADR-025).
 *
 * Pure functions only — no React, no fetch. The dashboard derives every summary
 * number from ONE `GET /api/bookings/my` response, so all of the arithmetic
 * lives here where it can be tested directly rather than inside a component.
 */

/** Statuses that represent work still to come, per ADR-023. */
export const ACTIVE_STATUSES = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] as const;

/** Statuses that are finished, one way or another. */
export const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'] as const;

/** How many of each the dashboard renders before deferring to /bookings. */
export const UPCOMING_LIMIT = 4;
export const RECENT_LIMIT = 5;

function isActive(booking: Booking): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(booking.status);
}

function scheduledTime(booking: Booking): number {
  const parsed = new Date(booking.scheduledAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Split bookings into the two dashboard sections.
 *
 * Classification is by STATUS, not by whether the date has passed. A PENDING
 * booking whose slot has gone by is still something the customer is waiting on
 * and may want to cancel, so hiding it in "past" would be wrong; conversely a
 * COMPLETED booking is history even if the clock says otherwise. The server
 * already refuses to create a booking in the past, so the two orders rarely
 * disagree in practice.
 *
 * Neither array is sorted IN PLACE — the input is left untouched, because the
 * caller also uses it for the totals.
 */
export function partitionBookings(bookings: Booking[]): {
  upcoming: Booking[];
  recent: Booking[];
} {
  const upcoming = bookings
    .filter(isActive)
    .slice()
    .sort((a, b) => scheduledTime(a) - scheduledTime(b));

  const recent = bookings
    .filter((b) => !(ACTIVE_STATUSES as readonly string[]).includes(b.status))
    .slice()
    .sort((a, b) => scheduledTime(b) - scheduledTime(a));

  return { upcoming, recent };
}

export interface DashboardSummary {
  /** Open work: PENDING + ACCEPTED + IN_PROGRESS. */
  upcoming: number;
  /** Requests a provider has not responded to yet. */
  pending: number;
  /** Finished jobs. */
  completed: number;
  /** Every booking ever made. Uses the server's `pagination.total` when given. */
  total: number;
}

/**
 * The four headline numbers.
 *
 * `serverTotal` is the `pagination.total` from the API. It matters because the
 * endpoint caps a page at 50: without it a customer with 80 bookings would see
 * "Total bookings 50", which is simply wrong. When it is unavailable we fall
 * back to the length of what we actually hold rather than inventing a number.
 */
export function summariseBookings(bookings: Booking[], serverTotal?: number): DashboardSummary {
  return {
    upcoming: bookings.filter(isActive).length,
    pending: bookings.filter((b) => b.status === 'PENDING').length,
    completed: bookings.filter((b) => b.status === 'COMPLETED').length,
    total: serverTotal ?? bookings.length,
  };
}

/** The soonest open booking, for the "next appointment" line. */
export function nextAppointment(upcoming: Booking[]): Booking | null {
  return upcoming.length > 0 ? upcoming[0] : null;
}

/* ------------------------------------------------------------- greetings -- */

/** Time-of-day greeting from the visitor's local clock. */
export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * First name only, for a friendly greeting.
 *
 * Deliberately NOT the full name: the dashboard header should not put a
 * customer's full legal name in large type on a shared screen.
 */
export function firstNameOf(user: CurrentUser | null): string {
  if (!user) return '';
  const first = user.fullName.trim().split(/\s+/)[0];
  return first ?? '';
}

/**
 * The account fields the dashboard is allowed to show.
 *
 * An allow-list, matching the project's existing pattern (ADR-021/024). The
 * `CurrentUser` object also carries `id` and `phone`; neither is rendered here,
 * so a customer id can never appear in the DOM. Passwords, hashes, session ids
 * and tokens are not part of `CurrentUser` at all — `/api/auth/me` never
 * returns them, so there is nothing to accidentally leak.
 */
export interface AccountView {
  name: string;
  email: string;
  role: string;
  memberSince: string | null;
}

export function accountView(user: CurrentUser): AccountView {
  const joined = new Date(user.createdAt);
  return {
    name: user.fullName,
    email: user.email,
    role: user.role,
    memberSince: Number.isNaN(joined.getTime())
      ? null
      : joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  };
}


/**
 * Convert a LOCAL wall-clock selection into the UTC values the API expects.
 *
 * WHY THIS EXISTS: the server composes `date` + `time` as UTC
 * (`composeScheduledAt`), so a naive client shifts the booking by the visitor's
 * own UTC offset — a customer in UTC-3 picking 14:00 local would be stored as
 * 14:00 UTC and shown back to them as 11:00. Converting here means the slot the
 * customer picked is the slot they get, in every timezone.
 *
 * Returns null when the inputs are not a real date/time (the browser's date
 * input cannot produce those, but a value may be restored from history).
 */
export function localSlotToUtc(date: string, time: string): { date: string; time: string } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [, y, mo, d] = dateMatch;
  const [, h, mi] = timeMatch;
  // Construct as LOCAL first, then read the UTC components back out.
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(local.getTime())) return null;
  // Rejects impossible dates like 2026-02-31, which the Date constructor rolls over.
  if (local.getMonth() !== Number(mo) - 1 || local.getDate() !== Number(d)) return null;

  return {
    date: local.toISOString().slice(0, 10),
    time: local.toISOString().slice(11, 16),
  };
}

/** Parse a scheduledAt instant for display, falling back to the raw string. */
export function formatDateTime(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: iso, time: '' };
  return {
    date: parsed.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    time: parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

/** "3 minutes ago" style stamp for list rows. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString();
}

/* ------------------------------------------------------------ validation -- */

/**
 * Client-side validation for UX only.
 *
 * This is explicitly NOT a security boundary (ADR-024): the server revalidates
 * every field with zod. Its only job is to save the customer a round trip and
 * to explain the problem inline.
 */
export function validateBooking(
  values: BookingFormValues,
  options: { hasServices: boolean; now?: Date },
): FieldErrors {
  const errors: FieldErrors = {};
  const now = options.now ?? new Date();

  if (!options.hasServices) {
    errors.serviceId = 'This provider has no services available to book.';
  } else if (!values.serviceId) {
    errors.serviceId = 'Please choose a service.';
  }

  const problem = values.problemDescription.trim();
  if (!problem) {
    errors.problemDescription = 'Please describe the problem so the provider can prepare.';
  } else if (problem.length < PROBLEM_MIN) {
    errors.problemDescription = `Please add a little more detail (at least ${PROBLEM_MIN} characters).`;
  } else if (problem.length > PROBLEM_MAX) {
    errors.problemDescription = `Please keep this under ${PROBLEM_MAX} characters.`;
  }

  const address = values.address.trim();
  if (!address) {
    errors.address = 'Please enter the address where the service is needed.';
  } else if (address.length > ADDRESS_MAX) {
    errors.address = `Please keep the address under ${ADDRESS_MAX} characters.`;
  }

  if (values.notes.length > NOTES_MAX) {
    errors.notes = `Please keep notes under ${NOTES_MAX} characters.`;
  }

  if (!values.date) {
    errors.date = 'Please choose a date.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    errors.date = 'Please enter a valid date.';
  } else if (values.date < todayLocal(now)) {
    errors.date = 'Please choose today or a future date.';
  } else if (values.date > maxBookableDate(now)) {
    errors.date = 'Bookings can only be made up to a year in advance.';
  }

  if (!values.time) {
    errors.time = 'Please choose a time.';
  } else if (!/^\d{2}:\d{2}$/.test(values.time)) {
    errors.time = 'Please enter a valid time.';
  } else if (!errors.date) {
    // Only meaningful once the date itself is plausible.
    const local = new Date(`${values.date}T${values.time}`);
    if (Number.isNaN(local.getTime())) {
      errors.time = 'Please enter a valid time.';
    } else {
      const minutesAway = (local.getTime() - now.getTime()) / 60_000;
      if (minutesAway < -5) {
        errors.time = 'That time has already passed. Please pick a later slot.';
      } else if (minutesAway < MIN_LEAD_MINUTES) {
        errors.time = `Please choose a time at least ${MIN_LEAD_MINUTES} minutes from now.`;
      }
    }
  }

  return errors;
}

/* ---------------------------------------------------------------- status -- */

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Awaiting provider',
  ACCEPTED: 'Confirmed',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/**
 * Statuses from which a CUSTOMER may still cancel, per ADR-023.
 *
 * The server is the authority — if this list is ever wrong the worst case is a
 * disabled button the customer cannot use, or a 400 on an action the server
 * would have allowed. It is never a way to unlock a forbidden action.
 */
export function canCustomerCancel(status: BookingStatus): boolean {
  return status === 'PENDING' || status === 'ACCEPTED';
}

/** Truncated address for a list card. */
export function shortAddress(address: string | null): string {
  if (!address) return '—';
  return address.length <= 60 ? address : `${address.slice(0, 57).trimEnd()}…`;
}

/** Single-line summary of a problem description for list cards. */
export function summarise(text: string | null, max = 120): string {
  if (!text) return '—';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '—';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/* ==========================================================================
   Reviews (ADR-028)
   Pure helpers. Eligibility mirrors the server rule so the UI offers the action
   only where the API will accept it.
   ========================================================================== */

/** Mirrors the DB CHECK `length(trim(comment)) <= 2000`. */
export const REVIEW_COMMENT_MAX = 2000;

/**
 * Whether a booking is eligible to be reviewed.
 *
 * Only a COMPLETED booking qualifies. The server re-checks this and answers 409
 * otherwise, so this is UX rather than enforcement — but offering "Leave a
 * Review" on a booking that is still PENDING would be a dead end.
 */
export function canReview(status: BookingStatus): boolean {
  return status === 'COMPLETED';
}

/**
 * Client-side validation. UX only; the server revalidates with the same rules
 * (`rating` must be a whole 1–5, comment at most 2000 after trimming).
 */
export function validateReview(
  values: { rating: number | null; comment: string },
): { rating?: string; comment?: string } {
  const errors: { rating?: string; comment?: string } = {};

  if (values.rating === null) {
    errors.rating = 'Please choose a rating from 1 to 5 stars.';
  } else if (
    !Number.isInteger(values.rating) ||
    values.rating < 1 ||
    values.rating > 5
  ) {
    errors.rating = 'Please choose a rating from 1 to 5 stars.';
  }

  if (values.comment.length > REVIEW_COMMENT_MAX) {
    errors.comment = `Please keep your review under ${REVIEW_COMMENT_MAX} characters.`;
  }

  return errors;
}

/** "1 star" / "2 stars" — used for each control's accessible name. */
export function ratingLabel(rating: number): string {
  return `${rating} ${rating === 1 ? 'star' : 'stars'}`;
}

/* ==========================================================================
   Provider booking workflow (ADR-026)
   Pure functions only. The action a provider may take is DERIVED from the same
   transition table the server enforces (shared/types.ts BOOKING_TRANSITIONS),
   so the UI cannot offer an action the API would refuse.
   ========================================================================== */

/* ==========================================================================
   Notifications (ADR-029)
   Pure helpers for the bell, the panel and the /notifications page.
   ========================================================================== */

/**
 * The badge label for an unread count.
 *
 * `null` at zero means the badge is not rendered at all, rather than showing a
 * "0" pill that invites a pointless click. Above 99 it caps, because a
 * five-digit pill would break the navbar layout on mobile.
 */
export function unreadBadgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** "3 minutes ago" / "just now" — mirrors the booking list's relative times. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString();
}

/**
 * The route a notification links to, or null when it should not navigate.
 *
 * SECURITY: the route is built HERE from `relatedBookingId`, and the value is
 * rejected unless it is a UUID. The API never supplies a URL, so a notification
 * cannot be used as an open-redirect or phishing vector.
 *
 * Providers have no per-booking page of their own (their queue is one screen),
 * so a provider notification goes to their dashboard instead.
 */
/**
 * A booking id is always a UUID (the column type guarantees it), but this is
 * checked anyway before it is interpolated into a route.
 *
 * WHY: `relatedBookingId` is interpolated into a path segment. React Router
 * treats `/bookings/<anything>` as an in-app path today, so a hostile value
 * cannot currently cause a full-page navigation — but that safety is incidental
 * to how the router happens to work, not a property of this code. If the string
 * ever reached an `<a href>` or a document navigation, a value like
 * `https://evil.example.com` would become a real open redirect.
 *
 * A value that is not a UUID is therefore refused outright: no route, no
 * navigation. Failing closed costs a navigation the user could not have wanted
 * anyway.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notificationRoute(
  notification: { relatedBookingId: string | null },
  role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN',
): string | null {
  const id = notification.relatedBookingId;
  if (!id || !UUID_RE.test(id)) return null;
  // Providers have no per-booking page of their own (their queue is one screen),
  // so a provider notification goes to their dashboard instead.
  return role === 'PROVIDER' ? '/provider/dashboard' : `/bookings/${id}`;
}

/**
 * A tone per notification type, for the icon.
 *
 * Colour is never the only signal — every row also carries its title text and
 * an explicit "New"/"Read" label for screen readers.
 */
export function notificationTone(type: string): 'brand' | 'green' | 'amber' | 'red' | 'slate' {
  switch (type) {
    case 'BOOKING_ACCEPTED':
    case 'BOOKING_COMPLETED':
      return 'green';
    case 'BOOKING_REJECTED':
      return 'red';
    case 'BOOKING_CANCELLED':
      return 'slate';
    case 'BOOKING_IN_PROGRESS':
      return 'brand';
    case 'REVIEW_SUBMITTED':
      return 'amber';
    default:
      return 'brand';
  }
}
/* ==========================================================================
   Provider booking workflow (ADR-026)
   Pure functions only. The action a provider may take is DERIVED from the same
   transition table the server enforces (shared/types.ts BOOKING_TRANSITIONS),
   so the UI cannot offer an action the API would refuse.
   ========================================================================== */


/**
 * Provider-settable transitions, mirroring `BOOKING_TRANSITIONS` on the server
 * with `CANCELLED` removed — a provider does not cancel, the customer does.
 *
 * PENDING    → ACCEPTED, REJECTED
 * ACCEPTED   → IN_PROGRESS
 * IN_PROGRESS → COMPLETED
 * everything else → terminal, no action
 */
export const PROVIDER_TRANSITIONS: Record<BookingStatus, readonly ProviderSettableStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  // Terminal. A provider can do nothing to these — in particular a REJECTED or
  // CANCELLED booking can never be revived, and a COMPLETED one is never undone.
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

/** The status a provider may set from `status`, or null if none. */
export function nextProviderAction(status: BookingStatus): ProviderSettableStatus | null {
  return PROVIDER_TRANSITIONS[status][0] ?? null;
}

/** True when the provider has any action available on this booking. */
export function canProviderAct(status: BookingStatus): boolean {
  return PROVIDER_TRANSITIONS[status].length > 0;
}

/** Button copy for a target status. */
export function actionLabel(status: ProviderSettableStatus): string {
  switch (status) {
    case 'ACCEPTED':
      return 'Accept';
    case 'REJECTED':
      return 'Reject';
    case 'IN_PROGRESS':
      return 'Start service';
    case 'COMPLETED':
      return 'Mark completed';
  }
}

/**
 * Whether a target status needs a reason.
 *
 * The server's `providerStatusSchema` requires one only for REJECTED (a DB CHECK
 * backs it) and accepts it optionally elsewhere. Mirroring that here saves the
 * provider a 400 round trip — the server remains the authority.
 */
export function requiresReason(status: ProviderSettableStatus): boolean {
  return status === 'REJECTED';
}

/** Server-enforced bounds on the rejection reason. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Client-side reason check. UX only; the server revalidates. */
export function validateReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'Please give the customer a reason.';
  if (trimmed.length < REASON_MIN) return `Please write at least ${REASON_MIN} characters.`;
  if (trimmed.length > REASON_MAX) return `Please keep this under ${REASON_MAX} characters.`;
  return null;
}

/* --------------------------------------------------------- counts and sort -- */

export interface ProviderSummary {
  pending: number;
  accepted: number;
  inProgress: number;
  completed: number;
  rejected: number;
  cancelled: number;
  /** From the server's `pagination.total`, not the (capped) array length. */
  total: number;
}

export function summariseProviderBookings(
  bookings: Booking[],
  serverTotal?: number,
): ProviderSummary {
  const count = (status: BookingStatus) => bookings.filter((b) => b.status === status).length;
  return {
    pending: count('PENDING'),
    accepted: count('ACCEPTED'),
    inProgress: count('IN_PROGRESS'),
    completed: count('COMPLETED'),
    rejected: count('REJECTED'),
    cancelled: count('CANCELLED'),
    total: serverTotal ?? bookings.length,
  };
}

/** Status tabs shown above the queue. */
export const PROVIDER_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

export type ProviderFilter = (typeof PROVIDER_FILTERS)[number]['value'];

/**
 * Filter the queue client-side.
 *
 * The whole queue is already in memory, so filtering locally avoids a request per
 * tab click. Pure: the input array is never mutated.
 */
export function filterProviderBookings(bookings: Booking[], filter: ProviderFilter): Booking[] {
  if (filter === 'ALL') return bookings;
  return bookings.filter((b) => b.status === filter);
}

/** Rank used to surface what needs attention first. */
const STATUS_RANK: Record<BookingStatus, number> = {
  PENDING: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2,
  // Closed work sorts after open work, newest activity first within each group.
  COMPLETED: 3,
  REJECTED: 4,
  CANCELLED: 5,
};

function activityTime(booking: Booking): number {
  const updated = new Date(booking.updatedAt).getTime();
  if (!Number.isNaN(updated)) return updated;
  const created = new Date(booking.createdAt).getTime();
  return Number.isNaN(created) ? 0 : created;
}

/**
 * Order the queue: PENDING, then ACCEPTED, then IN_PROGRESS, then closed work
 * newest-first within each group.
 *
 * Pure — a new array is returned and the input is left untouched, because the
 * summary counts still need the original.
 */
export function sortProviderBookings(bookings: Booking[]): Booking[] {
  return bookings
    .slice()
    .sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      return activityTime(b) - activityTime(a);
    });
}



