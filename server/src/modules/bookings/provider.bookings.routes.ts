import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { asyncHandler } from '../../shared/asyncHandler';
import { HttpError } from '../../shared/httpError';
import { parseBody, parseParams } from '../../shared/validate';
import {
  bookingIdParamSchema,
  bookingListQuerySchema,
  providerStatusSchema,
} from './bookings.schemas';
import * as bookingService from './bookings.service';

/**
 * PROVIDER booking endpoints, mounted at /api/provider.
 *
 *   GET   /api/provider/bookings            — my queue (optional ?status=)
 *   PATCH /api/provider/bookings/:id/status — accept / reject / start / complete
 *
 * The provider id is always `req.user.id` from the verified session. A
 * `providerId` in the body is not read (and the strict schema rejects it), so
 * a provider can only ever reach bookings assigned to them.
 */
export const providerBookingsRouter = Router();

const providerOnly = [requireAuth, requireRole('PROVIDER')];

providerBookingsRouter.get(
  '/bookings',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const query = parseBody(bookingListQuerySchema, req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { bookings, total } = await bookingService.listAssignedBookings(
      req.user!.id,
      query.status,
      page,
      pageSize,
    );
    res.json({ bookings, pagination: { page, pageSize, total } });
  }),
);

providerBookingsRouter.patch(
  '/bookings/:id/status',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(bookingIdParamSchema, req.params);
    const input = parseBody(providerStatusSchema, req.body);
    res.json({
      booking: await bookingService.updateBookingStatusByProvider(req.user!.id, id, input),
    });
  }),
);

providerBookingsRouter.use((_req, _res, next) => {
  next(new HttpError(404, 'Booking endpoint not found'));
});
