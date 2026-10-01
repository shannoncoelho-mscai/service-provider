import { z } from 'zod';

/**
 * GET /api/notifications query.
 *
 * `.strict()` so a caller cannot smuggle a `userId` in to read somebody
 * else's notifications — the query is only ever about the session user, and an
 * unrecognised parameter is far more likely to be an attack than a feature.
 */
export const notificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
    // Accepts the usual query-string spellings; normalised to a boolean.
    unreadOnly: z
      .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
      .transform((v) => v === 'true' || v === '1')
      .optional(),
  })
  .strict();

/** :id path param — a non-UUID fails fast with a 400 rather than a DB error. */
export const notificationIdParamSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
});
