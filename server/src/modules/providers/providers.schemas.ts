import { z } from 'zod';

const url = z.string().trim().url().regex(/^https?:\/\//, 'must be an http(s) URL');
const shortText = (max: number) => z.string().trim().min(2).max(max);

/**
 * PATCH /api/providers/me — STRICT on purpose:
 * unknown keys are rejected with 400, so a provider cannot smuggle
 * `verificationStatus`, `isPublic`, `verifiedBy` or another user's `userId`
 * into the request (security rule: only ADMIN changes verification status,
 * and providers can only edit their own profile — ADR-018).
 * Nullable fields accept `null` to clear a value.
 */
export const updateProviderSchema = z
  .object({
    businessName: shortText(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'must be a valid phone number')
      .nullable()
      .optional(),
    city: shortText(80).optional(),
    address: z.string().trim().max(200).nullable().optional(),
    serviceAreas: z.array(shortText(80)).max(30).optional(),
    yearsExperience: z.number().int().min(0).max(60).optional(),
    hourlyRate: z.coerce.number().positive().max(10_000).nullable().optional(),
    profileImageUrl: url.nullable().optional(),
    coverImageUrl: url.nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one field must be provided',
      });
    }
  });

export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

/** URL param guard — non-UUID ids fail fast with 400. */
export const providerIdParamSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
});

/** PATCH /api/admin/providers/:id/reject — reason required. */
export const rejectSchema = z
  .object({
    reason: z.string().trim().min(5, 'must be at least 5 characters').max(500),
  })
  .strict();

/** PATCH /api/admin/providers/:id/suspend — reason optional. */
export const suspendSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(5, 'must be at least 5 characters')
      .max(500)
      .optional(),
  })
  .strict();

/** PATCH /api/admin/providers/:id/approve — optional audit note. */
export const approveSchema = z
  .object({
    note: z.string().trim().min(2).max(500).optional(),
  })
  .strict();
