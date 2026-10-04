import { z } from 'zod';

/**
 * Provider image-management schemas (Phase 20).
 *
 * STRICT, like every other schema here: unknown keys are rejected so a client
 * cannot smuggle `providerId` in and re-target a row it does not own.
 * Ownership is never read from the payload.
 */

/** URL param guard — a non-UUID image id fails fast with 400. */
export const imageIdParamSchema = z.object({
  id: z.string().uuid('must be a valid UUID'),
});

/**
 * Multipart text fields that accompany the files.
 *
 * `isPrimary` is an INTENT, not a fact: the service layer only honours it for a
 * provider's very first image, because `uq_provider_images_primary` permits
 * exactly one primary per provider.
 */
export const uploadImagesSchema = z
  .object({
    altText: z.string().trim().max(200, 'must be at most 200 characters').optional(),
    isPrimary: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export type UploadImagesInput = z.infer<typeof uploadImagesSchema>;