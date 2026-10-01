import { z } from 'zod';

/**
 * Provider service management schemas (ADR-020).
 *
 * STRICT on purpose: unknown keys are rejected with 400 so a provider cannot
 * smuggle `providerId`/`id` (or any other column) into the body and re-target
 * somebody else's row. Ownership is never read from the payload — it comes
 * from the verified token (req.user.id) and is applied as a WHERE predicate.
 */

/** Money: finite, non-negative, ≤ 1,000,000, max 2 decimals (NUMERIC(10,2)). */
const money = z
  .number({ invalid_type_error: 'must be a number' })
  .finite('must be a finite number')
  .min(0, 'must be 0 or greater')
  .max(1_000_000, 'must be at most 1000000')
  .refine((n) => Math.round(n * 100) === n * 100, 'must have at most 2 decimal places');

/** Estimated duration in minutes: 15 min … 24 h. */
const duration = z
  .number({ invalid_type_error: 'must be a number' })
  .int('must be a whole number of minutes')
  .min(15, 'must be at least 15 minutes')
  .max(1440, 'must be at most 1440 minutes (24h)');

/** Service name: 3–120 chars after trimming (mirrors chk_services_name). */
const serviceName = z
  .string({ invalid_type_error: 'must be a string' })
  .trim()
  .min(3, 'must be at least 3 characters')
  .max(120, 'must be at most 120 characters');

const serviceDescription = z
  .string({ invalid_type_error: 'must be a string' })
  .trim()
  .max(2000, 'must be at most 2000 characters')
  .nullable();

/** POST /api/providers/me/services */
export const createServiceSchema = z
  .object({
    categoryId: z.string().uuid('must be a valid UUID'),
    name: serviceName,
    description: serviceDescription.optional(),
    priceFrom: money,
    priceTo: money.nullable().optional(),
    durationMinutes: duration.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.priceTo != null && data.priceTo < data.priceFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceTo'],
        message: 'must be greater than or equal to priceFrom',
      });
    }
  });

/** PATCH /api/providers/me/services/:id — every field optional, ≥ 1 required. */
export const updateServiceSchema = z
  .object({
    categoryId: z.string().uuid('must be a valid UUID').optional(),
    name: serviceName.optional(),
    description: serviceDescription.optional(),
    priceFrom: money.optional(),
    priceTo: money.nullable().optional(),
    durationMinutes: duration.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one field must be provided',
      });
    }
    // When both ends of the range are present, check the invariant here.
    // When only one is present the service layer re-checks it against the
    // stored value (see updateService) so a partial update cannot invert it.
    if (data.priceFrom != null && data.priceTo != null && data.priceTo < data.priceFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceTo'],
        message: 'must be greater than or equal to priceFrom',
      });
    }
  });

/** :id path param — a non-UUID fails fast with 400. */
export const serviceIdParamSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;