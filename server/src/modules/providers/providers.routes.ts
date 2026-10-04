import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { asyncHandler } from '../../shared/asyncHandler';
import { HttpError } from '../../shared/httpError';
import { parseBody, parseParams } from '../../shared/validate';
import { updateProviderSchema } from './providers.schemas';
import * as providerService from './providers.service';
import {
  createServiceSchema,
  serviceIdParamSchema,
  serviceImageParamsSchema,
  updateServiceSchema,
  uploadServiceImagesSchema,
} from './services.schemas';
import * as serviceService from './services.service';
import { imageIdParamSchema, uploadImagesSchema } from './images.schemas';
import * as imageService from './images.service';
import * as serviceImageService from './serviceImages.service';
import {
  MAX_IMAGE_FILES,
  providerImageUpload,
  serviceImageUpload,
  uploadedFiles,
} from '../../middleware/upload';
import { providerSearchQuerySchema, toSearchParams } from './search.schemas';
import * as searchService from './search.service';
import * as profileService from './profile.service';

/**
 * Provider self-service (PROVIDER role only):
 *   GET    /api/providers/me — own profile + verification status
 *   PATCH  /api/providers/me — update business fields ONLY (strict schema;
 *                             verification fields are rejected with 400)
 *   GET    /api/providers/me/services — own catalogue
 *   POST   /api/providers/me/services — create a service
 *   PATCH  /api/providers/me/services/:id — edit own service
 *   DELETE /api/providers/me/services/:id — deactivate own service
 *
 * There is deliberately NO /api/providers/:id write route — a provider can
 * only ever touch the row keyed by req.user.id (ADR-018). For services the
 * same rule is enforced *inside* the SQL (`AND provider_id = $n`), so
 * swapping the :id in the URL yields 404, never someone else's data
 * (ADR-020).
 */
export const providersRouter = Router();

const providerOnly = [requireAuth, requireRole('PROVIDER')];

// --- Public directory search ---------------------------------------------
// PUBLIC: no authentication required. A marketplace needs browsable results,
// and everything returned is already restricted to APPROVED providers via
// the public_providers view and the toPublicDto allow-list (ADR-021).
//
// Registered before the 501 catch-all below.

providersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseBody(providerSearchQuerySchema, req.query);
    res.json(await searchService.searchProviders(toSearchParams(query)));
  }),
);

/** Filter options for the UI — public reference data, no PII. */
providersRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await searchService.listCategoryOptions() });
  }),
);

providersRouter.get(
  '/me',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    res.json(await providerService.getMyProfile(req.user!.id));
  }),
);

providersRouter.patch(
  '/me',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const input = parseBody(updateProviderSchema, req.body);
    res.json({ profile: await providerService.updateMyProfile(req.user!.id, input) });
  }),
);

// --- Service management -------------------------------------------------
// Registered before the 501 catch-all below. `providerId` passed to every
// handler is req.user.id (from the verified token) — never a request value.

providersRouter.get(
  '/me/services',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    res.json({ services: await serviceService.listMyServices(req.user!.id) });
  }),
);

providersRouter.post(
  '/me/services',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const input = parseBody(createServiceSchema, req.body);
    const service = await serviceService.createService(req.user!.id, input);
    res.status(201).json({ service });
  }),
);

providersRouter.patch(
  '/me/services/:id',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(serviceIdParamSchema, req.params);
    const input = parseBody(updateServiceSchema, req.body);
    res.json({ service: await serviceService.updateService(req.user!.id, id, input) });
  }),
);

providersRouter.delete(
  '/me/services/:id',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(serviceIdParamSchema, req.params);
    res.json({ service: await serviceService.deactivateService(req.user!.id, id) });
  }),
);

// --- Business images -------------------------------------------------------
// Registered with the other `/me` routes, before the `/:id` catch-all, so
// `/me/images` can never be shadowed by the public profile route.
//
// `providerImageUpload.array('images', MAX_IMAGE_FILES)` runs BEFORE the
// handler, so by the time the handler runs the files are already type-, size-
// and count-validated and written to disk. A field named anything else is
// rejected by Multer (LIMIT_UNEXPECTED_FILE → 400), so `providerId` cannot be
// smuggled through the multipart body.

providersRouter.get(
  '/me/images',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    res.json({ images: await imageService.listMyImages(req.user!.id) });
  }),
);

providersRouter.post(
  '/me/images',
  ...providerOnly,
  providerImageUpload.array('images', MAX_IMAGE_FILES),
  asyncHandler(async (req, res) => {
    const files = uploadedFiles(req.files as Express.Multer.File[] | undefined);
    // Parse the text fields only when at least one file arrived, so an empty
    // request reports "no images" rather than a confusing field error.
    const fields = files.length > 0 ? parseBody(uploadImagesSchema, req.body) : null;

    const images = await imageService.createImages(
      req.user!.id,
      files,
      fields?.altText ?? null,
      fields?.isPrimary ?? false,
    );
    res.status(201).json({ images });
  }),
);

providersRouter.delete(
  '/me/images/:id',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(imageIdParamSchema, req.params);
    await imageService.deleteImage(req.user!.id, id);
    res.status(204).send();
  }),
);

// --- Service images --------------------------------------------------------
// Photos attached to ONE service, as opposed to the business gallery above.
//
// The `:id` in the path is the SERVICE id. It is never trusted on its own: the
// service layer proves it belongs to `req.user.id` before any read or write, so
// provider A pointing the URL at provider B's service id gets the shared 404.
//
// Mounted here, among the other `/me` routes and before the `/:id` catch-all, so
// these paths can never be shadowed by the public profile route.

providersRouter.get(
  '/me/services/:id/images',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(serviceIdParamSchema, req.params);
    res.json({ images: await serviceImageService.listServiceImages(req.user!.id, id) });
  }),
);

providersRouter.post(
  '/me/services/:id/images',
  ...providerOnly,
  serviceImageUpload.array('images', MAX_IMAGE_FILES),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(serviceIdParamSchema, req.params);
    const files = uploadedFiles(req.files as Express.Multer.File[] | undefined);
    // Text fields are parsed only when a file arrived, so an empty request
    // reports "no images uploaded" rather than a confusing field error.
    const fields = files.length > 0 ? parseBody(uploadServiceImagesSchema, req.body) : null;

    const images = await serviceImageService.createServiceImages(
      req.user!.id,
      id,
      files,
      fields?.altText ?? null,
    );
    res.status(201).json({ images });
  }),
);

providersRouter.delete(
  '/me/services/:id/images/:imageId',
  ...providerOnly,
  asyncHandler(async (req, res) => {
    const { id, imageId } = parseParams(serviceImageParamsSchema, req.params);
    await serviceImageService.deleteServiceImage(req.user!.id, id, imageId);
    res.status(204).send();
  }),
);

// --- Public provider profile ----------------------------------------------
// Registered AFTER every /me route so `/me` can never be shadowed by `/:id`.
// PUBLIC: no authentication. Reads through `public_providers`, so only
// APPROVED providers are reachable; anything else is an indistinguishable 404
// (ADR-022).
providersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(serviceIdParamSchema, req.params);
    res.json({ provider: await profileService.getPublicProviderProfile(id) });
  }),
);

// Remaining directory endpoints are not implemented yet.
providersRouter.use((_req, _res, next) => {
  next(new HttpError(501, 'Provider directory endpoints are not implemented yet'));
});
