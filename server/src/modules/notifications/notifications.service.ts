import type { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import { isNotificationType, type NotificationType } from '../../shared/types';

/**
 * In-app notifications (ADR-029).
 *
 * A notification is a short, user-facing sentence about something that already
 * happened to a booking. Two rules govern this whole file:
 *
 * 1. RECIPIENTS ARE NEVER CHOSEN BY A CALLER. Every insert is internal and
 *    takes the user id from the business logic that caused the event — a
 *    booking's `customer_id` or `provider_id`. There is no public "create a
 *    notification" endpoint, so there is no body in which a recipient, a type, a
 *    title or a message could be supplied by a client.
 *
 * 2. NO SENSITIVE DATA. Titles and messages are written here, in code, and
 *    carry no email, phone, address, password, hash, token or session id. The
 *    length CHECKs on the table are the backstop.
 *
 * Reads are all scoped to `userId`. There is deliberately no admin-wide listing
 * and no "notify an arbitrary user" function.
 */

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedBookingId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  related_booking_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, type, title, message, related_booking_id, read_at, created_at`;

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    // Narrow defensively: a row can only hold a valid enum value, but the DTO
    // promises a NotificationType and the client switches on it.
    type: isNotificationType(row.type) ? row.type : 'BOOKING_CREATED',
    title: row.title,
    message: row.message,
    relatedBookingId: row.related_booking_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * Insert a notification using the given connection.
 *
 * The `client` parameter is the whole point: callers pass the SAME pooled
 * connection that is inside their booking transaction, so the notification and
 * the state change commit or roll back together. A notification can therefore
 * never describe a transition that was rolled back, and a booking change can
 * never commit without its notification.
 *
 * The type is re-validated here so a typo in server code fails loudly instead
 * of producing a row the client cannot render.
 */
export async function insertNotification(
  client: PoolClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedBookingId?: string | null;
  },
): Promise<void> {
  if (!isNotificationType(input.type)) {
    throw new Error(`Unknown notification type: ${input.type}`);
  }
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, related_booking_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.type, input.title, input.message, input.relatedBookingId ?? null],
  );
}

/* ------------------------------------------------------------------ reads -- */

/** GET /api/notifications — the caller's own notifications, newest first. */
export async function listNotifications(
  userId: string,
  options: { page: number; pageSize: number; unreadOnly: boolean },
): Promise<{ notifications: NotificationDto[]; total: number }> {
  const where = options.unreadOnly ? ' AND read_at IS NULL' : '';
  const limit = options.pageSize;
  const offset = (options.page - 1) * options.pageSize;

  const rows = await pool.query<NotificationRow>(
    `SELECT ${COLUMNS}
       FROM notifications
      WHERE user_id = $1${where}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM notifications WHERE user_id = $1${where}`,
    [userId],
  );
  return { notifications: rows.rows.map(toDto), total: Number(count.rows[0].total) };
}

/** GET /api/notifications/unread-count. */
export async function unreadCount(userId: string): Promise<number> {
  const res = await pool.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return Number(res.rows[0].total);
}

/**
 * PATCH /api/notifications/:id/read
 *
 * Scoped to BOTH the id and the caller's user_id in a single UPDATE, so another
 * user's notification is indistinguishable from one that does not exist — a 404
 * with rowCount 0 either way. A SELECT-then-UPDATE would leak existence through
 * a distinguishable error.
 *
 * Marking an already-read notification is a no-op that still answers 200, so a
 * double-click on a notification is harmless.
 */
export async function markRead(userId: string, notificationId: string): Promise<NotificationDto> {
  const res = await pool.query<NotificationRow>(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [notificationId, userId],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'Notification not found');
  return toDto(row);
}

/**
 * PATCH /api/notifications/read-all
 *
 * Scoped to the caller: it can only ever mark the caller's own notifications
 * read, so "mark all" is not a way to affect anybody else.
 */
export async function markAllRead(userId: string): Promise<number> {
  const res = await pool.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return res.rowCount ?? 0;
}
