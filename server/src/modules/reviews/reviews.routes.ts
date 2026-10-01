import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { asyncHandler } from '../../shared/asyncHandler';
import { parseBody } from '../../shared/validate';
import { createReviewSchema } from './reviews.schemas';
import * as reviewService from './reviews.service';

/**
 * /api/reviews — CUSTOMER review endpoints (ADR-028).
 *
 *   POST /api/reviews     — review a COMPLETED booking
 *   GET  /api/reviews/my  — my own reviews
 *
 * The PUBLIC read path already exists and is not duplicated here: a provider's
 * reviews come from `GET /api/providers/:id` (`PublicReviewDto`, anonymous), and
 * the rating average/count are cached columns on `provider_profiles` and
 * recomputed by trigger. Adding `GET /api/providers/:id/reviews` would be a
 * second answer to a question the profile already answers.
 *
 * There is deliberately no endpoint that lists "reviews for a provider" here:
 * that would be a way to read a review stream with a different privacy contract
 * from the public profile, and there is no need for it.
 */
export const reviewsRouter = Router();

const customerOnly = [requireAuth, requireRole('CUSTOMER')];

reviewsRouter.post(
  '/',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    const input = parseBody(createReviewSchema, req.body);
    // req.user!.id is the reviewer — always. The body cannot influence it.
    res.status(201).json({ review: await reviewService.createReview(req.user!.id, input) });
  }),
);

reviewsRouter.get(
  '/my',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    res.json({ reviews: await reviewService.listMyReviews(req.user!.id) });
  }),
);
