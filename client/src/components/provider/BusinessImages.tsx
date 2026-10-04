import { ImageOff, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  IMAGE_ACCEPT,
  IMAGE_ACCEPT_LABEL,
  MAX_IMAGE_FILES,
  deleteProviderImage,
  listMyProviderImages,
  uploadProviderImages,
  validateFiles,
} from '../../lib/api';
import type { ProviderImage } from '../../types';
import { Alert } from '../ui';

/**
 * Re-exported for backwards compatibility.
 *
 * `validateFiles` and `readableSize` moved to `lib/api` in Phase 21 so that
 * `ServiceImages` could share them; the business-images tests still import them
 * from here, and the module boundary a reader expects has not changed.
 */
export { readableSize, validateFiles } from '../../lib/api';

/**
 * "Business Images" — the provider's own gallery manager (Phase 20).
 *
 * Owns the full loop: pick files, preview them locally, upload as multipart,
 * and delete. The public gallery is NOT reimplemented here — uploaded rows are
 * already returned by `GET /api/providers/:id` and rendered by the existing
 * `ImageGallery`, so this is only the management surface.
 *
 * These are photos of the BUSINESS generally (shopfront, team, van). Photos of a
 * single job belong to `ServiceImages`, a separate section in the service
 * editor — the two are never combined.
 *
 * `validateFiles` now lives in `lib/api` next to the limits it enforces,
 * because `ServiceImages` enforces the identical rules and a second copy would
 * drift. It is re-exported below so existing imports of this module still work.
 */
export default function BusinessImages() {
  const [images, setImages] = useState<ProviderImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setImages(await listMyProviderImages());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'We could not load your images. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Blob URLs are created eagerly and revoked whenever the selection changes, so
   * re-picking the same file cannot leak one per selection.
   */
  function selectFiles(files: File[]) {
    setPicked(files);
    setError(null);
    setNotice(null);
    setPreviews(files.map((file) => URL.createObjectURL(file)));
  }

  function clearSelection() {
    setPicked([]);
    setPreviews([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  useEffect(() => {
    return () => {
      for (const url of previews) URL.revokeObjectURL(url);
    };
  }, [previews]);

  async function handleUpload() {
    if (uploading || picked.length === 0) return;

    const problem = validateFiles(picked);
    if (problem) {
      setError(problem);
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const created = await uploadProviderImages(picked);
      setNotice(
        created.length === 1 ? '1 image uploaded.' : `${created.length} images uploaded.`,
      );
      clearSelection();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload those images.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(image: ProviderImage) {
    if (deletingId) return;
    setDeletingId(image.id);
    setError(null);
    setNotice(null);
    try {
      await deleteProviderImage(image.id);
      // Drop it locally rather than refetching: the server already removed the
      // row and the file, so the previous list minus this row is the truth.
      setImages((current) => current.filter((item) => item.id !== image.id));
      setNotice('Image removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not remove that image.');
    } finally {
      setDeletingId(null);
    }
  }

return (
    <section className="card p-5" aria-labelledby="business-images-heading">
      <h2
        id="business-images-heading"
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <Upload className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Business Images
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Photos of your work appear on your public profile. {IMAGE_ACCEPT_LABEL}, up to 5 MB each,
        up to {MAX_IMAGE_FILES} at a time.
      </p>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {notice && !error && (
        <div className="mt-4">
          <Alert variant="info">{notice}</Alert>
        </div>
      )}

      {/* Upload --------------------------------------------------------- */}
      <div className="mt-4">
        <label htmlFor="business-image-input" className="block text-sm font-semibold text-ink">
          Add photos
        </label>
        <input
          id="business-image-input"
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          disabled={uploading}
          onChange={(e) => selectFiles(Array.from(e.target.files ?? []))}
          className="mt-1.5 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
        />

        {/* Previews of the selection, before anything is sent. */}
        {picked.length > 0 && (
          <>
            <ul className="mt-3 flex flex-wrap gap-2">
              {picked.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="h-20 w-20 overflow-hidden rounded-lg border border-line"
                >
                  <img
                    src={previews[index]}
                    alt={`Selected file: ${file.name}`}
                    className="h-full w-full object-cover"
                  />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="btn btn-primary px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Uploading...
                  </>
                ) : (
                  `Upload ${picked.length} image${picked.length === 1 ? '' : 's'}`
                )}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={uploading}
                className="btn btn-ghost px-4 py-2.5 text-sm"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>

      {/* Existing images ----------------------------------------------- */}
      <div className="mt-6">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your images...
          </p>
        ) : images.length === 0 ? (
          <p className="rounded-xl bg-canvas px-4 py-6 text-center text-sm text-ink-soft">
            No images yet. Add a few photos of your work — providers with photos get more
            bookings.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <li
                key={image.id}
                className="relative overflow-hidden rounded-xl border border-line bg-brand-50"
              >
                <img
                  src={image.url}
                  alt={image.altText ?? 'Business image'}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                {image.isPrimary && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star className="h-3 w-3" aria-hidden="true" />
                    Primary
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(image)}
                  disabled={deletingId !== null}
                  aria-label={`Delete image${image.altText ? `: ${image.altText}` : ''}`}
                  className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-red-600 shadow-soft transition-colors hover:bg-white disabled:opacity-50"
                >
                  {deletingId === image.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && images.length === 0 && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          Images are shown publicly only once your profile is approved.
        </p>
      )}
    </section>
  );
}