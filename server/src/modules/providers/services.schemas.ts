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

/**
 * Category selection for a service (ADR-031).
 *
 * A provider may either pick an EXISTING category by id, or type a NEW one.
 * Two fields rather than a free-text `categoryId`: `category_id` is a UUID FK
 * with ON DELETE RESTRICT, so arbitrary provider text must never be written
 * into it. Free text is resolved to (or creates) a real `service_categories`
 * row server-side — see `findOrCreateCategory`.
 *
 * The id is never trusted from the client beyond "does this category exist and
 * is it active": it is a lookup, not an authorisation decision. Ownership of the
 * SERVICE is always `req.user.id`.
 */
const categoryId = z.string().uuid('must be a valid UUID');
const categoryName = z
  .string({ invalid_type_error: 'must be a string' })
  .trim()
  .min(2, 'must be at least 2 characters')
  .max(80, 'must be at most 80 characters');

/**
 * Exactly one selector: sending both is ambiguous, sending neither leaves the
 * service uncategorised (which the column forbids, so create must supply one).
 */
function checkCategorySelector(
  data: { categoryId?: string; categoryName?: string },
  ctx: z.RefinementCtx,
  required: boolean,
): void {
  const hasId = data.categoryId !== undefined;
  const hasText = data.categoryName !== undefined;
  if (hasId && hasText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['categoryName'],
      message: 'provide either categoryId or categoryName, not both',
    });
    return;
  }
  if (required && !hasId && !hasText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['categoryId'],
      message: 'provide categoryId for an existing category, or categoryName for a new one',
    });
  }
}

/** POST /api/providers/me/services */
export const createServiceSchema = z
  .object({
    categoryId: categoryId.optional(),
    categoryName: categoryName.optional(),
    name: serviceName,
    description: serviceDescription.optional(),
    priceFrom: money,
    priceTo: money.nullable().optional(),
    durationMinutes: duration.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    checkCategorySelector(data, ctx, true);
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
    categoryId: categoryId.optional(),
    categoryName: categoryName.optional(),
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
    // Omitting BOTH category fields simply means "leave the category alone".
    checkCategorySelector(data, ctx, false);
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

/** Both ids on a service-image route: which service, and which image. */
export const serviceImageParamsSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
  imageId: z.string().uuid('must be a valid UUID'),
});

/**
 * Multipart text fields for a service-image upload (Phase 21).
 *
 * STRICT for the same reason as every schema here: `serviceId` or `providerId`
 * in the body would be ignored at best. Ownership is proven from the URL's
 * `:id` against the SESSION's provider, never from the payload.
 */
export const uploadServiceImagesSchema = z
  .object({
    altText: z.string().trim().max(200, 'must be at most 200 characters').optional(),
  })
  .strict();

export type UploadServiceImagesInput = z.infer<typeof uploadServiceImagesSchema>;

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;