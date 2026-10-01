import { Router } from 'express';

export const healthRouter = Router();

/**
 * GET /api/health — liveness probe. Public (no auth) and intentionally
 * constant: the exact contract is { status: "ok", service: "ServiceConnect API" }.
 */
healthRouter.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ServiceConnect API',
  });
});
