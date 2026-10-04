import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { PROVIDER_UPLOADS_DIR, ensureUploadDirs } from '../config/uploads';
import { HttpError } from '../shared/httpError';

/**
 * Reusable multipart upload configuration (Phase 20).
 *
 * Lives here rather than inside a route handler so every upload surface shares
 * one policy, and so the rules below are reviewable in a single place.
 */

/** 5 MB per file. Images for a service listing rarely need more. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** At most 10 files in a single request. */
export const MAX_IMAGE_FILES = 10;

/**
 * Allowed types. The key is the MIME type the client declared; the value is the
 * extension WE write to disk.
 *
 * The extension is derived from this table, never from the uploaded filename —
 * a client can send `payload.php` declared as `image/png` and we would
 * otherwise write it with that name. Since the value comes from a closed map it
 * is always one of these three literals and can never carry a path separator.
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const ACCEPTED_IMAGE_LABEL = 'JPG, PNG or WebP';

/**
 * Storage engine. Filenames are a fresh UUID plus an extension looked up from
 * ALLOWED_IMAGE_TYPES, so they are unique (no overwrite race between two
 * providers), contain no user input, and cannot escape the upload directory.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb: (error: Error | null, destination: string) => void) {
    // Defensive: app.ts already calls this at boot, but the engine must not
    // depend on import order.
    ensureUploadDirs();
    cb(null, PROVIDER_UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
    if (!ext) {
      // The filename callback signature requires a filename even on the error
      // path; an empty string is never used because the error aborts the write.
      cb(new HttpError(400, `Invalid request — images must be ${ACCEPTED_IMAGE_LABEL}`), '');
      return;
    }
    cb(null, `${randomUUID()}${ext}`);
  },
});

/**
 * Reject anything not in the allow-list BEFORE it is written to disk.
 *
 * `cb(error)` propagates to the error handler, so an unsupported type produces a
 * 400 with a useful message rather than being silently skipped.
 */
function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
    cb(new HttpError(400, `Invalid request — images must be ${ACCEPTED_IMAGE_LABEL}`));
    return;
  }
  cb(null, true);
}

/**
 * The upload policy, shared by BOTH galleries.
 *
 * `limits.fileSize` and `limits.files` are enforced by Multer itself and surface
 * as `MulterError`, which `middleware/errorHandler` translates into safe 4xx
 * responses. Together with `fileFilter` that gives three independent gates:
 * type, size and count.
 *
 * Declared once and used for business images and service images: duplicating
 * these numbers would let the two galleries drift apart, and a provider would
 * reasonably expect "5 MB, 10 files" to mean the same thing in both places.
 */
const uploadPolicy = {
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGE_FILES,
  },
};

/** Multer middleware for the provider's overall business gallery. */
export const providerImageUpload = multer(uploadPolicy);

/**
 * The same policy for a SERVICE's own photos.
 *
 * Only the storage DESTINATION differs in principle — service photos belong in a
 * sibling directory so deleting a business photo can never unlink a service
 * photo. Both live under the same served mount today, which is why the static
 * handler in app.ts exposes `/uploads/providers` for both.
 */
export const serviceImageUpload = multer(uploadPolicy);


/**
 * The controller-facing shape of a successful upload.
 *
 * The ORIGINAL filename is deliberately not exposed to the client: it is user
 * input, it is unused (we serve by our own generated name), and echoing it back
 * invites echoing it into a response header later.
 */
export interface UploadedFileInfo {
  storedFilename: string;
  originalName: string;
  mimetype: string;
  size: number;
}

/** Narrow `req.files` (which Multer types as a bare array) into our shape. */
export function uploadedFiles(
  files: Express.Multer.File[] | undefined,
): UploadedFileInfo[] {
  return (files ?? []).map((file) => ({
    storedFilename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  }));
}