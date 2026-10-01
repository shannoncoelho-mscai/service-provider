import { z } from 'zod';

/**
 * Query-string validation for GET /api/providers (ADR-021).
 *
 * Everything arrives as a STRING, so each field is coerced explicitly and
 * bounded. Unknown keys are rejected so a typo (`minprice=50`) fails loudly
 * instead of silently returning unfiltered results — and so nothing reaches
 * the SQL builder that was not vetted here.
 */

const trimmed = (max: number) =>
  z
    .string({ invalid_type_error: 'must be a string' })
    .trim()
    .transform((v) => v.slice(0, max));

/** Rejects empty-after-trim values that would otherwise match everything. */
const nonEmpty = (max: number) =>
  trimmed(max).refine((v) => v.length > 0, 'must not be empty');

/** Accepts "true"/"false"/"1"/"0" (query strings are never real booleans). */
const booleanish = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (v) => ['true', 'false', '1', '0'].includes(v),
    'must be true or false',
  )
  .transform((v) => v === 'true' || v === '1');

/**
 * A money bound. `0` is allowed — "free and up" is a meaningful lower bound —
 * but negatives and sloppy decimals are not. The value is returned as a
 * NUMBER and always bound as a parameter, never concatenated into SQL.
 */
const moneyBound = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'must be a non-negative amount with up to 2 decimals')
  .transform(Number)
  .refine((n) => n >= 0, 'must be 0 or greater')
  .refine((n) => n <= 1_000_000, 'must be at most 1000000');

const page = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/, 'must be a whole number')
  .transform(Number)
  .refine((n) => n >= 1, 'must be 1 or greater')
  .refine((n) => n <= 10_000, 'must be at most 10000')
  .refine((n) => Number.isSafeInteger(n), 'must be a whole number');

/** Hard ceiling so a client cannot ask for the whole table in one page. */
const MAX_PAGE_SIZE = 50;

const pageSize = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, 'must be a whole number')
  .transform(Number)
  .refine((n) => n >= 1, 'must be 1 or greater')
  .refine((n) => n <= MAX_PAGE_SIZE, `must be at most ${MAX_PAGE_SIZE}`);

/** Sort keys map to fixed SQL fragments — never to interpolated input. */
export const SORT_FIELDS = ['rating', 'price', 'newest'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Only the three the spec asks for; `newest` is the default. */
export const providerSearchQuerySchema = z
  .object({
    // Free text over business name + description (trigram-indexed).
    keyword: nonEmpty(120).optional(),
    // Category slug (e.g. "plumbing") — resolved server-side, never trusted
    // as an id and never interpolated into SQL.
    category: nonEmpty(80).optional(),
    // City or service area, matched case-insensitively.
    location: nonEmpty(120).optional(),
    minPrice: moneyBound.optional(),
    maxPrice: moneyBound.optional(),
    // Minimum average rating, 0–5.
    rating: z
      .string()
      .trim()
      .regex(/^\d(\.\d)?$/, 'must be a number between 0 and 5')
      .transform(Number)
      .refine((n) => n >= 0 && n <= 5, 'must be between 0 and 5')
      .optional(),
    // Scoped availability: has at least one active service.
    availability: booleanish.optional(),
    sort: z.enum(SORT_FIELDS).optional(),
    order: z.enum(SORT_ORDERS).optional(),
    page: page.optional(),
    pageSize: pageSize.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.minPrice != null && data.maxPrice != null && data.minPrice > data.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPrice'],
        message: 'must be greater than or equal to minPrice',
      });
    }
  });

export type ProviderSearchQuery = z.infer<typeof providerSearchQuerySchema>;

/** Normalised, ready-to-use search parameters. */
export interface ProviderSearchParams {
  keyword: string | null;
  categorySlug: string | null;
  location: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  minRating: number | null;
  availableOnly: boolean;
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 12;

export function toSearchParams(q: ProviderSearchQuery): ProviderSearchParams {
  return {
    keyword: q.keyword ?? null,
    categorySlug: q.category?.toLowerCase() ?? null,
    location: q.location ?? null,
    minPrice: q.minPrice ?? null,
    maxPrice: q.maxPrice ?? null,
    minRating: q.rating ?? null,
    availableOnly: q.availability === true,
    sort: q.sort ?? 'newest',
    order: q.order ?? defaultOrder(q.sort),
    page: q.page ?? 1,
    pageSize: q.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}

/**
 * Every sort defaults to DESC: rating → best first, price → most expensive
 * first, newest → latest first. An explicit `?order=asc` always wins.
 */
function defaultOrder(_sort: SortField | undefined): SortOrder {
  return 'desc';
}
