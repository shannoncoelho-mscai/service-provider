import { pool } from '../../config/database';
import { insertNotification } from '../notifications/notifications.service';
import { HttpError } from '../../shared/httpError';
import {
  BOOKING_TRANSITIONS,
  CUSTOMER_CANCELLABLE_STATUSES,
  canTransition,
  isBookingStatus,
  type BookingStatus,
} from '../../shared/types';
import {
  composeScheduledAt,
  type CancelBookingInput,
  type CreateBookingInput,
  type ProviderStatusInput,
} from './bookings.schemas';

/**
 * Booking workflow (ADR-023).
 *
 * IDENTITY
 *   The customer is ALWAYS `req.user.id` from the verified session. No client
 *   field can set it. The provider is client-*selected* (that is the "select
 *   provider" step) but is then verified: the profile must exist, belong to a
 *   PROVIDER-role user, be APPROVED, be active, and not be the customer.
 *
 * OWNERSHIP
 *   `loadVisibleBooking` scopes every read/write by the caller's role, with
 *   the predicate inside the SQL, so swapping the :id in the URL matches
 *   nothing. A booking that is not the caller's returns the same 404 as one
 *   that does not exist, so the endpoint cannot confirm that someone else's
 *   booking id is real.
 *
 * STATE MACHINE
 *   `BOOKING_TRANSITIONS` (shared/types.ts) is the only authority. The
 *   customer may only ever request CANCELLED, and only from PENDING/ACCEPTED.
 *   The provider may request ACCEPTED/REJECTED/IN_PROGRESS/COMPLETED. Both go
 *   through `canTransition` against the row's *current* status, and the write
 *   is a single guarded statement — `... WHERE id = $1 AND status = $current` —
 *   so two concurrent updates cannot both read PENDING and both write, which
 *   would otherwise let a double-click skip a state.
 *
 * SQL INJECTION
 *   Every value is bound; no user input reaches the SQL string.
 */

/** DTO returned to the two parties of a booking. Allow-listed. */
export interface BookingDto {
  id: string;
  status: BookingStatus;
  scheduledAt: Date;
  durationMinutes: number | null;
  address: string | null;
  notes: string | null;
  problemDescription: string | null;
  priceQuote: string | null;
  cancellationReason: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  service: { id: string; name: string } | null;
  provider: { id: string; businessName: string } | null;
  /** Counterparty name — shown to the two parties, never to anyone else. */
  customerName: string | null;
}

interface BookingRow {
  id: string;
  status: string;
  scheduled_at: Date;
  duration_minutes: number | null;
  address: string | null;
  notes: string | null;
  problem_description: string | null;
  price_quote: string | null;
  cancellation_reason: string | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
  service_id: string | null;
  service_name: string | null;
  provider_id: string;
  business_name: string | null;
  customer_name: string | null;
}

const BOOKING_COLUMNS = `
  b.id, b.status, b.scheduled_at, b.duration_minutes, b.address, b.notes,
  b.problem_description, b.price_quote, b.cancellation_reason,
  b.rejection_reason, b.created_at, b.updated_at, b.service_id,
  s.name AS service_name, b.provider_id, p.business_name,
  u.full_name AS customer_name`;

const BOOKING_FROM = `
  FROM bookings b
  LEFT JOIN services s ON s.id = b.service_id
  JOIN provider_profiles p ON p.user_id = b.provider_id
  JOIN users u ON u.id = b.customer_id`;

function toDto(row: BookingRow): BookingDto {
  if (!isBookingStatus(row.status)) {
    throw new HttpError(500, 'Internal server error');
  }
  return {
    id: row.id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    address: row.address,
    notes: row.notes,
    problemDescription: row.problem_description,
    priceQuote: row.price_quote,
    cancellationReason: row.cancellation_reason,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    service: row.service_id ? { id: row.service_id, name: row.service_name ?? 'Service' } : null,
    provider: { id: row.provider_id, businessName: row.business_name ?? 'Provider' },
    customerName: row.customer_name,
  };
}

const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

function isPgCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

/** Human-readable status, so error messages read like English. */
function label(status: BookingStatus): string {
  return status.toLowerCase().replace('_', ' ');
}

/** DB errors → safe, specific 4xx. No SQL text ever reaches the client. */
function translateWriteError(err: unknown): unknown {
  if (isPgCode(err, PG.UNIQUE_VIOLATION)) {
    // The anti double-booking partial unique index fired.
    return new HttpError(
      409,
      'You already have a live booking for this service at that time. Choose another slot.',
    );
  }
  if (isPgCode(err, PG.FOREIGN_KEY_VIOLATION)) {
    return new HttpError(400, 'Invalid request — referenced record is unavailable');
  }
  if (isPgCode(err, PG.CHECK_VIOLATION)) {
    return new HttpError(400, 'Invalid request — a value is outside the allowed range');
  }
  return err;
}

/**
 * Loads a booking ONLY if the caller is one of its two parties.
 *
 * The ownership predicate is in the SQL, keyed on the caller's role:
 *   CUSTOMER → b.customer_id = callerId
 *   PROVIDER → b.provider_id = callerId
 * Anyone else (including an ADMIN) is refused, and a row the caller does not
 * own produces the same 404 as a missing row.
 */
async function loadVisibleBooking(
  role: 'CUSTOMER' | 'PROVIDER',
  callerId: string,
  bookingId: string,
): Promise<BookingDto> {
  const column = role === 'CUSTOMER' ? 'b.customer_id' : 'b.provider_id';
  const res = await pool.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.id = $1 AND ${column} = $2`,
    [bookingId, callerId],
  );
  if (res.rowCount === 0) throw new HttpError(404, 'Booking not found');
  return toDto(res.rows[0]);
}

/** GET /api/bookings/:id — customer or assigned provider. */
export function getBookingForParty(
  role: 'CUSTOMER' | 'PROVIDER',
  callerId: string,
  bookingId: string,
): Promise<BookingDto> {
  return loadVisibleBooking(role, callerId, bookingId);
}

/**
 * The counterparty's user id for a booking the caller can already see.
 *
 * Notifications need to name a RECIPIENT, and the recipient is always the other
 * party on the booking. `BookingDto` deliberately does not expose customer_id or
 * provider_id (it is what the API returns to a client), so this reads the two
 * ids through a separate, narrowly-scoped query.
 *
 * The scoping predicate is the point: it reuses the same visibility rule as
 * `loadVisibleBooking`, so this can only ever return the counterparty of a
 * booking the caller is already entitled to see. It is not a way to discover
 * anything new — if the caller cannot see the booking, this returns null.
 */
async function counterpartyId(
  role: 'CUSTOMER' | 'PROVIDER',
  callerId: string,
  bookingId: string,
): Promise<string | null> {
  const column = role === 'CUSTOMER' ? 'b.customer_id' : 'b.provider_id';
  const other = role === 'CUSTOMER' ? 'b.provider_id' : 'b.customer_id';
  const res = await pool.query<{ other_id: string }>(
    `SELECT ${other} AS other_id FROM bookings b WHERE b.id = $1 AND ${column} = $2`,
    [bookingId, callerId],
  );
  return res.rows[0]?.other_id ?? null;
}

/**
 * POST /api/bookings
 *
 * Validation order matters: the provider is checked before the service, so a
 * caller cannot use error messages to probe service ids belonging to a
 * provider who is not publicly bookable.
 */
export async function createBooking(
  customerId: string,
  input: CreateBookingInput,
): Promise<BookingDto> {
  if (input.providerId === customerId) {
    // The DB CHECK also forbids this; failing here gives a clear message
    // instead of relying on a constraint violation as control flow.
    throw new HttpError(400, 'You cannot book a service from yourself');
  }

  // --- provider must be publicly bookable --------------------------------
  const provider = await pool.query<{
    user_id: string;
    verification_status: string;
    is_active: boolean;
    role: string;
  }>(
    `SELECT p.user_id, p.verification_status, u.is_active, u.role
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1`,
    [input.providerId],
  );
  const profile = provider.rows[0];
  if (!profile || profile.role !== 'PROVIDER') {
    throw new HttpError(404, 'Provider not found');
  }
  if (profile.verification_status !== 'APPROVED' || !profile.is_active) {
    // Deliberately identical to "not found", so this endpoint cannot be used
    // to discover who is pending, rejected or suspended.
    throw new HttpError(404, 'Provider not found');
  }

  // --- service must exist, be active, and belong to that provider ---------
  // One query proves all three, so there is no window in which a service id
  // belonging to another provider could be accepted.
  const service = await pool.query<{
    id: string;
    provider_id: string;
    is_active: boolean;
    duration_minutes: number | null;
    price_from: string;
  }>(
    `SELECT id, provider_id, is_active, duration_minutes, price_from
       FROM services
      WHERE id = $1`,
    [input.serviceId],
  );
  const row = service.rows[0];
  if (!row) {
    throw new HttpError(404, 'Service not found');
  }
  if (row.provider_id !== input.providerId) {
    throw new HttpError(400, 'That service does not belong to the selected provider');
  }
  if (!row.is_active) {
    throw new HttpError(400, 'That service is not currently available');
  }

  const scheduledAt = composeScheduledAt(input.date, input.time);

  // The booking INSERT and BOTH notifications (to the customer and to the
  // provider) share one transaction, so a booking can never exist without the
  // provider knowing about it, and no notification can exist for a booking that
  // was rolled back. `providerId` is the booking's own provider — the only
  // recipient is ever derived from the row we just created.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(
      `INSERT INTO bookings
         (customer_id, provider_id, service_id, status, scheduled_at,
          duration_minutes, address, notes, problem_description, price_quote)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        customerId, // ← the session, never the payload
        input.providerId,
        input.serviceId,
        scheduledAt,
        row.duration_minutes, // snapshot the service's duration onto the booking
        input.address,
        input.notes ?? null,
        input.problemDescription,
        row.price_from, // starting-price snapshot
      ],
    );
    const bookingId = created.rows[0].id;

    await insertNotification(client, {
      userId: customerId,
      type: 'BOOKING_CREATED',
      title: 'Booking request sent',
      message: 'Your request has been sent to the provider. They will confirm shortly.',
      relatedBookingId: bookingId,
    });
    await insertNotification(client, {
      userId: input.providerId,
      type: 'BOOKING_CREATED',
      title: 'New booking request',
      message: 'You have a new booking request waiting for your response.',
      relatedBookingId: bookingId,
    });

    await client.query('COMMIT');
    return loadVisibleBooking('CUSTOMER', customerId, bookingId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw translateWriteError(err);
  } finally {
    client.release();
  }
}


/** GET /api/bookings/my */
export async function listMyBookings(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<{ bookings: BookingDto[]; total: number }> {
  const res = await pool.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
      WHERE b.customer_id = $1
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3`,
    [customerId, pageSize, (page - 1) * pageSize],
  );
  const count = await pool.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM bookings WHERE customer_id = $1',
    [customerId],
  );
  return {
    bookings: res.rows.map(toDto),
    total: Number(count.rows[0]?.total ?? 0),
  };
}

/**
 * GET /api/provider/bookings — the provider's own queue, optionally filtered.
 * PENDING is ordered first so a new request is never buried.
 */
export async function listAssignedBookings(
  providerId: string,
  status: BookingStatus | undefined,
  page: number,
  pageSize: number,
): Promise<{ bookings: BookingDto[]; total: number }> {
  const values: unknown[] = [providerId];
  let filter = '';
  if (status) {
    values.push(status);
    filter = 'AND b.status = $2';
  }

  const res = await pool.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}
      WHERE b.provider_id = $1 ${filter}
      ORDER BY
        CASE b.status WHEN 'PENDING' THEN 0 ELSE 1 END,
        b.scheduled_at ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );

  // Count without the joins — the filter uses bare column names here.
  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM bookings
      WHERE provider_id = $1 ${status ? 'AND status = $2' : ''}`,
    values,
  );
  return { bookings: res.rows.map(toDto), total: Number(countRes.rows[0]?.total ?? 0) };
}

/**
 * PATCH /api/bookings/:id/cancel
 *
 * The customer may cancel only their own booking, only from PENDING or
 * ACCEPTED, and only into CANCELLED. A `status` field in the body is rejected
 * by the strict schema, so there is no way to "cancel" into another state.
 */
export async function cancelBooking(
  customerId: string,
  bookingId: string,
  input: CancelBookingInput,
): Promise<BookingDto> {
  const current = await loadVisibleBooking('CUSTOMER', customerId, bookingId);

  // The provider is the counterparty on this booking — resolved server-side from
  // the booking row, never from the request.
  const providerUserId = await counterpartyId('CUSTOMER', customerId, bookingId);
  if (!providerUserId) throw new HttpError(404, 'Booking not found');

  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(current.status)) {
    throw new HttpError(409, `A booking that is ${label(current.status)} can no longer be cancelled`);
  }
  if (!canTransition(current.status, 'CANCELLED')) {
    throw new HttpError(409, `Cannot move a booking from ${label(current.status)} to cancelled`);
  }

  // Guarded update: the status must still be what we read, so a concurrent
  // provider action cannot be silently overwritten. The status change and the
  // provider's notification share one transaction, so the provider can never be
  // told about a cancellation that did not commit (and vice versa).
  //
  // The notification is inserted ONLY after rowCount > 0. That is the duplicate
  // guard: a repeated or raced cancellation loses the guard, throws 409, and
  // never reaches the insert — so no second notification is possible without a
  // uniqueness constraint.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<{ id: string }>(
      `UPDATE bookings
          SET status = 'CANCELLED', cancellation_reason = $3
        WHERE id = $1 AND customer_id = $2 AND status = $4
        RETURNING id`,
      [bookingId, customerId, input.reason, current.status],
    );
    if (updated.rowCount === 0) {
      throw new HttpError(409, 'Booking changed while you were cancelling it — please refresh');
    }
    // The provider is the counterparty on this booking, not a request value.
    await insertNotification(client, {
      userId: providerUserId,
      type: 'BOOKING_CANCELLED',
      title: 'Booking cancelled',
      message: 'A customer cancelled a booking on your schedule.',
      relatedBookingId: bookingId,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return loadVisibleBooking('CUSTOMER', customerId, bookingId);
}

/**
 * PATCH /api/provider/bookings/:id/status
 *
 * The provider may act only on their own queue, and only into one of the four
 * provider-actionable statuses. The current status is read first (which also
 * proves ownership), checked against the state machine, then written with a
 * guarded UPDATE.
 */
export async function updateBookingStatusByProvider(
  providerId: string,
  bookingId: string,
  input: ProviderStatusInput,
): Promise<BookingDto> {
  const current = await loadVisibleBooking('PROVIDER', providerId, bookingId);
  const target = input.status;

  // The customer is the counterparty — resolved from the booking row, never
  // from the request. Only needed when the transition notifies them.
  let customerUserId: string | null = null;

  if (!canTransition(current.status, target)) {
    const allowed = BOOKING_TRANSITIONS[current.status];
    throw new HttpError(
      409,
      allowed.length === 0
        ? `This booking is ${label(current.status)} and can no longer change`
        : `Cannot go from ${label(current.status)} to ${label(target)}. ` +
            `Allowed next: ${allowed.map(label).join(', ')}`,
    );
  }

  // The DB requires a non-NULL rejection_reason whenever status = REJECTED.
  const rejectionReason = target === 'REJECTED' ? (input.reason ?? null) : null;

  // Which notification the CUSTOMER gets for this transition. A provider action
  // never notifies the provider, and CANCELLED is not reachable from here (it is
  // the customer's action, handled in cancelBooking above).
  const customerNotification = providerTransitionNotification(target);
  if (customerNotification) {
    customerUserId = await counterpartyId('PROVIDER', providerId, bookingId);
  }

  // Status change + notification in one transaction. The insert happens only
  // after the guarded UPDATE matched a row, so a repeated or raced transition
  // loses the guard, throws 409, and never notifies — which is what makes
  // "exactly one notification per transition" true without a uniqueness index.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<{ id: string }>(
      `UPDATE bookings
          SET status = $3,
              rejection_reason = COALESCE($4, rejection_reason)
        WHERE id = $1 AND provider_id = $2 AND status = $5
        RETURNING id`,
      [bookingId, providerId, target, rejectionReason, current.status],
    );
    if (updated.rowCount === 0) {
      throw new HttpError(409, 'Booking changed while you were updating it — please refresh');
    }
    if (customerNotification && customerUserId) {
      // The customer is the counterparty on this booking, not a request value.
      await insertNotification(client, {
        userId: customerUserId,
        type: customerNotification.type,
        title: customerNotification.title,
        // A rejection tells the customer why; the reason was required by the
        // schema, so it is always present here.
        message:
          customerNotification.type === 'BOOKING_REJECTED' && rejectionReason
            ? `The provider could not take this booking: ${rejectionReason}`
            : customerNotification.message,
        relatedBookingId: bookingId,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return loadVisibleBooking('PROVIDER', providerId, bookingId);
}

/**
 * The notification a provider action sends to the customer, or null when the
 * transition does not warrant one.
 *
 * `map` is used rather than an object index because the parameter is a union,
 * and a missing key should be a compile error rather than a silent undefined.
 */
function providerTransitionNotification(
  target: ProviderStatusInput['status'],
): { type: 'BOOKING_ACCEPTED' | 'BOOKING_REJECTED' | 'BOOKING_IN_PROGRESS' | 'BOOKING_COMPLETED'; title: string; message: string } | null {
  switch (target) {
    case 'ACCEPTED':
      return {
        type: 'BOOKING_ACCEPTED',
        title: 'Your booking was accepted',
        message: 'The provider accepted your booking. They will start work on the agreed date.',
      };
    case 'REJECTED':
      return {
        type: 'BOOKING_REJECTED',
        title: 'Your booking was declined',
        message: 'The provider could not take this booking.',
      };
    case 'IN_PROGRESS':
      return {
        type: 'BOOKING_IN_PROGRESS',
        title: 'Your service is now in progress',
        message: 'The provider has started work on your booking.',
      };
    case 'COMPLETED':
      return {
        type: 'BOOKING_COMPLETED',
        title: 'Your service has been completed',
        message: 'The provider marked this booking complete. You can now leave a review.',
      };
  }
}

