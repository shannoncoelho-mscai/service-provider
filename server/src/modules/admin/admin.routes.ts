import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { adminProvidersRouter } from './admin.providers.routes';

/**
 * ADMIN MODULE — scaffolding only (provider verification arrives in Step 6).
 * Every route below is ADMIN-only via middleware; new admin endpoints must be
 * registered under the same guards. Unauthorized callers get 401/403 from the
 * server regardless of what the frontend does.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('ADMIN'));

adminRouter.get('/ping', (_req, res) => {
  res.json({
    message: 'Admin area reachable — feature endpoints arrive in Step 6',
    role: 'ADMIN',
  });
});

// Provider verification workflow (pending list, detail, approve/reject/suspend)
adminRouter.use('/providers', adminProvidersRouter);
