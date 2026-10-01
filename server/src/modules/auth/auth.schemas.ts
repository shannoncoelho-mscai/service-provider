import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../../lib/password';

/**
 * Request schemas for /api/auth (validation happens server-side only —
 * the frontend's own validation is UX, never a security control).
 */

const email = z.string().trim().toLowerCase().email().max(254);
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128, 'must be at most 128 characters');
const fullName = z.string().trim().min(2, 'must be at least 2 characters').max(100);
const phone = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'must be a valid phone number')
    .optional(),
);

/**
 * Provider business details collected at sign-up.
 *
 * Every field is optional except `businessName` and `city`: a provider should
 * be able to create an account in under a minute and then complete the rest of
 * their profile from the dashboard via PATCH /api/providers/me, which already
 * accepts the same fields. Registration is not the only chance to supply them.
 *
 * `serviceAreas` and `yearsExperience` are accepted here so the business can
 * state its coverage and experience up front — both are surfaced to the admin
 * on the verification screen. Nothing here sets a verification status: the
 * INSERT omits `verification_status` so the column DEFAULT 'PENDING' applies
 * (ADR-030). A new provider is never public.
 */
const providerDetails = z.object({
  businessName: z.string().trim().min(2, 'must be at least 2 characters').max(120),
  city: z.string().trim().min(2, 'must be at least 2 characters').max(80),
  description: z.string().trim().max(2000).optional(),
  /** Contact number for the business. Falls back to the account phone if absent. */
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'must be a valid phone number')
    .optional(),
  /** Nearby towns the provider will travel to. */
  serviceAreas: z
    .array(z.string().trim().min(2).max(80))
    .max(30, 'must be at most 30 service areas')
    .optional(),
  yearsExperience: z.coerce
    .number()
    .int('must be a whole number of years')
    .min(0, 'must be at least 0')
    .max(60, 'must be at most 60')
    .optional(),
  /** Indicative starting rate in rupees. Stored as a plain number, never a string. */
  hourlyRate: z.coerce.number().positive().max(10_000_000).optional(),
});

export const registerSchema = z
  .object({
    email,
    password,
    fullName,
    phone,
    // NOTE: ADMIN is deliberately absent — public registration can only
    // create CUSTOMER or PROVIDER accounts (admin accounts are provisioned
    // out-of-band; see docs/SECURITY.md).
    role: z.enum(['CUSTOMER', 'PROVIDER']),
    provider: providerDetails.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'PROVIDER' && !data.provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'provider details are required for provider registration',
      });
    }
    if (data.role === 'CUSTOMER' && data.provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'provider details are only valid for provider registration',
      });
    }
  });

export const loginSchema = z.object({
  email,
  // Min length NOT enforced on login: legacy accounts may predate the policy.
  password: z.string().min(1, 'is required').max(128, 'must be at most 128 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
