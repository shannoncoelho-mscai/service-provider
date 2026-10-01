import { Router } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { parseBody } from '../../shared/validate';
import {
  approveSchema,
  providerIdParamSchema,
  rejectSchema,
  suspendSchema,
} from '../providers/providers.schemas';
import * as adminProviderService from './admin.providers.service';

/**
 * Admin provider-review endpoints. Mounted at /api/admin/providers inside
 * adminRouter, which already applies requireAuth + requireRole('ADMIN') —
 * no handler here re-checks roles because the router-level guard is
 * non-bypassable (verified by tests: customer/provider → 403).
 *
 *   GET   /pending                — queue of PENDING profiles
 *   GET   /:id                    — full detail + decision history
 *   PATCH /:id/approve            — → APPROVED   (logs to admin_action_log)
 *   PATCH /:id/reject             — → REJECTED   (reason REQUIRED, logged)
 *   PATCH /:id/suspend            — → SUSPENDED  (optional reason, logged)
 */
export const adminProvidersRouter = Router();

// /pending must be registered before /:id so it is not captured as a UUID param.
adminProvidersRouter.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    res.json({ providers: await adminProviderService.listPending() });
  }),
);

adminProvidersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseBody(providerIdParamSchema, req.params);
    res.json({ provider: await adminProviderService.getDetail(id) });
  }),
);

adminProvidersRouter.patch(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const { id } = parseBody(providerIdParamSchema, req.params);
    const { note } = parseBody(approveSchema, req.body ?? {});
    const provider = await adminProviderService.decide(req.user!.id, id, 'APPROVED', note ?? null);
    res.json({ provider });
  }),
);

adminProvidersRouter.patch(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { id } = parseBody(providerIdParamSchema, req.params);
    const { reason } = parseBody(rejectSchema, req.body ?? {});
    const provider = await adminProviderService.decide(req.user!.id, id, 'REJECTED', reason);
    res.json({ provider });
  }),
);

adminProvidersRouter.patch(
  '/:id/suspend',
  asyncHandler(async (req, res) => {
    const { id } = parseBody(providerIdParamSchema, req.params);
    const { reason } = parseBody(suspendSchema, req.body ?? {});
    const provider = await adminProviderService.decide(req.user!.id, id, 'SUSPENDED', reason ?? null);
    res.json({ provider });
  }),
);
