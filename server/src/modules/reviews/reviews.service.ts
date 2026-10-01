import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import { insertNotification } from '../notifications/notifications.service';
import type { CreateReviewInput } from './reviews.schemas';

/**
 * Customer reviews (ADR-028).
 *
 * THE EXISTING SCHEMA IS REUSED UNCHANGED. `reviews` was created in migration
 * 004 and already enforces, at the database level:
 *   - `booking_id ... UNIQUE`                     -> one review per booking
 *   - `rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5)`
 *   - `FOREIGN KEY (booking_id, customer_id) REFERENCES bookings (id, customer_id)`
 *   - `FOREIGN KEY (booking_id, provider_id) REFERENCES bookings (id, provider_id)`
 *   - `CHECK (customer_id <> provider_id)`
 *   - `CHECK (comment IS NULL OR length(trim(comment)) <= 2000)`
 *
 * Those composite foreign keys are the important part: they make it IMPOSSIBLE
 * to store a review whose customer or provider disagrees with the booking, even
 * if this service had a bug. The application checks below exist to return a good
 * error message, not to be the only thing standing in the way.
 *
 * IDENTITY
 *   The reviewer is ALWAYS `req.user.id`. The reviewed provider is ALWAYS the
 *   booking's `provider_id`. Neither can be influenced by the request body.
 */

export interface ReviewDto {
  id: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  /** The reviewed business name, so "my reviews" is readable. */
  providerName: string | null;
  serviceName: string | null;
  /** The booking's status, so the UI can show the completed context. */
  bookingStatus: string | null;
}

interface ReviewRow {
  id: string;
  booking_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
  business_name: string | null;
  service_name: string | null;
  booking_status: string | null;
}

const REVIEW_SELECT = `
  SELECT r.id, r.booking_id, r.rating, r.comment, r.created_at,
         p.business_name, s.name AS service_name, b.status AS booking_status
    FROM reviews r
    JOIN bookings b      ON b.id = r.booking_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN provider_profiles p ON p.user_id = r.provider_id`;

/**
 * Reviews for the authenticated customer, newest first.
 *
 * Joins the booking so the UI can say WHICH booking a review belongs to without
 * a second request per review.
 */
export async function listMyReviews(customerId: string): Promise<ReviewDto[]> {
  const res = await pool.query<ReviewRow>(
    `${REVIEW_SELECT} WHERE r.customer_id = $1 ORDER BY r.created_at DESC`,
    [customerId],
  );
  return res.rows.map(toDto);
}

/**
 * Create a review for a booking.
 *
 * The booking is loaded scoped to the caller, so another customer's booking is
 * a 404 - indistinguishable from a booking that does not exist, which stops the
 * endpoint being used to probe for booking ids.
 */
export async function createReview(
  customerId: string,
  input: CreateReviewInput,
): Promise<ReviewDto> {
  const booking = await pool.query<{ id: string; status: string; provider_id: string }>(
    `SELECT id, status, provider_id FROM bookings WHERE id = $1 AND customer_id = $2`,
    [input.bookingId, customerId],
  );
  const row = booking.rows[0];
  if (!row) throw new HttpError(404, 'Booking not found');

  if (row.status !== 'COMPLETED') {
    // Not a 403: the caller DOES own this booking, they are simply early. 409
    // says "wrong state, please refresh", which is what actually happened.
    throw new HttpError(409, 'You can only review a booking once the provider has completed it.');
  }
  // The reviewed provider is the booking's provider - read here so the
  // notification below has a recipient derived from the booking, not the body.
  const providerId = row.provider_id;


  // A comment that is only whitespace is stored as NULL rather than as ''.
  const comment = input.comment && input.comment.trim() ? input.comment.trim() : null;

  // The review INSERT and the provider notification share one transaction, so
  // a review can never commit without the provider knowing, and a notification
  // can never exist for a review that was rolled back.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // customer_id and provider_id come from the BOOKING row, never the body.
    // The composite FKs then guarantee the stored pair still matches it.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment)
       SELECT b.id, b.customer_id, b.provider_id, $2, $3
         FROM bookings b
        WHERE b.id = $1 AND b.customer_id = $4
       RETURNING id`,
      [input.bookingId, input.rating, comment, customerId],
    );
    const created = inserted.rows[0];
    // The SELECT above found a row, so this is normally unreachable. If the
    // booking vanished mid-request there is nothing sensible to return.
    if (!created) throw new HttpError(404, 'Booking not found');

    // The message deliberately does NOT name the customer. Reviews are anonymous
    // everywhere in this app, and a notification that leaked the reviewer name
    // would undo that in the one place the customer cannot see it.
    await insertNotification(client, {
      userId: providerId,
      type: 'REVIEW_SUBMITTED',
      title: 'New review received',
      message: `A customer left a ${input.rating}-star review on a completed booking.`,
      relatedBookingId: input.bookingId,
    });

    await client.query('COMMIT');
    return loadReview(created.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw translateWriteError(err);
  } finally {
    client.release();
  }
}

async function loadReview(id: string): Promise<ReviewDto> {
  const res = await pool.query<ReviewRow>(`${REVIEW_SELECT} WHERE r.id = $1`, [id]);
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'Review not found');
  return toDto(row);
}

function toDto(row: ReviewRow): ReviewDto {
  return {
    id: row.id,
    bookingId: row.booking_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    providerName: row.business_name,
    serviceName: row.service_name,
    bookingStatus: row.booking_status,
  };
}

/** Turn Postgres constraint failures into clean HTTP errors, never SQL text. */
function translateWriteError(err: unknown): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') {
    // reviews_booking_id_key: one review per booking.
    return new HttpError(409, 'You have already reviewed this booking.');
  }
  if (code === '23514') {
    // A CHECK failed: rating out of range, or comment too long.
    return new HttpError(400, 'That review is not valid.');
  }
  if (code === '23503') {
    // A composite foreign key disagreed with the booking.
    return new HttpError(400, 'Invalid request -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- the referenced booking is unavailable');
  }
  return err;
}
