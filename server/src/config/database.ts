import { Pool } from 'pg';
import { env } from './env';

/**
 * Single shared connection pool.
 * All queries elsewhere MUST use parameters ($1, $2, …) — never string
 * concatenation — to prevent SQL injection (see docs/SECURITY.md).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Unexpected pool error (e.g. DB restarted) — log, never crash silently.
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
