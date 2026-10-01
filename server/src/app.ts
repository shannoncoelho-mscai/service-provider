import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { providerBookingsRouter } from './modules/bookings/provider.bookings.routes';
import { healthRouter } from './modules/health/health.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { providersRouter } from './modules/providers/providers.routes';
import { reviewsRouter } from './modules/reviews/reviews.routes';

/**
 * App assembly only — no business logic here.
 * Feature code lives in src/modules/<feature>/; each module owns its routes.
 */
export const app = express();

// Security headers
app.use(helmet());

// CORS: locked to the configured frontend origin (never "*")
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: '100kb' }));

// ---- Route modules -------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({ service: 'serviceconnect-api', docs: 'see README.md' });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/providers', providersRouter);
app.use('/api/bookings', bookingsRouter);          // CUSTOMER (enforced in the module)
app.use('/api/provider', providerBookingsRouter);   // PROVIDER (enforced in the module)
app.use('/api/admin', adminRouter); // ADMIN-only (enforced inside the module)
app.use('/api/reviews', reviewsRouter); // CUSTOMER (enforced in the module)
app.use('/api/notifications', notificationsRouter); // any role, always own rows

// ---- Error handling (must be last) ---------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);
