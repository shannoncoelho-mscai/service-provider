import { Star } from 'lucide-react';

interface RatingStarsProps {
  /** Mean rating, or null when the provider has no reviews yet. */
  rating: number | null;
  reviewCount?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Star rating. Unrated providers (rating === null) are shown honestly as
 * "New" rather than as a misleading 0-star score.
 */
export default function RatingStars({
  rating,
  reviewCount,
  size = 'sm',
  className = '',
}: RatingStarsProps) {
  const box = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  if (rating === null) {
    return (
      <span className={`text-xs font-medium text-ink-soft ${className}`}>
        New to ServiceConnect
      </span>
    );
  }

  const filled = Math.round(rating);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="inline-flex" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <Star
            key={index}
            className={`${box} ${
              index < filled ? 'fill-accent-400 text-accent-400' : 'text-line'
            }`}
          />
        ))}
      </span>
      <span className="text-sm font-semibold text-ink">{rating.toFixed(1)}</span>
      {reviewCount !== undefined && (
        <span className="text-xs text-ink-soft">
          ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
        </span>
      )}
      <span className="sr-only">
        Rated {rating.toFixed(1)} out of 5 from {reviewCount ?? 0} reviews
      </span>
    </span>
  );
}
