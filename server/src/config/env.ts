import { z } from 'zod';
import 'dotenv/config';

/**
 * Environment is validated ONCE at boot with zod.
 * The process refuses to start on invalid/missing configuration so that a
 * misconfigured deployment fails fast instead of running insecurely.
 * Values come only from process.env — never from source code.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
  // Token/session lifetime, e.g. 15m, 1h, 24h — enforced by JWTs AND
  // auth_sessions.expires_at (see docs/AI_DECISION_LOG.md ADR-015).
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 15m, 1h or 24h')
    .default('1h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const [key, issues] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`   ${key}: ${issues?.join(', ')}`);
  }
  console.error('   See server/.env.example for the required variables.');
  process.exit(1);
}

export const env = parsed.data;
