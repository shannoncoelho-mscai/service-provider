import { pool } from '../config/database';
import { env } from '../config/env';
import { hashPassword } from '../lib/password';
import {
  ADMIN,
  ADMIN_LOGS,
  BOOKINGS,
  CATEGORIES,
  CUSTOMERS,
  DEV_PASSWORD,
  PROVIDERS,
  REVIEWS,
  daysFromNow,
  u,
} from './seedData';

/**
 * Development seed data (ADR-010 / database/README.md).
 *   npm run seed --workspace server              # seeds once (skips if data exists)
 *   npm run seed --workspace server -- --force   # wipe & reseed (refused in production)
 *
 * Passwords are stored ONLY as scrypt hashes via src/lib/password.ts —
 * plaintext never touches the database (see docs/SECURITY.md).
 */

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (force) {
    if (env.NODE_ENV === 'production') {
      console.error('❌ --force is refused when NODE_ENV=production.');
      process.exit(1);
    }
    await pool.query('TRUNCATE users, service_categories CASCADE');
    console.log('🗑  Wiped development data (users, categories & dependents).');
  }

  const migrated = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.provider_profiles') IS NOT NULL AS exists",
  );
  if (!migrated.rows[0].exists) {
    console.error('❌ Not migrated yet — run `npm run migrate --workspace server` first.');
    process.exit(1);
  }

  const existing = await pool.query('SELECT 1 FROM users LIMIT 1');
  if ((existing.rowCount ?? 0) > 0) {
    console.log('ℹ️  Seed skipped — data already present (use --force to reseed in development).');
    return;
  }

  // Hashed ONCE, reused for all dev accounts. NEVER plaintext (ADR-011).
  const hash = await hashPassword(DEV_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO service_categories (id, name, slug, description, sort_order)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.name, c.slug, c.description, c.sortOrder],
      );
    }

    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'ADMIN') ON CONFLICT (id) DO NOTHING`,
      [ADMIN.id, ADMIN.email, hash, ADMIN.name],
    );
    for (const c of CUSTOMERS) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, phone, role)
         VALUES ($1, $2, $3, $4, $5, 'CUSTOMER') ON CONFLICT (id) DO NOTHING`,
        [c.id, c.email, hash, c.name, c.phone],
      );
    }

    for (const p of PROVIDERS) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, 'PROVIDER') ON CONFLICT (id) DO NOTHING`,
        [u(p.n), p.email, hash, p.owner],
      );

      const decided = p.status !== 'PENDING';
      await client.query(
        `INSERT INTO provider_profiles
           (user_id, business_name, description, city, years_experience,
            hourly_rate, verification_status, verified_by, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          u(p.n), p.business, `${p.business} — fictional demo provider in ${p.city}.`,
          p.city, 3 + (p.n % 8), p.rate, p.status,
          decided ? ADMIN.id : null,
          decided ? daysFromNow(-3) : null,
        ],
      );

      for (const [i, [name, price]] of p.services.entries()) {
        await client.query(
          `INSERT INTO services (id, provider_id, category_id, name, price_from, price_type, duration_minutes)
           VALUES ($1, $2, $3, $4, $5, 'FIXED', $6) ON CONFLICT (id) DO NOTHING`,
          [u(p.n * 10 + i), u(p.n), CATEGORIES[p.category].id, name, price, 60 + i * 30],
        );
      }

      const slug = p.email.split('@')[1]?.split('.')[0] ?? `provider${p.n}`;
      await client.query(
        `INSERT INTO provider_images (id, provider_id, url, alt_text, is_primary, sort_order)
         VALUES ($1, $2, $3, $4, TRUE, 0) ON CONFLICT (id) DO NOTHING`,
        [u(p.n + 500), u(p.n), `https://picsum.photos/seed/${slug}/800/600`, `${p.business} storefront`],
      );
    }

    // --- bookings (all six statuses) ---
    for (const b of BOOKINGS) {
      await client.query(
        `INSERT INTO bookings
           (id, customer_id, provider_id, service_id, status, scheduled_at,
            address, price_quote, cancellation_reason, rejection_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          u(b.id), u(b.customer), u(b.provider), u(b.service), b.status,
          daysFromNow(b.scheduled), '123 Demo Lane, TX', '150.00',
          b.cancellation ?? null, b.rejection ?? null, daysFromNow(-12),
        ],
      );
    }

    // --- reviews (composite FKs must match the booking row) ---------------
    for (const [id, booking, customer, provider, rating, comment] of REVIEWS) {
      await client.query(
        `INSERT INTO reviews (id, booking_id, customer_id, provider_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [u(id), u(booking), u(customer), u(provider), rating, comment],
      );
    }

    // --- admin action log --------------------------------------------------
    for (const [id, target, previous, next, note] of ADMIN_LOGS) {
      await client.query(
        `INSERT INTO admin_action_log
           (id, admin_id, action, target_type, target_id, previous_status, new_status, details)
         VALUES ($1, $2, 'PROVIDER_VERIFICATION_CHANGED', 'PROVIDER_PROFILE', $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [u(id), ADMIN.id, u(target), previous, next, { note }],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const q = async (sql: string): Promise<string> =>
    (await pool.query<{ n: string }>(sql)).rows[0].n;
  const [cats, provs, approved, svcs, bkgs, revs] = await Promise.all([
    q('SELECT count(*)::text n FROM service_categories'),
    q('SELECT count(*)::text n FROM provider_profiles'),
    q("SELECT count(*)::text n FROM provider_profiles WHERE verification_status='APPROVED'"),
    q('SELECT count(*)::text n FROM services'),
    q('SELECT count(*)::text n FROM bookings'),
    q('SELECT count(*)::text n FROM reviews'),
  ]);
  console.log('✅ Seed complete:');
  console.log(
    `   categories=${cats} providers=${provs} (approved=${approved}) ` +
      `services=${svcs} bookings=${bkgs} reviews=${revs}`,
  );
  console.log(`   admin:     ${ADMIN.email}`);
  console.log(`   customers: ${CUSTOMERS.map((c) => c.email).join(', ')}`);
  console.log(`   providers: ${PROVIDERS.map((p) => p.email).join(', ')}`);
  console.log(`   shared dev password (development only): ${DEV_PASSWORD}`);
}

main()
  .then(() => pool.end())
  .catch((err: unknown) => {
    console.error('❌ Seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });