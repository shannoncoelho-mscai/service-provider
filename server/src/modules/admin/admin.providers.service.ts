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

export async function listPending(): Promise<AdminProviderDetail[]> {
  const res = await pool.query<ProfileRow & OwnerRow>(
    `SELECT ${PROFILE_COLUMNS}, u.full_name, u.email, u.is_active
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.verification_status = 'PENDING'
      ORDER BY p.created_at ASC`,
  );
  return res.rows.map((row) => toDetail(row));
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
    ...toDetail(row),
    actions: actions.rows.map((a) => ({
      action: a.action,
      previousStatus: a.previous_status,
      newStatus: a.new_status,
      details: a.details,
      createdAt: a.created_at,
    })),
  };
}

function toDetail(row: ProfileRow & OwnerRow): AdminProviderDetail {
  const { full_name, email, is_active, ...profile } = row;
  return {
    ...toProfileDto(profile),
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
