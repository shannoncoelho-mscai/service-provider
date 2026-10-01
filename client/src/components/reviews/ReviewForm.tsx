import { Loader2, Send, Star } from 'lucide-react';
import { useState } from 'react';
import { ApiError, createReview } from '../../lib/api';
import { REVIEW_COMMENT_MAX, ratingLabel, validateReview } from '../../lib/booking-utils';
import type { MyReview } from '../../types';
import { Alert, inputClass } from '../ui';

/**
 * Star rating control.
 *
 * Implemented as a RADIO GROUP, which is what a rating is: five native radios
 * sharing a name, styled as stars. That buys arrow-key navigation, a real form
 * value, and a screen-reader-announced position for free — all of which a row of
 * clickable icons would have to reimplement, and probably get wrong.
 *
 * The selected state is shown by filling every star up to the choice, and each
 * star carries its own accessible name ("1 star" … "5 stars").
 */
function StarPicker({
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const filled = value ?? 0;
  return (
    <div
      role="radiogroup"
      aria-label="Your rating out of 5"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className="inline-flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((rating) => (
        <label
          key={rating}
          className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-accent-50 ${
            disabled ? 'cursor-not-allowed opacity-60' : ''
          }`}
        >
          <input
            type="radio"
            name="rating"
            value={rating}
            checked={value === rating}
            onChange={() => onChange(rating)}
            disabled={disabled}
            className="sr-only"
          />
          <Star
            className={`h-7 w-7 transition-colors ${
              rating <= filled ? 'fill-accent-400 text-accent-400' : 'text-line'
            }`}
            aria-hidden="true"
          />
          <span className="sr-only">{ratingLabel(rating)}</span>
        </label>
      ))}
    </div>
  );
}

/** Map an API failure to customer-facing copy. Never a raw server message. */
function explain(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  switch (status) {
    case 400:
      return 'That review was not accepted. Please check your rating and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'Only customer accounts can leave reviews.';
    case 404:
      return 'That booking could not be found.';
    case 409:
      return 'This booking cannot be reviewed yet, or you have already reviewed it.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}

/**
 * The "Leave a Review" form for a COMPLETED booking (ADR-028).
 *
 * CONTRACT: submits only `{ bookingId, rating, comment? }`. There is no field
 * for a customer id or a provider id — the reviewer is the session and the
 * reviewed provider comes from the booking, both server-side. The server also
 * rejects those keys outright.
 *
 * After success the parent is handed the review the SERVER returned; the form
 * never optimistically claims a review exists.
 */
export default function ReviewForm({
  bookingId,
  providerName,
  onCreated,
}: {
  bookingId: string;
  providerName: string | null;
  onCreated: (review: MyReview) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{ rating?: string; comment?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A double submit must not fire two POSTs; the server would 409 the second.
    if (submitting) return;

    const found = validateReview({ rating, comment });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const review = await createReview({
        bookingId,
        // Non-null here: validateReview rejects null above.
        rating: rating as number,
        ...(comment.trim() ? { comment } : {}),
      });
      onCreated(review);
    } catch (error) {
      setFormError(explain(error));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card p-5">
      <h3 className="font-display text-base font-bold text-ink">How did it go?</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Your review is public and helps other customers choose
        {providerName ? (
          <>
            {' '}
            <span className="font-medium text-ink">{providerName}</span>
          </>
        ) : (
          ' this provider'
        )}
        . Reviews are shown without your name.
      </p>

      {formError && (
        <div className="mt-4">
          <Alert>{formError}</Alert>
        </div>
      )}

      <div className="mt-5">
        <p className="text-sm font-semibold text-ink">
          Rating
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        </p>
        <div className="mt-1.5">
          <StarPicker
            value={rating}
            onChange={(next) => {
              setRating(next);
              setErrors((prev) => ({ ...prev, rating: undefined }));
            }}
            disabled={submitting}
            invalid={Boolean(errors.rating)}
            describedBy={errors.rating ? 'review-rating-error' : undefined}
          />
        </div>
        {errors.rating && (
          <p id="review-rating-error" role="alert" className="mt-1.5 text-xs text-red-600">
            {errors.rating}
          </p>
        )}
      </div>

      <div className="mt-5">
        <label htmlFor="review-comment" className="block text-sm font-semibold text-ink">
          Comment
          <span className="ml-1.5 text-xs font-normal text-ink-soft">Optional</span>
        </label>
        <p className="mt-1 text-xs text-ink-soft">
          {comment.length} / {REVIEW_COMMENT_MAX}
        </p>
        <textarea
          id="review-comment"
          rows={3}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value.slice(0, REVIEW_COMMENT_MAX));
            setErrors((prev) => ({ ...prev, comment: undefined }));
          }}
          disabled={submitting}
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={errors.comment ? 'review-comment-error' : undefined}
          placeholder="e.g. Arrived on time, explained the problem clearly, tidy work."
          className={`${inputClass} mt-1.5 resize-y`}
        />
        {errors.comment && (
          <p id="review-comment-error" role="alert" className="mt-1.5 text-xs text-red-600">
            {errors.comment}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="btn btn-primary mt-6 w-full px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Submitting...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" aria-hidden="true" />
            Submit review
          </>
        )}
      </button>
    </form>
  );
}
