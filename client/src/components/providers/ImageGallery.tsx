import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { initialsOf } from '../../lib/format';
import type { PublicImage, PublicProvider } from '../../types';

interface ImageGalleryProps {
  images: PublicImage[];
  provider: PublicProvider;
}

/**
 * Image gallery: a cover banner, the avatar, then any additional gallery
 * images. A single broken image URL degrades to a branded placeholder rather
 * than a browser "broken image" icon, and the gallery is hidden entirely when
 * a provider has no images at all.
 */
export default function ImageGallery({ images, provider }: ImageGalleryProps) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const extras = images.filter((image) => !failed.has(image.url));

  function markFailed(url: string) {
    setFailed((prev) => new Set(prev).add(url));
  }

  const monogram = initialsOf(provider.businessName);

  return (
    <>
      {/* Cover ---------------------------------------------------------- */}
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-brand-200 via-brand-100 to-accent-50 sm:h-56">
        {provider.coverImageUrl && !failed.has(provider.coverImageUrl) ? (
          <img
            src={provider.coverImageUrl}
            alt=""
            onError={() => markFailed(provider.coverImageUrl!)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div aria-hidden="true" className="h-full w-full bg-dot-grid opacity-40" />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/25 to-transparent" />
      </div>

      {/* Avatar --------------------------------------------------------- */}
      <div className="relative -mt-14 sm:-mt-16">
        <div className="mx-auto w-28 overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-brand-100 to-brand-50 shadow-lift sm:mx-0 sm:w-32">
          {provider.profileImageUrl && !failed.has(provider.profileImageUrl) ? (
            <img
              src={provider.profileImageUrl}
              alt={`${provider.businessName} logo`}
              onError={() => markFailed(provider.profileImageUrl!)}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center font-display text-3xl font-bold text-brand-400">
              {monogram}
            </div>
          )}
        </div>
      </div>

      {/* Extra gallery images ------------------------------------------- */}
      {extras.length > 0 && (
        <section aria-labelledby="gallery-heading" className="mt-8">
          <h2 id="gallery-heading" className="text-lg font-semibold text-ink">
            Gallery
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {extras.map((image) => (
              <li
                key={image.url}
                className="aspect-[4/3] overflow-hidden rounded-xl border border-line bg-brand-50"
              >
                <img
                  src={image.url}
                  alt={image.altText ?? `${provider.businessName} work`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {images.length > extras.length && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
          {images.length - extras.length} image
          {images.length - extras.length === 1 ? '' : 's'} could not be loaded
        </p>
      )}
    </>
  );
}
