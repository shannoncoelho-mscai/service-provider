import { CheckCircle2, Star } from 'lucide-react';
import { canReview, ratingLabel } from '../../lib/booking-utils';
import type { BookingStatus, MyReview } from '../../types';
import ReviewForm from './ReviewForm';

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * The review section on a booking detail page (ADR-028).
 *
 * Three states, and the FIRST rule decides which:
 *   COMPLETED + no review      -> the form
 *   COMPLETED + review exists  -> the stored review, read-only
 *   anything else              -> nothing at all
 *
 * The "already reviewed" state matters: after a successful submission the form
 * is replaced by the review the server returned, so a customer cannot submit
 * twice from the same page, and the rating shown is the stored one rather than
 * whatever was last typed.
 */
export default function BookingReviewSection({
  bookingId,
  status,
  providerName,
  review,
  onCreated,
}: {
  bookingId: string;
  status: BookingStatus;
  providerName: string | null;
  /** The review for this booking, if one has already been written. */
  review?: MyReview | null;
  onCreated: (review: MyReview) => void;
}) {
  // Nothing at all for a booking that is not COMPLETED — no heading, no
  // disabled form, nothing to click.
  if (!canReview(status)) return null;

  if (review) {
    return (
      <section aria-labelledby="review-heading" className="card p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <h2 id="review-heading" className="font-display text-base font-bold text-ink">
            Review submitted
          </h2>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <span className="inline-flex" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-4 w-4 ${
                  star <= review.rating ? 'fill-accent-400 text-accent-400' : 'text-line'
                }`}
              />
            ))}
          </span>
          <span className="text-sm text-ink-soft">
            {ratingLabel(review.rating)}
            {formatDate(review.createdAt) ? ` · ${formatDate(review.createdAt)}` : ''}
          </span>
        </div>

        {review.comment ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
            {review.comment}
          </p>
        ) : (
          <p className="mt-3 text-sm italic text-ink-soft/80">
            You rated this booking without leaving a comment.
          </p>
        )}

        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-soft">
          Your review is shown publicly without your name. Each booking can be reviewed once.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-form-heading">
      <h2 id="review-form-heading" className="sr-only">
        Leave a review
      </h2>
      <ReviewForm bookingId={bookingId} providerName={providerName} onCreated={onCreated} />
    </section>
  );
}