import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import { isVerificationStatus, type VerificationStatus } from '../../shared/types';
import {
  PROFILE_COLUMNS,
  toProfileDto,
  type ProfileRow,
  type ProviderProfileDto,
} from '../providers/providers.service';

/**
 * Admin provider-review service (ADR-019).
 *
 * Every decision runs in ONE transaction:
 *   SELECT … FOR UPDATE → state-machine guard → UPDATE status
 *   → INSERT admin_action_log (previous_status, new_status, reason)
 * so a decision can never exist without its audit row.
 *
 * State machine (no-op transitions are 409):
 *   approve  PENDING|REJECTED|SUSPENDED → APPROVED
 *   reject   PENDING|APPROVED|SUSPENDED → REJECTED
 *   suspend  PENDING|APPROVED|REJECTED  → SUSPENDED
 */

export type Decision = Extract<VerificationStatus, 'APPROVED' | 'REJECTED' | 'SUSPENDED'>;

export interface AdminProviderDetail extends ProviderProfileDto {
  owner: { fullName: string; email: string; isActive: boolean };
  /**
   * The provider's service catalogue, for review.
   *
   * An admin cannot judge a business application without seeing what it
   * actually sells and at what price — that is the whole point of reviewing
   * one. Only the provider's OWN rows are selected (`provider_id = $1`), so
   * this can never leak another provider's catalogue.
   *
   * Inactive (soft-deleted) services are included deliberately: an admin
   * deciding whether to approve needs to see the full history, not a curated
   * subset. Prices are numeric strings; the rupee symbol is added by the UI.
   */
  services: AdminProviderService[];
  /**
   * The provider's uploaded BUSINESS photos, for review.
   *
   * An admin is being asked to judge whether a real, legitimate business
   * exists. Photos are the most direct evidence of that, and a reviewer cannot
   * make a fair decision without them.
   *
   * Scoped to `provider_id = $1` like everything else here, so this can never
   * show one provider's photos on another's review screen. Read from the base
   * table rather than the `public_providers` view for the same reason as
   * `services`: a PENDING provider is not in that view at all, yet their photos
   * are exactly what a reviewer needs.
   *
   * READ-ONLY by design. There is deliberately no admin-side upload or delete:
   * the gallery is the provider's to curate, and giving an admin controls over
   * it would let them alter the very evidence they are judging.
   */
  images: AdminProviderImage[];
}

/**
 * One business image as the review screen needs it.
 *
 * `isPrimary` is included because a provider marks their best photo as primary,
 * and a reviewer reasonably expects to see that one first. `sortOrder` is
 * included so the grid renders in the order the provider chose.
 */
export interface AdminProviderImage {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

/** One service row as the admin review screen needs it — nothing more. */
export interface AdminProviderService {
  id: string;
  name: string;
  description: string | null;
  categoryName: string;
  priceFrom: string;
  priceTo: string | null;
  durationMinutes: number | null;
  isActive: boolean;
}

export interface AdminProviderAction {
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

interface OwnerRow {
  full_name: string;
  email: string;
  is_active: boolean;
}

/**
 * The provider's own services, for the admin review screen.
 *
 * Scoped to a single provider id, and deliberately NOT reading through the
 * `public_providers` view: a PENDING provider is not in that view at all, yet
 * their services are exactly what a reviewer needs to see.
 */
async function listServicesFor(providerId: string): Promise<AdminProviderService[]> {
  const res = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    category_name: string;
    price_from: string;
    price_to: string | null;
    duration_minutes: number | null;
    is_active: boolean;
  }>(
    `SELECT s.id, s.name, s.description, s.price_from, s.price_to,
            s.duration_minutes, s.is_active, c.name AS category_name
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
      WHERE s.provider_id = $1
      ORDER BY s.is_active DESC, c.sort_order, s.name`,
    [providerId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    categoryName: r.category_name,
    priceFrom: r.price_from,
    priceTo: r.price_to,
    durationMinutes: r.duration_minutes,
    isActive: r.is_active,
  }));
}

/**
 * The provider's business photos, for the admin review screen.
 *
 * Scoped to a single provider id, and NOT reading through `public_providers`:
 * a PENDING provider is not in that view, yet their photos are exactly what a
 * reviewer needs to see before approving. Ordered primary-first so the grid
 * leads with the photo the provider considers their best.
 */
async function listImagesFor(providerId: string): Promise<AdminProviderImage[]> {
  const res = await pool.query<{
    id: string;
    url: string;
    alt_text: string | null;
    is_primary: boolean;
    sort_order: number;
  }>(
    `SELECT id, url, alt_text, is_primary, sort_order
       FROM provider_images
      WHERE provider_id = $1
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
    [providerId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    url: r.url,
    altText: r.alt_text,
    isPrimary: r.is_primary,
    sortOrder: r.sort_order,
  }));
}

/**
 * Both collections for one provider, in parallel.
 *
 * Keeps `listPending` and `getDetail` reading as a single expression instead of
 * a growing argument list, and keeps the N+1 to 2 queries per provider.
 */
async function extrasFor(providerId: string): Promise<{
  services: AdminProviderService[];
  images: AdminProviderImage[];
}> {
  const [services, images] = await Promise.all([
    listServicesFor(providerId),
    listImagesFor(providerId),
  ]);
  return { services, images };
}

export async function listPending(): Promise<AdminProviderDetail[]> {
  const res = await pool.query<ProfileRow & OwnerRow>(
    `SELECT ${PROFILE_COLUMNS}, u.full_name, u.email, u.is_active
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.verification_status = 'PENDING'
      ORDER BY p.created_at ASC`,
  );
  return Promise.all(res.rows.map(async (row) => toDetail(row, await extrasFor(row.user_id))));
}

export async function getDetail(providerId: string): Promise<
  AdminProviderDetail & { actions: AdminProviderAction[] }
> {
  const res = await pool.query<ProfileRow & OwnerRow>(
    `SELECT ${PROFILE_COLUMNS}, u.full_name, u.email, u.is_active
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1`,
    [providerId],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'Provider not found');

  const actions = await pool.query<{
    action: string;
    previous_status: string | null;
    new_status: string | null;
    details: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT action, previous_status, new_status, details, created_at
       FROM admin_action_log
      WHERE target_type = 'PROVIDER_PROFILE' AND target_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [providerId],
  );

  return {
    ...toDetail(row, await extrasFor(row.user_id)),
    actions: actions.rows.map((a) => ({
      action: a.action,
      previousStatus: a.previous_status,
      newStatus: a.new_status,
      details: a.details,
      createdAt: a.created_at,
    })),
  };
}

function toDetail(
  row: ProfileRow & OwnerRow,
  extras: { services: AdminProviderService[]; images: AdminProviderImage[] },
): AdminProviderDetail {
  const { full_name, email, is_active, ...profile } = row;
  return {
    ...toProfileDto(profile),
    ...extras,
    owner: { fullName: full_name, email, isActive: is_active },
  };
}

export async function decide(
  adminId: string,
  providerId: string,
  target: Decision,
  reason: string | null,
): Promise<ProviderProfileDto> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query<{ verification_status: string }>(
      `SELECT verification_status
         FROM provider_profiles
        WHERE user_id = $1
        FOR UPDATE`,
      [providerId],
    );
    const current = currentRes.rows[0];
    if (!current) throw new HttpError(404, 'Provider not found');
    if (!isVerificationStatus(current.verification_status)) {
      throw new HttpError(500, 'Internal server error');
    }
    const previous = current.verification_status;

    if (previous === target) {
      // Safe, non-revealing message; also covers idempotent double-clicks.
      throw new HttpError(409, `Provider is already ${target.toLowerCase()}`);
    }

    const updated = await client.query<ProfileRow>(
      `UPDATE provider_profiles
          SET verification_status = $2,
              verified_by = $3,
              verified_at = now()
        WHERE user_id = $1
        RETURNING user_id, business_name, description, phone, city, address,
                  service_areas, years_experience, hourly_rate, profile_image_url,
                  cover_image_url, verification_status, is_public, verified_by,
                  verified_at, created_at, updated_at`,
      [providerId, target, adminId],
    );

    await client.query(
      `INSERT INTO admin_action_log
         (admin_id, action, target_type, target_id, previous_status, new_status, details)
       VALUES ($1, 'PROVIDER_VERIFICATION_CHANGED', 'PROVIDER_PROFILE', $2, $3, $4, $5)`,
      [adminId, providerId, previous, target, { ...(reason ? { reason } : {}) }],
    );

    await client.query('COMMIT');
    return toProfileDto(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
