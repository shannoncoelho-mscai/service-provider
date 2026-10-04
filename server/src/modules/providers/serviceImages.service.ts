import { pool } from '../../config/database';
import { publicUrlForUpload } from '../../config/uploads';
import { HttpError } from '../../shared/httpError';
import { removeStoredFile } from './images.service';
import type { UploadedFileInfo } from '../../middleware/upload';

/**
 * Per-SERVICE image management (Phase 21).
 *
 * Distinct from `provider_images` (see images.service.ts): those are photos of
 * the business generally, these are photos of ONE service — the AC unit, the
 * technician, the finished repair.
 *
 * OWNERSHIP — the same rule as services (ADR-020), applied one level deeper.
 * `providerId` is never read from the request; it is always `req.user.id`. The
 * service id comes from the URL `:id`, but it is only ever used together with
 * `provider_id = $n` in the WHERE clause. So a provider who pastes provider B's
 * service id into their own URL matches zero rows and gets the SAME 404 as a
 * service that does not exist — no enumeration oracle, no cross-tenant write.
 */

export interface ServiceImageDto {
  id: string;
  serviceId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  createdAt: Date;
}

interface ServiceImageRow {
  id: string;
  service_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: Date;
}

const SELECT_SERVICE_IMAGE = 'id, service_id, url, alt_text, sort_order, created_at';

function toDto(row: ServiceImageRow): ServiceImageDto {
  return {
    id: row.id,
    serviceId: row.service_id,
    url: row.url,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

/**
 * Prove that `serviceId` belongs to `providerId`.
 *
 * The join to `services` IS the ownership check — it is what makes every other
 * statement in this file safe to write without repeating a `provider_id`
 * predicate (service_images has no such column; it hangs off service_id).
 * Throws the shared 404.
 */
async function assertOwnsService(providerId: string, serviceId: string): Promise<void> {
  const res = await pool.query('SELECT 1 FROM services WHERE id = $1 AND provider_id = $2', [
    serviceId,
    providerId,
  ]);
  if (res.rowCount === 0) throw new HttpError(404, 'Service not found');
}

/**
 * GET /api/providers/me/services/:id/images
 *
 * Ownership is proven before the read, so the response can never describe a
 * service this provider does not own.
 */
export async function listServiceImages(
  providerId: string,
  serviceId: string,
): Promise<ServiceImageDto[]> {
  await assertOwnsService(providerId, serviceId);

  const res = await pool.query<ServiceImageRow>(
    `SELECT ${SELECT_SERVICE_IMAGE}
       FROM service_images
      WHERE service_id = $1
      ORDER BY sort_order ASC, created_at ASC`,
    [serviceId],
  );
  return res.rows.map(toDto);
}

/**
 * POST /api/providers/me/services/:id/images
 *
 * Transaction, like `createImages`, so `sort_order` is computed against a
 * consistent snapshot. The ownership check happens INSIDE the transaction so a
 * service deleted between the check and the insert cannot receive orphan rows.
 */
export async function createServiceImages(
  providerId: string,
  serviceId: string,
  files: UploadedFileInfo[],
  altText: string | null,
): Promise<ServiceImageDto[]> {
  if (files.length === 0) {
    throw new HttpError(400, 'Invalid request — no images were uploaded');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const owner = await client.query(
      'SELECT 1 FROM services WHERE id = $1 AND provider_id = $2',
      [serviceId, providerId],
    );
    if (owner.rowCount === 0) throw new HttpError(404, 'Service not found');

    const counts = await client.query<{ next_order: number }>(
      `SELECT COALESCE(max(sort_order), -1) + 1 AS next_order
         FROM service_images
        WHERE service_id = $1`,
      [serviceId],
    );
    const { next_order } = counts.rows[0];

    const inserted: ServiceImageDto[] = [];
    for (const [index, file] of files.entries()) {
      const res = await client.query<ServiceImageRow>(
        `INSERT INTO service_images (service_id, url, alt_text, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SELECT_SERVICE_IMAGE}`,
        [serviceId, publicUrlForUpload(file.storedFilename), altText, next_order + index],
      );
      inserted.push(toDto(res.rows[0]));
    }

    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    // Multer already wrote these files to disk before we got here. Without this
    // the request would leave bytes on disk that no row references, and the
    // provider's gallery would silently accumulate junk. Best-effort, and
    // deliberately AFTER the rollback so we never unlink a file whose row the
    // transaction actually committed.
    await Promise.all(
      files.map((f) => removeStoredFile(publicUrlForUpload(f.storedFilename))),
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/providers/me/services/:id/images/:imageId
 *
 * Deletes the row first, owner-scoped through the `EXISTS` subquery. Only a row
 * that really belongs to this provider's service reaches the filesystem delete,
 * so this endpoint cannot be used to unlink another tenant's file by id.
 */
export async function deleteServiceImage(
  providerId: string,
  serviceId: string,
  imageId: string,
): Promise<void> {
  const deleted = await pool.query<{ url: string }>(
    `DELETE FROM service_images
      WHERE id = $1
        AND service_id = $2
        AND EXISTS (
              SELECT 1 FROM services
               WHERE id = $2 AND provider_id = $3
            )
      RETURNING url`,
    [imageId, serviceId, providerId],
  );
  // Same 404 for "not yours", "wrong service" and "does not exist".
  if (deleted.rowCount === 0) throw new HttpError(404, 'Service image not found');

  await removeStoredFile(deleted.rows[0].url);
}
