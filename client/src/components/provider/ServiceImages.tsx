import { ImageOff, Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  IMAGE_ACCEPT,
  IMAGE_ACCEPT_LABEL,
  MAX_IMAGE_FILES,
  deleteServiceImage,
  listServiceImages,
  uploadServiceImages,
  validateFiles,
} from '../../lib/api';
import type { ServiceImage } from '../../types';
import { Alert } from '../ui';

/**
 * "Service Images" — photos attached to ONE service (Phase 21).
 *
 * SCOPE, and why this is a separate component from BusinessImages:
 *   Business images = who this business is (shopfront, team, van).
 *   Service images  = what this particular job looks like (the AC unit, the
 *                     technician, the finished repair).
 * A customer choosing between two AC services cares about the second, so the
 * two are never merged in the UI.
 *
 * `validateFiles` is imported from the API module rather than copied: the rules
 * are identical by design (same types, same 5 MB, same 10 files) and two copies
 * would drift apart.
 *
 * There is no "primary" concept here — unlike a business gallery there is no
 * single representative photo for a service, so the flag is not shown.
 */
export default function ServiceImages({ serviceId }: { serviceId: string }) {
  const [images, setImages] = useState<ServiceImage[]>([]);
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
      setImages(await listServiceImages(serviceId));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not load these service images. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  // Blob URLs are revoked whenever the selection changes, so re-picking the same
  // file cannot leak one object URL per selection.
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
      const created = await uploadServiceImages(serviceId, picked);
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

  async function handleDelete(image: ServiceImage) {
    if (deletingId) return;
    setDeletingId(image.id);
    setError(null);
    setNotice(null);
    try {
      await deleteServiceImage(serviceId, image.id);
      // Drop locally rather than refetching: the server removed both the row and
      // the file, so the previous list minus this row is already the truth.
      setImages((current) => current.filter((item) => item.id !== image.id));
      setNotice('Image removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not remove that image.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section
      className="mt-5 rounded-xl border border-line bg-canvas p-4"
      aria-labelledby={`service-images-${serviceId}`}
    >
      <h3
        id={`service-images-${serviceId}`}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <Upload className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Service Images
      </h3>
      <p className="mt-1 text-xs text-ink-soft">
        Photos specific to this service — the equipment, the work in progress, the finished job.
        These are separate from your general business photos.{' '}
        {IMAGE_ACCEPT_LABEL}, up to 5 MB each, up to {MAX_IMAGE_FILES} at a time.
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
        <label
          htmlFor={`service-image-input-${serviceId}`}
          className="block text-sm font-semibold text-ink"
        >
          Add photos for this service
        </label>
        <input
          id={`service-image-input-${serviceId}`}
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          disabled={uploading}
          onChange={(e) => selectFiles(Array.from(e.target.files ?? []))}
          className="mt-1.5 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
        />

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
      <div className="mt-5">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading service images...
          </p>
        ) : images.length === 0 ? (
          <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-ink-soft">
            No images for this service yet. Adding a few photos of similar work helps customers
            choose confidently.
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
                  alt={image.altText ?? 'Service image'}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => void handleDelete(image)}
                  disabled={deletingId !== null}
                  aria-label={`Delete service image${image.altText ? `: ${image.altText}` : ''}`}
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
          These photos are shown publicly only once your profile is approved.
        </p>
      )}
    </section>
  );
}