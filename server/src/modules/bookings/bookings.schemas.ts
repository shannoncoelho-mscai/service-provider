import { z } from 'zod';
import { BOOKING_STATUSES, PROVIDER_SETTABLE_STATUSES } from '../../shared/types';

/**
 * Booking request validation (ADR-023).
 *
 * STRICT schemas: unknown keys are rejected with 400, so a client cannot smuggle
 * `customerId`, `status` or `priceQuote` into the body. The customer is always
 * taken from the verified session, never from the payload.
 */

/** `YYYY-MM-DD`, checked for a real calendar date (rejects 2026-02-31). */
const date = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'is not a valid calendar date');

/** `HH:MM` on a 24-hour clock, 00:00?23:59. */
const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'must be a 24-hour time in HH:MM format');

/**
 * Composes `date` + `time` into an instant.
 *
 * Treated as UTC deliberately: the API stores an absolute instant, and a
 * server-side local-time interpretation would shift bookings by the server's
 * timezone. The client is responsible for converting the visitor's local
 * selection to UTC before submitting.
 */
export function composeScheduledAt(dateValue: string, timeValue: string): Date {
  return new Date(`${dateValue}T${timeValue}:00.000Z`);
}

const address = z
  .string()
  .trim()
  .min(5, 'must be at least 5 characters')
  .max(300, 'must be at most 300 characters');

const notes = z.string().trim().max(1000, 'must be at most 1000 characters').nullable().optional();

/** POST /api/bookings */
export const createBookingSchema = z
  .object({
    // Client-selected, but fully validated server-side (must be APPROVED, must
    // own the service, must not be the customer).
    providerId: z.string().uuid('must be a valid UUID'),
    serviceId: z.string().uuid('must be a valid UUID'),
    date,
    time,
    problemDescription: z
      .string()
      .trim()
      .min(3, 'must be at least 3 characters')
      .max(2000, 'must be at most 2000 characters'),
    address,
    notes,
  })
  .strict()
  .superRefine((data, ctx) => {
    const when = composeScheduledAt(data.date, data.time);
    const now = Date.now();

    if (Number.isNaN(when.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: 'is not a valid date' });
      return;
    }

    // 5 minutes of tolerance absorbs ordinary client/server clock drift while
    // still refusing genuinely past slots.
    if (when.getTime() < now - 5 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date'],
        message: 'must be a future date and time',
      });
    }

    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (when.getTime() > now + oneYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date'],
        message: 'must be within the next year',
      });
    }
  });

/** PATCH /api/bookings/:id/cancel */
export const cancelBookingSchema = z
  .object({
    // The DB CHECK requires a non-NULL cancellation_reason for CANCELLED, so
    // this is mandatory rather than optional.
    reason: z
      .string()
      .trim()
      .min(3, 'must be at least 3 characters')
      .max(500, 'must be at most 500 characters'),
  })
  .strict();

/**
 * PATCH /api/provider/bookings/:id/status
 *
 * Restricted to the four provider-actionable statuses. CANCELLED is absent on
 * purpose: a provider does not cancel ? the customer does.
 */
export const providerStatusSchema = z
  .object({
    status: z.enum(
      PROVIDER_SETTABLE_STATUSES.filter((s) => s !== 'CANCELLED') as [
        'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED',
      ],
      { message: 'must be one of ACCEPTED, REJECTED, IN_PROGRESS, COMPLETED' },
    ),
    // Required by the DB CHECK when rejecting; allowed (and recorded) otherwise.
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === 'REJECTED' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'a reason is required when rejecting a booking',
      });
    }
  });

/** :id path param ? a non-UUID fails fast with 400. */
export const bookingIdParamSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
});

/** Optional `status` filter on the provider's booking queue. */
export const bookingListQuerySchema = z
  .object({
    status: z.enum(BOOKING_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type ProviderStatusInput = z.infer<typeof providerStatusSchema>;
