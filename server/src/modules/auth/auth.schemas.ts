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

const providerDetails = z.object({
  businessName: z.string().trim().min(2, 'must be at least 2 characters').max(120),
  city: z.string().trim().min(2, 'must be at least 2 characters').max(80),
  description: z.string().trim().max(2000).optional(),
  hourlyRate: z.coerce.number().positive().max(10_000).optional(),
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
