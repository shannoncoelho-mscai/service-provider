import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import type { CreateServiceInput, UpdateServiceInput } from './services.schemas';

/**
 * Provider service management (ADR-020).
 *
 * OWNERSHIP MODEL — the single most important rule in this file:
 *   `providerId` is NEVER taken from the request (body, query or URL). It is
 *   always the id resolved from the verified access token (req.user.id).
 *   Every single statement filters on `provider_id = $n` in the WHERE clause,
 *   so a provider who swaps the `:id` in the URL simply matches zero rows.
 *
 *   Read/write of a service that exists but belongs to someone else returns
 *   the SAME 404 as a service that does not exist at all — a 403 would confirm
 *   that the id exists and hand an attacker a free enumeration oracle.
 *
 *   `provider_id` is also not accepted in any payload (strict zod schemas),
 *   so the ownership predicate cannot be tampered with at the API surface.
 */

export interface ServiceDto {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  description: string | null;
  priceFrom: string;
  priceTo: string | null;
  priceType: 'FIXED' | 'HOURLY';
  durationMinutes: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ServiceRow {
  id: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  name: string;
  description: string | null;
  price_from: string;
  price_to: string | null;
  price_type: string;
  duration_minutes: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Shared projection so every response shape is identical. */
const SELECT_SERVICE = `
  SELECT s.id, s.category_id, s.name, s.description, s.price_from, s.price_to,
         s.price_type, s.duration_minutes, s.is_active, s.created_at, s.updated_at,
         c.name AS category_name, c.slug AS category_slug
    FROM services s
    JOIN service_categories c ON c.id = s.category_id`;

function toDto(row: ServiceRow): ServiceDto {
  if (row.price_type !== 'FIXED' && row.price_type !== 'HOURLY') {
    throw new HttpError(500, 'Internal server error');
  }
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    name: row.name,
    description: row.description,
    priceFrom: row.price_from,
    priceTo: row.price_to,
    priceType: row.price_type,
    durationMinutes: row.duration_minutes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Whitelist for dynamic PATCH updates — `provider_id` is NOT in it.
 *
 * `categoryName` is deliberately absent: it is not a column on `services`. It
 * exists on the input only so `resolveCategoryId` can turn free text into a
 * real `category_id` BEFORE this loop runs. Keeping it out of the map means the
 * generic whitelist can never accidentally write it to SQL.
 */
const WRITABLE_COLUMNS: Record<keyof UpdateServiceInput, string> = {
  categoryId: 'category_id',
  categoryName: '', // never used as a column; see the comment above
  name: 'name',
  description: 'description',
  priceFrom: 'price_from',
  priceTo: 'price_to',
  durationMinutes: 'duration_minutes',
  isActive: 'is_active',
};


/**
 * Custom categories created by a provider are sorted AFTER the curated seed
 * ones so a provider cannot push the established categories down the list with a
 * flood of near-duplicate names.
 */
const CUSTOM_CATEGORY_SORT_ORDER = 1000;

/**
 * Normalises a free-text category into a slug.
 *
 * This is the de-duplication key. "CCTV Installation", "cctv installation" and
 * "  CCTV   Installation  " all produce `cctv-installation`, so they resolve to
 * ONE `service_categories` row instead of three that differ only by case and
 * whitespace. The result always satisfies the table's own CHECK
 * (`slug = lower(slug) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`).
 *
 * Returns '' when the input has no usable characters (e.g. "!!!"), which the
 * caller turns into a 400.
 */
export function categorySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Collapse internal whitespace runs: "CCTV   Installation" -> "CCTV Installation". */
function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve free-text category input to a real `service_categories.id`,
 * creating the row if it does not exist yet.
 *
 * WHY THIS IS SERVER-SIDE: the client may suggest names but must never mint a
 * category id. `services.category_id` is a UUID FK with ON DELETE RESTRICT, and
 * the slug UNIQUE index is the only thing that can arbitrate two providers
 * creating "Pest Control" at the same instant. Trusting a client-generated id
 * would let a provider attach a service to an arbitrary category row.
 */
async function findOrCreateCategory(rawName: string): Promise<string> {
  const name = normalizeCategoryName(rawName);
  const slug = categorySlug(name);
  if (!slug) {
    throw new HttpError(400, 'Invalid request — the category name has no usable characters');
  }

  const existing = await pool.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM service_categories WHERE slug = $1',
    [slug],
  );
  if (existing.rowCount) {
    // Reuse the row someone already created rather than making a near-duplicate.
    if (!existing.rows[0].is_active) {
      throw new HttpError(400, 'Invalid request — that category is no longer available');
    }
    return existing.rows[0].id;
  }

  try {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO service_categories (name, slug, description, sort_order)
        VALUES ($1, $2, NULL, $3)
        RETURNING id`,
      [name, slug, CUSTOM_CATEGORY_SORT_ORDER],
    );
    return created.rows[0].id;
  } catch (err) {
    // Lost a race: another provider inserted the same slug a moment ago. The
    // UNIQUE index is the arbiter, so re-read and use THEIR row. This is the
    // only path where a create can legitimately fail and still succeed.
    if (isPgCode(err, PG.UNIQUE_VIOLATION)) {
      const raced = await pool.query<{ id: string }>(
        'SELECT id FROM service_categories WHERE slug = $1',
        [slug],
      );
      if (raced.rowCount) return raced.rows[0].id;
    }
    throw err;
  }
}

/**
 * Resolve whichever category selector the client used into a usable id.
 *
 * Returns undefined when neither field was sent (valid on update — it means
 * "leave the category alone"). `assertCategoryUsable` still gates an explicit
 * id, so a client cannot point a service at a deactivated category.
 */
async function resolveCategoryId(input: {
  categoryId?: string;
  categoryName?: string;
}): Promise<string | undefined> {
  if (input.categoryId !== undefined) {
    await assertCategoryUsable(input.categoryId);
    return input.categoryId;
  }
  if (input.categoryName !== undefined) {
    return findOrCreateCategory(input.categoryName);
  }
  return undefined;
}

/** POST /api/providers/me/services */
export async function createService(
  providerId: string,
  input: CreateServiceInput,
): Promise<ServiceDto> {
  // Exactly one selector is guaranteed by the schema. Resolving BEFORE the
  // insert means the service row only ever receives a real, active category id.
  const categoryId = await resolveCategoryId(input);
  if (!categoryId) {
    throw new HttpError(400, 'Invalid request — a category is required');
  }

  try {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO services
         (provider_id, category_id, name, description, price_from, price_to,
          price_type, duration_minutes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 'FIXED', $7, COALESCE($8, TRUE))
       RETURNING id`,
      [
        providerId, // ← from the token, never the body
        categoryId,
        input.name,
        input.description ?? null,
        input.priceFrom,
        input.priceTo ?? null,
        input.durationMinutes ?? null,
        input.isActive ?? null,
      ],
    );
    return await loadOwnedService(providerId, res.rows[0].id);
  } catch (err) {
    throw translateWriteError(err);
  }
}

/** PATCH /api/providers/me/services/:id */
export async function updateService(
  providerId: string,
  serviceId: string,
  input: UpdateServiceInput,
): Promise<ServiceDto> {
  // Load the caller's own row first: proves ownership AND gives us the
  // stored price so a partial update (priceTo only) can be range-checked.
  const current = await loadOwnedService(providerId, serviceId);

  // Resolve a NEW category if one was sent. `categoryId` is validated as a
  // lookup only — ownership of the service is already proven by the read above
  // and re-asserted by the UPDATE's own `AND provider_id = $n` predicate.
  const nextCategoryId =
    input.categoryId !== undefined || input.categoryName !== undefined
      ? await resolveCategoryId(input)
      : undefined;

  const nextFrom = input.priceFrom ?? Number(current.priceFrom);
  const nextTo = input.priceTo === undefined ? current.priceTo : input.priceTo;
  if (nextTo != null && Number(nextTo) < nextFrom) {
    throw new HttpError(400, 'Invalid request — priceTo must be greater than or equal to priceFrom');
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  // A typed `categoryName` is NOT a column: it has already been resolved into a
  // real `category_id` by `resolveCategoryId`. Push that id here so a PATCH that
  // only carries free text still produces a valid SET clause — without this,
  // `sets` would be empty and the UPDATE would be invalid SQL.
  if (nextCategoryId !== undefined) {
    values.push(nextCategoryId);
    sets.push(`category_id = $${values.length}`);
  }

  for (const [key, column] of Object.entries(WRITABLE_COLUMNS)) {
    // Both category selectors are handled above; neither is a payload column.
    if (key === 'categoryName' || key === 'categoryId') continue;
    if (key in input) {
      values.push((input as Record<string, unknown>)[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  // Defensive: the schema requires ≥ 1 field, so this can only be reached if a
  // future change lets a no-op through. Fail as a 400 rather than issuing SQL
  // with an empty SET list.
  if (sets.length === 0) {
    throw new HttpError(400, 'Invalid request — no fields to update');
  }

  try {
    // `AND provider_id = $n` stays in the UPDATE itself — the earlier read is
    // a convenience, this predicate is what actually enforces the boundary.
    await pool.query(
      `UPDATE services
          SET ${sets.join(', ')}
        WHERE id = $${values.length + 1}
          AND provider_id = $${values.length + 2}`,
      [...values, serviceId, providerId],
    );
  } catch (err) {
    throw translateWriteError(err);
  }

  return loadOwnedService(providerId, serviceId);
}

/**
 * DELETE /api/providers/me/services/:id — soft delete.
 *
 * Deactivation (is_active = false) instead of a hard DELETE because
 * bookings.service_id is ON DELETE RESTRICT: a hard delete would fail for any
 * service that has booking history, and hard-deleting would break the meaning
 * of existing bookings. Providers keep full control — they can re-activate it
 * with PATCH { isActive: true }.
 */
export async function deactivateService(
  providerId: string,
  serviceId: string,
): Promise<ServiceDto> {
  const res = await pool.query<{ id: string }>(
    `UPDATE services
        SET is_active = FALSE
      WHERE id = $1
        AND provider_id = $2
      RETURNING id`,
    [serviceId, providerId],
  );
  if (res.rowCount === 0) throw new HttpError(404, 'Service not found');
  return loadOwnedService(providerId, serviceId);
}

/**
 * Fetch one service, scoped to its owner. This is the ONLY read path for a
 * single service, and it is always owner-scoped.
 */
async function loadOwnedService(providerId: string, serviceId: string): Promise<ServiceDto> {
  const res = await pool.query<ServiceRow>(
    `${SELECT_SERVICE} WHERE s.id = $1 AND s.provider_id = $2`,
    [serviceId, providerId],
  );
  // Same 404 for "not yours" and "does not exist" (see file header).
  if (res.rowCount === 0) throw new HttpError(404, 'Service not found');
  return toDto(res.rows[0]);
}

async function assertCategoryUsable(categoryId: string): Promise<void> {
  const res = await pool.query(
    'SELECT 1 FROM service_categories WHERE id = $1 AND is_active',
    [categoryId],
  );
  if (res.rowCount === 0) {
    throw new HttpError(400, 'Invalid request — categoryId is not an available category');
  }
}

/** DB errors → safe, specific 4xx (no SQL text ever reaches the client). */
function translateWriteError(err: unknown): unknown {
  if (isPgCode(err, PG.UNIQUE_VIOLATION)) {
    return new HttpError(409, 'You already have a service with that name');
  }
  if (isPgCode(err, PG.FOREIGN_KEY_VIOLATION)) {
    return new HttpError(400, 'Invalid request — referenced category is unavailable');
  }
  if (isPgCode(err, PG.CHECK_VIOLATION)) {
    return new HttpError(400, 'Invalid request — a value is outside the allowed range');
  }
  return err;
}

/** Postgres SQLSTATE codes we translate into safe 4xx responses. */
const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

function isPgCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

/** GET /api/providers/me/services — the caller's own catalogue. */
export async function listMyServices(providerId: string): Promise<ServiceDto[]> {
  const res = await pool.query<ServiceRow>(
    `${SELECT_SERVICE}
      WHERE s.provider_id = $1
      ORDER BY s.is_active DESC, s.name ASC`,
    [providerId],
  );
  return res.rows.map(toDto);
}
