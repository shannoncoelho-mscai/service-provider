/** Mirrors server/src/shared/types.ts — keep in sync (see ADR-002). */
export const ROLES = ['CUSTOMER', 'PROVIDER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Exact shape returned by GET /api/health. */
export interface HealthStatus {
  status: string;
  service: string;
}

/**
 * Public provider DTO — mirrors `PublicProviderDto` in
 * server/src/modules/providers/search.service.ts. It is an ALLOW-LIST: if a
 * field is not here, the API does not return it (ADR-021). Keep in sync.
 */
export interface PublicProvider {
  id: string;
  businessName: string;
  description: string | null;
  city: string;
  serviceAreas: string[];
  yearsExperience: number;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  verifiedAt: string | null;
  /** Mean review rating, or null when the provider has no reviews yet. */
  rating: number | null;
  reviewCount: number;
  /** Lowest price across active services, as a decimal string. */
  priceFrom: string | null;
  activeServiceCount: number;
  isAvailable: boolean;
  categories: Array<{ slug: string; name: string }>;
}

/** Envelope returned by GET /api/providers. */
export interface ProviderSearchResponse {
  providers: PublicProvider[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/** One entry from GET /api/providers/categories. */
export interface CategoryOption {
  slug: string;
  name: string;
  providerCount: number;
}

/** A service on a public profile. Mirrors `PublicServiceDto` (ADR-022). */
export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  priceFrom: string;
  priceTo: string | null;
  durationMinutes: number | null;
  category: { slug: string; name: string };
}

/** A gallery image. */
export interface PublicImage {
  url: string;
  altText: string | null;
}

/** A review. Deliberately anonymous — the API never returns a reviewer id. */
export interface PublicReview {
  rating: number;
  comment: string | null;
  createdAt: string;
}

/**
 * A review belonging to the authenticated customer (ADR-028).
 *
 * More detail than `PublicReview` because the customer is looking at their OWN
 * review: it names the booking, provider and service, and carries the booking's
 * status. It still contains no customer identity — the customer already knows
 * who they are, and nothing identifying about anyone else is included.
 */
export interface MyReview {
  id: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  providerName: string | null;
  serviceName: string | null;
  bookingStatus: string | null;
}

/** Envelope returned by GET /api/reviews/my. */
export interface MyReviewsResponse {
  reviews: MyReview[];
}

/**
 * Request body for POST /api/reviews.
 *
 * There is intentionally NO `customerId`, `userId`, `reviewerId` or
 * `providerId` field: the reviewer is the session user and the reviewed provider
 * is derived from the booking, both server-side. The `.strict()` schema rejects
 * any of those if a caller sends them, and the type makes it impossible to
 * include them by accident.
 */
export interface CreateReviewRequest {
  bookingId: string;
  rating: number;
  comment?: string;
}

/* ==========================================================================
   In-app notifications (ADR-029)
   Mirrors the `notification_type` enum from migration 011 and the server's
   NOTIFICATION_TYPES. Kept in sync deliberately (ADR-002).
   ========================================================================== */

export const NOTIFICATION_TYPES = [
  'BOOKING_CREATED',
  'BOOKING_ACCEPTED',
  'BOOKING_REJECTED',
  'BOOKING_CANCELLED',
  'BOOKING_IN_PROGRESS',
  'BOOKING_COMPLETED',
  'REVIEW_SUBMITTED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** The booking this is about. Null for a non-booking notification. */
  relatedBookingId: string | null;
  /** Null means unread. */
  readAt: string | null;
  createdAt: string;
}

/** Envelope returned by GET /api/notifications. */
export interface NotificationListResponse {
  notifications: Notification[];
  pagination: { page: number; pageSize: number; total: number };
}

/**
 * Public provider profile — the search DTO plus three collections.
 * Mirrors `PublicProviderProfileDto`. It is an ALLOW-LIST: the API sends no
 * contact details, owner identity or admin data here.
 */
export interface PublicProviderProfile extends PublicProvider {
  services: PublicService[];
  images: PublicImage[];
  reviews: PublicReview[];
}

/* ==========================================================================
   Auth
   ========================================================================== */

/** The authenticated user as returned by /api/auth/*. Never has a hash. */
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  createdAt: string;
}

/** Envelope returned by /api/auth/login and /api/auth/register. */
export interface AuthResponse {
  user: CurrentUser;
  token: string;
  tokenType: 'Bearer';
  /** Seconds until the token/session expires. */
  expiresIn: number;
}

/* ==========================================================================
   Bookings (ADR-024)
   Mirrors `BookingDto` in server/src/modules/bookings/bookings.service.ts.
   ========================================================================== */

export const BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * A booking as returned to one of its two parties.
 *
 * NOTE: there is deliberately no `customerId` and no provider email/phone. The
 * backend is the allow-list; this type simply mirrors it.
 */
export interface Booking {
  id: string;
  status: BookingStatus;
  scheduledAt: string;
  durationMinutes: number | null;
  address: string | null;
  notes: string | null;
  problemDescription: string | null;
  /** Price snapshotted by the server at creation. Informational only. */
  priceQuote: string | null;
  cancellationReason: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  service: { id: string; name: string } | null;
  provider: { id: string; businessName: string } | null;
  customerName: string | null;
}

/** Envelope returned by GET /api/bookings/my. */
export interface MyBookingsResponse {
  bookings: Booking[];
  pagination: { page: number; pageSize: number; total: number };
}

/**
 * Request body for POST /api/bookings.
 *
 * There is intentionally NO `customerId` field: the customer is taken from the
 * authenticated session by the server. Adding one here would let a caller
 * believe they can book as somebody else (the server would ignore it, but the
 * type should not suggest it is supported). `priceQuote` and
 * `durationMinutes` are likewise absent — the server snapshots them from the
 * service, and the client must not send an authoritative price.
 */
export interface CreateBookingRequest {
  providerId: string;
  serviceId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  time: string;
  problemDescription: string;
  address: string;
  notes?: string;
}

/* ==========================================================================
   Provider side (ADR-026)
   ========================================================================== */

/** The four statuses a PROVIDER may set. CANCELLED is absent by design. */
export const PROVIDER_SETTABLE_STATUSES = [
  'ACCEPTED',
  'REJECTED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type ProviderSettableStatus = (typeof PROVIDER_SETTABLE_STATUSES)[number];

/** Request body for PATCH /api/provider/bookings/:id/status. */
export interface ProviderStatusUpdate {
  status: ProviderSettableStatus;
  /** REQUIRED by the server when status is REJECTED; optional otherwise. */
  reason?: string;
}

/** Envelope returned by GET /api/provider/bookings. */
export interface ProviderBookingsResponse {
  bookings: Booking[];
  pagination: { page: number; pageSize: number; total: number };
}

/** Verification states, mirroring the `verification_status` DB enum. */
export const VERIFICATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The signed-in provider's own profile — mirrors `ProviderProfileDto` in
 * server/src/modules/providers/providers.service.ts.
 *
 * Used ONLY for the signed-in provider (GET /api/providers/me), so `phone` here
 * is the provider's own number. Note what is NOT here: there is no rejection
 * reason and no suspension reason. The API deliberately does not expose those to
 * the provider, so the UI must never invent one.
 */
export interface ProviderProfile {
  userId: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  city: string;
  address: string | null;
  serviceAreas: string[];
  yearsExperience: number;
  hourlyRate: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  verificationStatus: VerificationStatus;
  isPublic: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ==========================================================================
   Admin provider verification (ADR-027)
   ========================================================================== */

/** The owner block the ADMIN endpoints add on top of the provider profile. */
export interface AdminProviderOwner {
  fullName: string;
  email: string;
  isActive: boolean;
}

/**
 * A provider as returned by the ADMIN endpoints.
 *
 * IMPORTANT — this is deliberately NOT the public provider DTO. The admin
 * endpoint returns the full profile plus the owner's contact details, because
 * verifying a business legitimately requires them.
 *
 * `verifiedBy` is present in the payload but is an ADMIN's user id. It is part
 * of the type (so the response parses) and is never rendered: see
 * `adminProviderView` in lib/admin-utils.ts, which is the only thing the UI is
 * allowed to read.
 */
export interface AdminProviderDetail extends ProviderProfile {
  owner: AdminProviderOwner;
}

/** One row of the verification audit trail. */
export interface AdminProviderAction {
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** `GET /api/admin/providers/:id` adds the decision history. */
export interface AdminProviderReview extends AdminProviderDetail {
  actions: AdminProviderAction[];
}

/** The three decisions the backend exposes as explicit endpoints. */
export const ADMIN_DECISIONS = ['APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type AdminDecision = (typeof ADMIN_DECISIONS)[number];





