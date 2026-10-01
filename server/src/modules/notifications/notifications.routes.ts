import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { asyncHandler } from '../../shared/asyncHandler';
import { parseBody, parseParams } from '../../shared/validate';
import {
  notificationIdParamSchema,
  notificationListQuerySchema,
} from './notifications.schemas';
import * as notificationService from './notifications.service';

/**
 * /api/notifications — the signed-in user's own notifications (ADR-029).
 *
 *   GET   /api/notifications              — list, optional ?unreadOnly
 *   GET   /api/notifications/unread-count — { count }
 *   PATCH /api/notifications/:id/read     — mark one read
 *   PATCH /api/notifications/read-all    — mark all of the caller's read
 *
 * `requireAuth` only — NOT `requireRole`. Notifications are for every role: a
 * customer, a provider and an admin all receive them, and which of those a
 * given user is has no bearing on whether they may read their OWN. The scoping
 * that matters is `req.user.id` on every query below.
 *
 * There is no endpoint that CREATES a notification. Recipients, types, titles
 * and messages are produced by booking business logic inside its own
 * transaction, so there is no body in which a client could name a recipient or
 * invent a message.
 *
 * `/read-all` is registered before `/:id/read` so it is never captured as an id.
 */
export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ count: await notificationService.unreadCount(req.user!.id) });
  }),
);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseBody(notificationListQuerySchema, req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { notifications, total } = await notificationService.listNotifications(req.user!.id, {
      page,
      pageSize,
      unreadOnly: query.unreadOnly ?? false,
    });
    res.json({ notifications, pagination: { page, pageSize, total } });
  }),
);

notificationsRouter.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const updated = await notificationService.markAllRead(req.user!.id);
    res.json({ updated });
  }),
);

notificationsRouter.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(notificationIdParamSchema, req.params);
    res.json({ notification: await notificationService.markRead(req.user!.id, id) });
  }),
);
