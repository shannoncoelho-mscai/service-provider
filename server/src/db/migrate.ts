import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { pool } from '../config/database';

/**
 * Migration runner (see ADR-010).
 *
 * - Plain SQL files in database/migrations, applied in filename order.
 * - Applied migrations are recorded in `schema_migrations` with a SHA-256
 *   checksum; editing an already-applied file is detected and refused.
 * - Each file runs inside its own transaction — a failing migration rolls back
 *   completely and stops the run.
 *
 * Usage:  npm run migrate --workspace server
 */

// Works from both src (tsx) and dist (compiled): server/src/db and server/dist/db.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      throw new Error(`No .sql migrations found in ${MIGRATIONS_DIR}`);
    }

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      );

      if ((existing.rowCount ?? 0) > 0) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `Checksum mismatch for "${file}" — it changed after being applied. ` +
              'Create a new migration instead of editing an applied one.',
          );
        }
        console.log(`  skip    ${file}`);
        continue;
      }

      console.log(`  apply   ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('✅ Migrations complete.');
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err: unknown) => {
    console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
