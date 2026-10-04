import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pool } from '../../config/database';
import { PROVIDER_UPLOADS_DIR, publicUrlForUpload } from '../../config/uploads';
import { HttpError } from '../../shared/httpError';
import type { UploadedFileInfo } from '../../middleware/upload';

/**
 * Provider business image management (Phase 20).
 *
 * OWNERSHIP — the same rule as services (ADR-020): `providerId` is NEVER read
 * from the URL, body or query. It is always `req.user.id`, resolved from the
 * verified token. Every statement filters `WHERE provider_id = $n`, and DELETE
 * filters on BOTH `id` and `provider_id`, so provider A passing provider B's
 * image id gets the same 404 as a non-existent id — no enumeration oracle.
 *
 * The public gallery needs no work here: `GET /api/providers/:id` already reads
 * `provider_images` and returns them through `PublicImageDto`, so a row created
 * here appears on the public profile automatically.
 */

/**
 * The provider's own view of an image. Richer than `PublicImageDto` because the
 * owner needs the row id (to delete it), the primary flag and the sort order.
 * `PublicImageDto` stays unchanged so the public contract cannot drift.
 */
export interface ProviderImageDto {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

interface ImageRow {
  id: string;
  url: string;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
}

function toDto(row: ImageRow): ProviderImageDto {
  return {
    id: row.id,
    url: row.url,
    altText: row.alt_text,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  };
}

/**
 * GET /api/providers/me/images — the caller's own images, primary first.
 */
export async function listMyImages(providerId: string): Promise<ProviderImageDto[]> {
  const res = await pool.query<ImageRow>(
    `SELECT id, url, alt_text, is_primary, sort_order
       FROM provider_images
      WHERE provider_id = $1
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
    [providerId],
  );
  return res.rows.map(toDto);
}

/**
 * Insert rows for freshly stored files.
 *
 * TRANSACTION + ROW LOCK. Two things make this safe:
 *   1. `SELECT … FROM provider_profiles WHERE user_id = $1 FOR UPDATE`
 *      serialises concurrent uploads from the SAME provider, so the
 *      "is this their first image?" decision cannot interleave.
 *   2. `uq_provider_images_primary` is a partial unique index, so a second
 *      primary would be a hard 23505. The lock makes that unreachable rather
 *      than catching it after the fact.
 *
 * `isPrimary` is only ever true for a provider's FIRST image, so a multi-file
 * request can never mark several rows primary.
 */
export async function createImages(
  providerId: string,
  files: UploadedFileInfo[],
  altText: string | null,
  makePrimary: boolean,
): Promise<ProviderImageDto[]> {
  if (files.length === 0) {
    throw new HttpError(400, 'Invalid request — no images were uploaded');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ownership is proven here: no provider_profiles row means this user is not
    // a provider, and the request is refused before any insert.
    const owner = await client.query(
      'SELECT user_id FROM provider_profiles WHERE user_id = $1 FOR UPDATE',
      [providerId],
    );
    if (owner.rowCount === 0) throw new HttpError(404, 'Provider profile not found');

    const counts = await client.query<{ existing: number; next_order: number }>(
      `SELECT count(*)::int AS existing,
              COALESCE(max(sort_order), -1) + 1 AS next_order
         FROM provider_images
        WHERE provider_id = $1`,
      [providerId],
    );
    const { existing, next_order } = counts.rows[0];

    // First image becomes the primary; afterwards never. An explicit
    // makePrimary from a provider who already has images is ignored rather than
    // rejected, so the UI affordance stays simple.
    const primary = makePrimary && existing === 0;

    const inserted: ProviderImageDto[] = [];
    for (const [index, file] of files.entries()) {
      const res = await client.query<ImageRow>(
        `INSERT INTO provider_images
           (provider_id, url, alt_text, is_primary, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, url, alt_text, is_primary, sort_order`,
        [
          providerId,
          publicUrlForUpload(file.storedFilename),
          altText,
          // Only the very first file of a first-ever upload can be primary.
          primary && index === 0,
          next_order + index,
        ],
      );
      inserted.push(toDto(res.rows[0]));
    }

    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    // Multer wrote these files to disk before the transaction started. If the
    // transaction failed, no row references them, so unlink them here rather
    // than leaving unreachable files behind. Best-effort and AFTER the ROLLBACK
    // so a committed row can never have its file removed.
    await Promise.all(
      files.map((f) => removeStoredFile(publicUrlForUpload(f.storedFilename))),
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/providers/me/images/:id — remove the row and the file.
 *
 * The row is deleted FIRST and owner-scoped; only a row this provider actually
 * owned reaches the filesystem delete, so this endpoint cannot be used to delete
 * another provider's file by guessing an id.
 */
export async function deleteImage(providerId: string, imageId: string): Promise<void> {
  const deleted = await pool.query<{ url: string }>(
    `DELETE FROM provider_images
      WHERE id = $1
        AND provider_id = $2
      RETURNING url`,
    [imageId, providerId],
  );
  // Same 404 for "not yours" and "does not exist".
  if (deleted.rowCount === 0) throw new HttpError(404, 'Image not found');

  await removeStoredFile(deleted.rows[0].url);
}

/**
 * Delete the local file backing a stored URL.
 *
 * Best-effort on purpose: the row is already gone, and a missing or unreadable
 * file must not turn a successful delete into a 500. The filename comes from
 * `basename(url)` so `..` segments cannot traverse out of the directory.
 */
export async function removeStoredFile(url: string): Promise<void> {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return; // Not a URL we wrote — leave whatever it points at alone.
  }

  const filename = basename(pathname);
  if (!filename || filename === '.' || filename === '..') return;

  const target = join(PROVIDER_UPLOADS_DIR, filename);
  // Belt and braces: confirm the resolved path is still inside the directory.
  if (!target.startsWith(PROVIDER_UPLOADS_DIR)) return;

  try {
    await unlink(target);
  } catch {
    // ENOENT (already gone) or a permissions problem: nothing actionable here.
  }
}
