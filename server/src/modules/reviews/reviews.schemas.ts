import { z } from 'zod';

/**
 * POST /api/reviews (ADR-028).
 *
 * `.strict()` on purpose: a body carrying `customerId`, `providerId`,
 * `userId` or `reviewerId` is rejected outright rather than silently ignored.
 * Silently ignoring it would leave the client looking as though it could choose
 * the reviewer; rejecting it makes the mistake obvious immediately.
 *
 * The reviewer and the reviewed provider are NEVER taken from here. Both are
 * derived server-side from the booking row the caller's session is scoped to.
 */
export const createReviewSchema = z
  .object({
    bookingId: z.string().uuid('must be a valid UUID'),
    rating: z
      .number({ invalid_type_error: 'must be a number' })
      .int('must be a whole number of stars')
      .min(1, 'must be between 1 and 5')
      .max(5, 'must be between 1 and 5'),
    comment: z
      .string()
      .trim()
      // Mirrors the DB CHECK `length(trim(comment)) <= 2000`. A comment that is
      // only whitespace trims to '' and is stored as NULL by the service.
      .max(2000, 'must be at most 2000 characters')
      .nullable()
      .optional(),
  })
  .strict();

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
