import { Star } from 'lucide-react';
import type { PublicReview } from '../../types';

interface ReviewListProps {
  reviews: PublicReview[];
  totalCount: number;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/**
 * Public reviews.
 *
 * Reviews are anonymous by design: the API returns only rating, comment and
 * date — no reviewer id, name or email — so nothing identifying is rendered
 * here. `totalCount` is the true review total from the search stats, which can
 * exceed the number of most-recent reviews actually listed.
 */
export default function ReviewList({ reviews, totalCount }: ReviewListProps) {
  if (totalCount === 0) {
    return (
      <p className="card p-6 text-center text-sm text-ink-soft">
        No reviews yet. Be the first to book and review this provider.
      </p>
    );
  }

  return (
    <>
      <ul className="mt-4 space-y-3">
        {reviews.map((review, index) => (
          <li key={`${review.createdAt}-${index}`} className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((star) => (
                  <Star
                    key={star}
                    className={`h-4 w-4 ${
                      star < review.rating ? 'fill-accent-400 text-accent-400' : 'text-line'
                    }`}
                  />
                ))}
              </span>
              <time
                dateTime={review.createdAt}
                className="shrink-0 text-xs text-ink-soft"
              >
                {formatDate(review.createdAt)}
              </time>
            </div>
            {review.comment ? (
              <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{review.comment}</p>
            ) : (
              <p className="mt-2.5 text-sm italic text-ink-soft/70">
                Rated {review.rating} out of 5 without a comment.
              </p>
            )}
            <p className="sr-only">Anonymous review, rated {review.rating} out of 5</p>
          </li>
        ))}
      </ul>

      {totalCount > reviews.length && (
        <p className="mt-3 text-sm text-ink-soft">
          Showing the {reviews.length} most recent of {totalCount} reviews.
        </p>
      )}
    </>
  );
}
