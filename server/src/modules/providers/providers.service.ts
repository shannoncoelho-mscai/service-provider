import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import { isVerificationStatus, type VerificationStatus } from '../../shared/types';
import type { UpdateProviderInput } from './providers.schemas';

/** Safe DTO — never includes another user's data or internal-only columns. */
export interface ProviderProfileDto {
  userId: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  city: string;
  address: string | null;
  serviceAreas: string[];
  yearsExperience: number;
  hourlyRate: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  verificationStatus: VerificationStatus;
  isPublic: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileRow {
  user_id: string;
  business_name: string;
  description: string | null;
  phone: string | null;
  city: string;
  address: string | null;
  service_areas: string[];
  years_experience: number;
  hourly_rate: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  verification_status: string;
  is_public: boolean;
  verified_by: string | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const PROFILE_COLUMNS = `
  p.user_id, p.business_name, p.description, p.phone, p.city, p.address,
  p.service_areas, p.years_experience, p.hourly_rate, p.profile_image_url,
  p.cover_image_url, p.verification_status, p.is_public, p.verified_by,
  p.verified_at, p.created_at, p.updated_at`;

export function toProfileDto(row: ProfileRow): ProviderProfileDto {
  if (!isVerificationStatus(row.verification_status)) {
    throw new HttpError(500, 'Internal server error');
  }
  return {
    userId: row.user_id,
    businessName: row.business_name,
    description: row.description,
    phone: row.phone,
    city: row.city,
    address: row.address,
    serviceAreas: row.service_areas ?? [],
    yearsExperience: row.years_experience,
    hourlyRate: row.hourly_rate,
    profileImageUrl: row.profile_image_url,
    coverImageUrl: row.cover_image_url,
    verificationStatus: row.verification_status,
    isPublic: row.is_public,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Whitelist for dynamic PATCH updates — only these columns are writable,
 * and verification fields are NOT among them (ADR-018). */
const WRITABLE_COLUMNS: Record<keyof UpdateProviderInput, string> = {
  businessName: 'business_name',
  description: 'description',
  phone: 'phone',
  city: 'city',
  address: 'address',
  serviceAreas: 'service_areas',
  yearsExperience: 'years_experience',
  hourlyRate: 'hourly_rate',
  profileImageUrl: 'profile_image_url',
  coverImageUrl: 'cover_image_url',
};

export async function getMyProfile(userId: string): Promise<{
  profile: ProviderProfileDto;
  user: { fullName: string; email: string };
}> {
  const res = await pool.query<ProfileRow & { full_name: string; email: string }>(
    `SELECT ${PROFILE_COLUMNS}, u.full_name, u.email
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'Provider profile not found');
  const { full_name, email, ...profile } = row;
  return { profile: toProfileDto(profile), user: { fullName: full_name, email } };
}

export async function updateMyProfile(
  userId: string,
  input: UpdateProviderInput,
): Promise<ProviderProfileDto> {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(WRITABLE_COLUMNS)) {
    if (key in input) {
      values.push((input as Record<string, unknown>)[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) throw new HttpError(400, 'Invalid request — no fields to update');

  values.push(userId);
  const res = await pool.query<ProfileRow>(
    `UPDATE provider_profiles
        SET ${sets.join(', ')}
      WHERE user_id = $${values.length}
      RETURNING user_id, business_name, description, phone, city, address,
                service_areas, years_experience, hourly_rate, profile_image_url,
                cover_image_url, verification_status, is_public, verified_by,
                verified_at, created_at, updated_at`,
    values,
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'Provider profile not found');
  return toProfileDto(row);
}
