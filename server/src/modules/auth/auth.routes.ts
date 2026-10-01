import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { asyncHandler } from '../../shared/asyncHandler';
import { parseBody } from '../../shared/validate';
import { loginSchema, registerSchema } from './auth.schemas';
import * as authService from './auth.service';

/**
 * /api/auth endpoints (Step 004):
 *   POST /register  — CUSTOMER or PROVIDER only (ADMIN impossible — ADR-016)
 *   POST /login     — uniform 401 for unknown email OR wrong password
 *   POST /logout    — revokes the server-side session (requires auth)
 *   GET  /me        — current user from the DB (requires auth)
 *
 * Validation is zod (parseBody → 400 with field messages only);
 * error bodies never contain stack traces or credential details.
 */
export const authRouter = Router();

const authResponse = (result: authService.AuthResult) => ({
  user: result.user, // PublicUser — no password_hash, ever
  token: result.token,
  tokenType: 'Bearer',
  expiresIn: result.expiresInSeconds,
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    const result = await authService.register(input, req.get('user-agent') ?? null);
    res.status(201).json(authResponse(result));
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const result = await authService.login(input, req.get('user-agent') ?? null);
    res.status(200).json(authResponse(result));
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.logout(req.user!.sessionId);
    res.status(200).json({ message: 'Logged out successfully' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await authService.getMe(req.user!.id);
    res.status(200).json({ user });
  }),
);
