import type { ZodTypeAny } from 'zod';
import { HttpError } from './httpError';

/** Validate URL params (e.g. `:id`) the same way bodies are validated. */
export function parseParams<S extends ZodTypeAny>(schema: S, data: unknown): S['_output'] {
  const result = schema.safeParse(data);
  if (result.success) return result.data as S['_output'];

  const details = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
    .join('; ');
  throw new HttpError(400, `Invalid request — ${details}`);
}

/**
 * Validate request bodies with zod and convert failures into a safe 400.
 * Messages only echo validation rules (field names + constraints) —
 * they never reflect whether an account or credential exists.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, data: unknown): S['_output'] {
  const result = schema.safeParse(data);
  if (result.success) return result.data as S['_output'];

  const details = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
  throw new HttpError(400, `Invalid request — ${details}`);
}
