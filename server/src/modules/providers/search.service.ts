import { pool } from '../../config/database';
import type { ProviderSearchParams, SortField, SortOrder } from './search.schemas';

/**
 * Public provider search (ADR-021).
 *
 * SQL INJECTION
 *   Every user-supplied value is bound as a $n parameter. Nothing is
 *   concatenated into the SQL text. The only interpolated fragments are the
 *   ORDER BY expressions, which are chosen from a fixed lookup table keyed by
 *   an already-validated enum — a value that is not in the table is a 400, so
 *   there is no path from user input to the SQL string.
 *
 * PUBLIC EXPOSURE
 *   `toPublicDto` is an explicit ALLOW-LIST: it copies named fields out of the
 *   row and builds a fresh object. A column added to the table later cannot
 *   leak into this response by accident, and the following are never selected
 *   at all: password hashes, email, phone, owner full name, verified_by,
 *   and every admin_action_log field (rejection reasons, internal notes).
 *
 * APPROVED-ONLY
 *   The `public_providers` view already filters `verification_status =
 *   'APPROVED' AND users.is_active`. The view is the single gate, so a
 *   PENDING/REJECTED/SUSPENDED provider cannot be returned by any code path.
 */

/** Public DTO — the complete set of fields a customer may see. */
export interface PublicProviderDto {
  id: string;
  businessName: string;
  description: string | null;
  city: string;
  serviceAreas: string[];
  yearsExperience: number;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  verifiedAt: Date | null;
  rating: number | null;
  reviewCount: number;
  priceFrom: string | null;
  activeServiceCount: number;
  isAvailable: boolean;
  categories: Array<{ slug: string; name: string }>;
}

export interface PaginatedProviders {
  providers: PublicProviderDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

interface ProviderRow {
  id: string;
  business_name: string;
  description: string | null;
  city: string;
  service_areas: string[];
  years_experience: number;
  profile_image_url: string | null;
  cover_image_url: string | null;
  verified_at: Date | null;
  rating_avg: string | null;
  rating_count: number;
  price_min: string | null;
  active_service_count: number;
  categories: Array<{ slug: string; name: string }> | null;
}

export type { ProviderRow };

/**
 * ORDER BY fragments. Keys are the validated `sort` enum, so the lookup is
 * total for accepted input and there is no user-controlled SQL.
 * `id` is appended as a tiebreaker so pagination is stable when many rows
 * share a rating/price (otherwise rows can repeat or vanish across pages).
 */
const ORDER_BY: Record<SortField, string> = {
  // Unrated providers (NULL) sort last in BOTH directions: a customer asking
  // for the cheapest providers should still see bookable ones first.
  rating: 'rating_avg',
  price: 'price_min',
  newest: 'created_at',
};

function orderClause(field: SortField, order: SortOrder): string {
  const column = ORDER_BY[field];
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  if (field === 'rating') {
    return `ORDER BY rating_avg ${direction} NULLS LAST, created_at DESC, id ASC`;
  }
  if (field === 'price') {
    return `ORDER BY price_min ${direction} NULLS LAST, created_at DESC, id ASC`;
  }
  return `ORDER BY ${column} ${direction}, id ASC`;
}

/** Case-insensitive, wildcard-safe LIKE escaping. */
function likePattern(value: string): string {
  return `%${value.replace(/([\\%_])/g, '\\$1')}%`;
}

/**
 * Allow-list → DTO. Exported so the public profile endpoint maps its base row
 * through the exact same field list as search results: a field can never be
 * public in one response and private in the other (ADR-022).
 */
export function toPublicDto(row: ProviderRow): PublicProviderDto {
  return {
    id: row.id,
    businessName: row.business_name,
    description: row.description,
    city: row.city,
    serviceAreas: row.service_areas ?? [],
    yearsExperience: row.years_experience,
    profileImageUrl: row.profile_image_url,
    coverImageUrl: row.cover_image_url,
    verifiedAt: row.verified_at,
    rating: row.rating_avg === null ? null : Number(row.rating_avg),
    reviewCount: row.rating_count,
    priceFrom: row.price_min,
    activeServiceCount: row.active_service_count,
    isAvailable: row.active_service_count > 0,
    categories: row.categories ?? [],
  };
}

/** Shared, APPROVED-gated projection. Exported for the profile endpoint. */
export const PUBLIC_COLUMNS = `
  v.id, v.business_name, v.description, v.city, v.service_areas,
  v.years_experience, v.profile_image_url, v.cover_image_url, v.verified_at,
  v.rating_avg, v.rating_count, v.price_min, v.active_service_count,
  COALESCE(
    (SELECT json_agg(json_build_object('slug', c.slug, 'name', c.name)
                      ORDER BY c.name)
       FROM service_categories c
      WHERE c.id IN (SELECT s.category_id
                       FROM services s
                      WHERE s.provider_id = v.id
                        AND s.is_active)),
    '[]'::json
  ) AS categories`;

/**
 * Builds the WHERE clause incrementally. Each filter appends its own
 * placeholder and pushes the bound value — the two lists cannot drift.
 */
function buildFilters(p: ProviderSearchParams): { where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (p.keyword) {
    const pattern = bind(likePattern(p.keyword));
    // business_name OR description, plus any active service name, so
    // "drain" finds a plumber even when the word is only in a service.
    clauses.push(`(
      v.business_name ILIKE ${pattern}
      OR v.description ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM services ks
         WHERE ks.provider_id = v.id
           AND ks.is_active
           AND ks.name ILIKE ${pattern}
      )
    )`);
  }

  if (p.categorySlug) {
    // Match the category's own slug, resolved from a bound value. An unknown
    // slug simply matches nothing (no error, no information leak).
    clauses.push(`EXISTS (
      SELECT 1
        FROM services cs
        JOIN service_categories cc ON cc.id = cs.category_id
       WHERE cs.provider_id = v.id
         AND cs.is_active
         AND cc.slug = ${bind(p.categorySlug)}
         AND cc.is_active
    )`);
  }

  if (p.location) {
    const pattern = bind(likePattern(p.location));
    // City or any advertised service area.
    clauses.push(`(
      v.city ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM unnest(v.service_areas) AS area
         WHERE area ILIKE ${pattern}
      )
    )`);
  }

  if (p.minPrice !== null) {
    // "from at least X" — a provider qualifies if ANY active service starts
    // at or above the floor (a strict `>=` on price_min would hide cheap
    // providers that also offer a premium option).
    clauses.push(`EXISTS (
      SELECT 1 FROM services ps
       WHERE ps.provider_id = v.id
         AND ps.is_active
         AND ps.price_from >= ${bind(p.minPrice)}
    )`);
  }

  if (p.maxPrice !== null) {
    // "up to X" — a provider qualifies if any active service can be booked
    // for at most X, i.e. its lowest price is within budget.
    clauses.push(`v.price_min IS NOT NULL AND v.price_min <= ${bind(p.maxPrice)}`);
  }

  if (p.minRating !== null) {
    // Unrated providers (NULL) are excluded: they cannot satisfy "min 4".
    clauses.push(`v.rating_avg IS NOT NULL AND v.rating_avg >= ${bind(p.minRating)}`);
  }

  if (p.availableOnly) {
    clauses.push('v.active_service_count > 0');
  }

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export async function searchProviders(p: ProviderSearchParams): Promise<PaginatedProviders> {
  const { where, values } = buildFilters(p);

  // --- total (for pagination metadata) -----------------------------------
  // COUNT over the same predicate, so total and page contents can never disagree.
  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM public_providers v
       ${where}`,
    values,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  // --- page --------------------------------------------------------------
  // LIMIT/OFFSET with bound values. The offset is computed in JS from the
  // validated page numbers, so it can never be attacker-chosen directly.
  const offset = (p.page - 1) * p.pageSize;
  const rowsRes = await pool.query<ProviderRow>(
    `SELECT ${PUBLIC_COLUMNS}
       FROM public_providers v
       ${where}
       ${orderClause(p.sort, p.order)}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, p.pageSize, offset],
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / p.pageSize);
  return {
    providers: rowsRes.rows.map(toPublicDto),
    pagination: {
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages,
      hasNext: p.page < totalPages,
      hasPrev: p.page > 1,
    },
  };
}

/** Category slugs for the filter dropdown — public reference data. */
export async function listCategoryOptions(): Promise<
  Array<{ slug: string; name: string; providerCount: number }>
> {
  const res = await pool.query<{ slug: string; name: string; provider_count: number }>(
    `SELECT c.slug,
            c.name,
            count(DISTINCT s.provider_id)::int AS provider_count
       FROM service_categories c
       LEFT JOIN services s ON s.category_id = c.id AND s.is_active
       LEFT JOIN public_providers v ON v.id = s.provider_id
      WHERE c.is_active
      GROUP BY c.slug, c.name, c.sort_order
      ORDER BY c.sort_order, c.name`,
  );
  return res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    providerCount: r.provider_count,
  }));
}

