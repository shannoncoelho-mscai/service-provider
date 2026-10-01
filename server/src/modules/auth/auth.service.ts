import { pool } from '../../config/database';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createSession, purgeExpiredSessions, revokeSession } from '../../lib/sessions';
import { signAccessToken } from '../../lib/token';
import { HttpError } from '../../shared/httpError';
import { isRole, type Role } from '../../shared/types';
import type { LoginInput, RegisterInput } from './auth.schemas';

/**
 * Auth business logic. Rules (ADR-015/ADR-016):
 *  - passwords: scrypt only, hashed before any INSERT (never plaintext)
 *  - responses: PublicUser has no password_hash field at all
 *  - login failures are uniform: "Invalid email or password" (401),
 *    with a dummy hash run so unknown emails take the same time as
 *    wrong passwords (no user enumeration via timing or message)
 *  - registration CAN reveal an existing email (409) — required for usable
 *    sign-ups; documented tradeoff in ADR-016
 */

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  phone: string | null;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresInSeconds: number;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
  created_at: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  if (!isRole(row.role)) throw new HttpError(500, 'Internal server error');
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

/** Memoized dummy hash — cost-equivalent to a real verify for timing. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword('timing-equalizer-never-a-real-account'));

const pgCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
const pgConstraint = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;

async function issueSession(row: UserRow, userAgent: string | null): Promise<AuthResult> {
  const session = await createSession(row.id, userAgent);
  if (!isRole(row.role)) throw new HttpError(500, 'Internal server error');
  const token = signAccessToken({ sub: row.id, role: row.role as Role, sid: session.id });
  return {
    user: toPublicUser(row),
    token,
    expiresInSeconds: Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
  };
}

export async function register(input: RegisterInput, userAgent: string | null): Promise<AuthResult> {
  // Hash OUTSIDE the transaction — scrypt is intentionally slow.
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  let userRow: UserRow;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, phone, role, created_at`,
      [input.email, passwordHash, input.fullName, input.phone ?? null, input.role],
    );
    userRow = inserted.rows[0];

    // Providers start PENDING — an admin must APPROVE them (never automatic).
    // The INSERT deliberately OMITS verification_status so the column DEFAULT
    // 'PENDING' applies: there is no code path that can set a new provider
    // APPROVED at registration, whatever the client sends.
    if (input.role === 'PROVIDER' && input.provider) {
      await client.query(
        `INSERT INTO provider_profiles
           (user_id, business_name, description, phone, city, service_areas,
            years_experience, hourly_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userRow.id,
          input.provider.businessName,
          input.provider.description ?? null,
          // A business contact number is useful on the profile; fall back to the
          // account's own phone so a provider who gave one is not asked twice.
          input.provider.phone ?? input.phone ?? null,
          input.provider.city,
          input.provider.serviceAreas ?? [],
          input.provider.yearsExperience ?? 0,
          input.provider.hourlyRate ?? null,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (pgCode(err) === '23505') {
      const constraint = pgConstraint(err) ?? '';
      if (constraint.includes('email')) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      if (constraint.includes('phone')) {
        throw new HttpError(409, 'An account with this phone number already exists');
      }
      throw new HttpError(409, 'An account with these details already exists');
    }
    throw err;
  } finally {
    client.release();
  }

  return issueSession(userRow, userAgent);
}

export async function login(input: LoginInput, userAgent: string | null): Promise<AuthResult> {
  const res = await pool.query<UserRow & { password_hash: string; is_active: boolean }>(
    `SELECT id, email, full_name, phone, role, created_at, password_hash, is_active
       FROM users
      WHERE email = $1`,
    [input.email],
  );
  const row = res.rows[0];

  // Unknown email, deactivated or suspended account → identical generic
  // failure. The dummy verify equalizes response time for missing users.
  if (!row || !row.is_active) {
    await verifyPassword(input.password, await getDummyHash());
    throw new HttpError(401, 'Invalid email or password');
  }

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid email or password');
  }

  await purgeExpiredSessions(); // opportunistic cleanup, indexed
  return issueSession(row, userAgent);
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function getMe(userId: string): Promise<PublicUser> {
  const res = await pool.query<UserRow>(
    `SELECT id, email, full_name, phone, role, created_at
       FROM users
      WHERE id = $1 AND is_active = TRUE`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(401, 'Session expired or revoked');
  return toPublicUser(row);
}
