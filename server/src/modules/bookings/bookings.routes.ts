import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { asyncHandler } from '../../shared/asyncHandler';
import { HttpError } from '../../shared/httpError';
import { parseBody, parseParams } from '../../shared/validate';
import {
  bookingIdParamSchema,
  bookingListQuerySchema,
  cancelBookingSchema,
  createBookingSchema,
} from './bookings.schemas';
import * as bookingService from './bookings.service';

/**
 * CUSTOMER booking endpoints.
 *
 *   POST  /api/bookings            — create a request (CUSTOMER only)
 *   GET   /api/bookings/my         — my bookings
 *   GET   /api/bookings/:id        — one of my bookings
 *   PATCH /api/bookings/:id/cancel — cancel my booking
 *
 * Every route requires a session. The customer id is `req.user.id` from the
 * verified token in all cases — a `customerId` in a body or query is never
 * read, and the strict schemas would reject one anyway.
 */
export const bookingsRouter = Router();

const customerOnly = [requireAuth, requireRole('CUSTOMER')];

bookingsRouter.post(
  '/',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    const input = parseBody(createBookingSchema, req.body);
    res.status(201).json({
      booking: await bookingService.createBooking(req.user!.id, input),
    });
  }),
);

bookingsRouter.get(
  '/my',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    const query = parseBody(bookingListQuerySchema, req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { bookings, total } = await bookingService.listMyBookings(
      req.user!.id,
      page,
      pageSize,
    );
    res.json({ bookings, pagination: { page, pageSize, total } });
  }),
);

// Registered AFTER `/my` so the literal path can never be read as an id.
bookingsRouter.get(
  '/:id',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(bookingIdParamSchema, req.params);
    res.json({ booking: await bookingService.getBookingForParty('CUSTOMER', req.user!.id, id) });
  }),
);

bookingsRouter.patch(
  '/:id/cancel',
  ...customerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(bookingIdParamSchema, req.params);
    const input = parseBody(cancelBookingSchema, req.body);
    res.json({
      booking: await bookingService.cancelBooking(req.user!.id, id, input),
    });
  }),
);

bookingsRouter.use((_req, _res, next) => {
  next(new HttpError(404, 'Booking endpoint not found'));
});

