import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import {
  PROVIDER_UPLOADS_DIR,
  PROVIDER_UPLOADS_URL_PREFIX,
  ensureUploadDirs,
} from './config/uploads';
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

// ---- Uploaded media ------------------------------------------------------
// Serve ONLY the provider uploads directory, never the server root or the
// process working directory. `express.static` is mounted at the same prefix the
// URLs were written with (`/uploads/providers`), so a row's `url` resolves
// straight to its file. Created at boot so the very first upload cannot fail
// with ENOENT (Phase 20).
ensureUploadDirs();
app.use(
  PROVIDER_UPLOADS_URL_PREFIX,
  express.static(PROVIDER_UPLOADS_DIR, {
    // Images are immutable once written (the filename contains a UUID), so
    // caching them is safe and saves a round trip on the public gallery.
    maxAge: '1d',
    // Never let a crafted path escape: only resolve inside the mount root.
    dotfiles: 'deny',
    index: false,
    // WHY THIS OVERRIDE (the reason customers could not see uploaded images):
    // helmet sets `Cross-Origin-Resource-Policy: same-origin` globally. The SPA
    // is served from :5173 and these files from :4000, which is a DIFFERENT
    // origin, so the browser silently refused to paint every <img> on the
    // public profile. Relaxing it to `cross-origin` is scoped to this one static
    // mount — no API route, page or script is affected, and the images being
    // opened up are already public gallery content.
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

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
