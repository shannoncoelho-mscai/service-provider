import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';

/**
 * Local file storage for uploaded media (Phase 20).
 *
 * DEVELOPMENT-ONLY BY DESIGN. Files land on the API server's disk and are served
 * back through `express.static`. That is appropriate for a local college
 * deployment and deliberately simple; it is NOT how images should be stored in
 * production, where the fix is object storage plus a CDN and signed URLs. The
 * database contract does not change either way — `provider_images.url` is
 * already an http(s) URL, so pointing it at S3/CDN later is a config change.
 *
 * The directory is resolved from THIS file's location, never from
 * `process.cwd()`, so it is correct whether the server is started from the repo
 * root, from `server/`, or from a compiled `dist/` build.
 */

/** `server/uploads/providers` — dev tsx and compiled dist resolve the same way. */
export const UPLOADS_ROOT = join(__dirname, '..', '..', 'uploads');
export const PROVIDER_UPLOADS_DIR = join(UPLOADS_ROOT, 'providers');

/** URL prefix served by the API. Kept in one place so routes and rows agree. */
export const PROVIDER_UPLOADS_URL_PREFIX = '/uploads/providers';

/**
 * Create the upload directories if they are missing.
 *
 * Called once at boot from app.ts so the very first upload cannot fail with
 * ENOENT, and called defensively again by the storage engine. `recursive`
 * means the parent `uploads/` directory is created too.
 */
export function ensureUploadDirs(): void {
  mkdirSync(PROVIDER_UPLOADS_DIR, { recursive: true });
}

/**
 * The public http(s) URL for a stored filename.
 *
 * `provider_images.url` has a `CHECK (url ~ '^https?://')`, so a bare path
 * cannot be stored — the row needs a full URL. Built from the configured PORT
 * rather than a hardcoded 4000 so the row is correct on any port, and so
 * tests running the app on an ephemeral port do not write unreachable URLs.
 */
export function publicUrlForUpload(filename: string): string {
  return `http://localhost:${env.PORT}${PROVIDER_UPLOADS_URL_PREFIX}/${filename}`;
}
