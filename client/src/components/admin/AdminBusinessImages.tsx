import { ImageOff, Images, Star } from 'lucide-react';
import type { AdminProviderImage } from '../../types';

/**
 * "Business photos" on the admin review screen (Phase 21) — READ-ONLY.
 *
 * An admin is deciding whether to approve a real business, and photos are the
 * most direct evidence of that. This component therefore only DISPLAYS what the
 * provider uploaded.
 *
 * There are deliberately no controls here — no upload, no delete, no "set
 * primary", and no way to reorder. Two reasons:
 *   1. Managing the gallery is the provider's job; the API has no admin image
 *      endpoints at all, so any such control would be non-functional by design.
 *   2. A reviewer must be able to judge the evidence without being able to
 *      alter it.
 *
 * Data arrives through `AdminProviderView`, the allow-list projection in
 * `lib/admin-utils`, so this component cannot render a field that was never
 * deliberately copied out of the admin response.
 */
export default function AdminBusinessImages({ images }: { images: AdminProviderImage[] }) {
  return (
    <section className="card p-5" aria-labelledby="admin-business-images-heading">
      <h2 id="admin-business-images-heading" className="text-sm font-semibold text-ink">
        Business photos
        <span className="ml-2 font-normal text-ink-soft">{images.length} uploaded</span>
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Photos the provider uploaded of their business. Read-only — they cannot be changed from
        this screen.
      </p>

      {images.length === 0 ? (
        <p className="mt-3 rounded-xl bg-canvas px-4 py-4 text-sm text-ink-soft">
          This provider has not uploaded any business photos. That is not automatically a problem,
          but it is worth noting before approving.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <li
              key={image.id}
              className="relative overflow-hidden rounded-xl border border-line bg-brand-50"
            >
              <img
                src={image.url}
                // Fall back to a generic label rather than an empty alt: the image
                // is meaningful content on a page a reviewer is reading closely,
                // so it must never be announced as unlabelled.
                alt={image.altText ?? 'Business photo uploaded by this provider'}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              {image.isPrimary && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Star className="h-3 w-3" aria-hidden="true" />
                  Primary
                </span>
              )}
              {image.altText && (
                <p className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[11px] text-white">
                  {image.altText}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {images.length === 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          No photos to inspect for this application.
        </p>
      )}

      {images.length > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <Images className="h-3.5 w-3.5" aria-hidden="true" />
          These photos are not visible to customers until this provider is approved.
        </p>
      )}
    </section>
  );
}