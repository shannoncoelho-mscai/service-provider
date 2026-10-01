import { getAccessToken } from './auth';
import type {
  AdminProviderDetail,
  AdminProviderReview,
  Booking,
  CategoryOption,
  CreateBookingRequest,
  CreateReviewRequest,
  CreateServiceInput,
  MyBookingsResponse,
  MyReview,
  MyReviewsResponse,
  Notification,
  NotificationListResponse,
  ProviderBookingsResponse,
  ProviderProfile,
  ProviderSearchResponse,
  ProviderSettableStatus,
  PublicProviderProfile,
  PublicService,
  UpdateMyProviderInput,
} from '../types';

/**
 * Typed API client. The ONLY place that knows the API base URL.
 *
 * The base URL is injected by Vite at build time. Outside a Vite build (the
 * `tsx --test` suite) `import.meta.env` does not exist, so the access is
 * optional-chained and the default is used. Without this the module would throw
 * on import and no API test could run.
 */
const API_BASE = import.meta.env?.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Read the token per request, never captured in a closure, so signing in or
  // out takes effect immediately without a reload.
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // The server's message is already safe (no SQL, no stack). Fall back to a
    // status-specific line rather than ever surfacing a raw error.
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      defaultMessageFor(response.status);
    throw new ApiError(response.status, message);
  }

  return body as T;
}

/** Never shows a raw error; used only when the server sends no message. */
function defaultMessageFor(status: number): string {
  switch (status) {
    case 400:
      return 'Some of the details provided are not valid.';
    case 401:
      return 'Please sign in to continue.';
    case 403:
      return 'You do not have permission to do that.';
    case 404:
      return 'That could not be found.';
    case 409:
      return 'That time slot is no longer available.';
    default:
      return 'Something went wrong on our side. Please try again.';
  }
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, data: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'DELETE' }),
};

/**
 * Builds a query string from defined values only, so an empty search field is
 * omitted rather than sent as `?keyword=`. Values are URL-encoded here; the
 * server still validates every parameter (ADR-021).
 */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Public, unauthenticated directory search (GET /api/providers). */
export function searchProviders(
  params: {
    keyword?: string;
    category?: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
    rating?: number;
    availability?: boolean;
    sort?: 'rating' | 'price' | 'newest';
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ProviderSearchResponse> {
  return api.get<ProviderSearchResponse>(`/providers${buildQuery(params)}`);
}

/** Filter options for the UI (GET /api/providers/categories). */
export async function listCategories(): Promise<CategoryOption[]> {
  const data = await api.get<{ categories: CategoryOption[] }>('/providers/categories');
  return data.categories;
}


/* ==========================================================================
   Bookings (ADR-024)
   Thin wrappers over the existing endpoints. No booking logic lives here and
   there is no mock/fallback data — if the API fails, the caller sees the error.
   ========================================================================== */

/**
 * POST /api/bookings
 *
 * Sends ONLY the fields in the server contract. `customerId` is never included
 * (the server derives it from the session) and neither is `priceQuote` or
 * `durationMinutes` (the server snapshots both from the service).
 */
export async function createBooking(input: CreateBookingRequest): Promise<Booking> {
  const data = await api.post<{ booking: Booking }>('/bookings', {
    providerId: input.providerId,
    serviceId: input.serviceId,
    date: input.date,
    time: input.time,
    problemDescription: input.problemDescription,
    address: input.address,
    // Omit rather than send an empty string for an optional field.
    ...(input.notes && input.notes.trim() ? { notes: input.notes.trim() } : {}),
  });
  return data.booking;
}

/**
 * GET /api/bookings/my — the backend filters to the session user.
 *
 * Returns the raw bookings AND the server's `pagination.total`. The total
 * matters on the dashboard (ADR-025): the endpoint caps a page at 50, so the
 * array length alone would under-report the lifetime count for a busy customer.
 */
export async function listMyBookingsPage(): Promise<MyBookingsResponse> {
  return api.get<MyBookingsResponse>('/bookings/my?pageSize=50');
}

/** Convenience wrapper for callers that only need the array. */
export async function listMyBookings(): Promise<Booking[]> {
  const data = await listMyBookingsPage();
  return data.bookings;
}

/** GET /api/bookings/:id — 404 for a booking that is not the caller's. */
export async function getBooking(id: string): Promise<Booking> {
  const data = await api.get<{ booking: Booking }>(`/bookings/${id}`);
  return data.booking;
}

/**
 * PATCH /api/bookings/:id/cancel
 *
 * Sends ONLY `reason`. There is deliberately no `status` parameter: the
 * endpoint only cancels, and the server refuses any other target status
 * (ADR-023).
 */
export async function cancelBooking(id: string, reason: string): Promise<Booking> {
  const data = await api.patch<{ booking: Booking }>(`/bookings/${id}/cancel`, { reason });
  return data.booking;
}

/**
 * Public provider profile (GET /api/providers/:id).
 *
 * The endpoint is public and APPROVED-only: a pending, rejected, suspended or
 * deleted provider returns the same 404 as an unknown id, so this cannot be
 * used to discover unverified providers. A 404 therefore means "no public
 * profile" and is surfaced as a friendly not-found state.
 */
export async function getProviderProfile(id: string): Promise<PublicProviderProfile> {
  const data = await api.get<{ provider: PublicProviderProfile }>(`/providers/${id}`);
  return data.provider;
}

/* ==========================================================================
   Provider dashboard (ADR-026)
   Both endpoints are PROVIDER-only and the provider id is ALWAYS the session
   user on the server. Nothing here sends a providerId — there is no such field.
   ========================================================================== */

/**
 * GET /api/provider/bookings — the provider's own queue.
 *
 * The whole queue is fetched ONCE (max page size 50) and every filter, count
 * and sort on the dashboard is applied to that single response. The optional
 * `?status=` filter exists on the server but is deliberately NOT used: refetching
 * per tab would mean one request per filter click for data already in hand.
 */
export async function listProviderBookings(): Promise<ProviderBookingsResponse> {
  return api.get<ProviderBookingsResponse>('/provider/bookings?pageSize=50');
}

/**
 * PATCH /api/provider/bookings/:id/status
 *
 * Sends ONLY `{ status }`, plus `{ reason }` when there is one. There is no
 * `providerId` and no `bookingId` in the body — the id is a path segment and the
 * provider comes from the session, so a provider can only ever act on their own
 * queue.
 *
 * `reason` is required by the server when rejecting (3–500 chars) and optional
 * otherwise. `canProviderAct` decides which of the two applies.
 */
export async function updateProviderBookingStatus(
  id: string,
  status: ProviderSettableStatus,
  reason?: string,
): Promise<Booking> {
  const trimmed = reason?.trim();
  const data = await api.patch<{ booking: Booking }>(`/provider/bookings/${id}/status`, {
    status,
    ...(trimmed ? { reason: trimmed } : {}),
  });
  return data.booking;
}

/** GET /api/providers/me — the signed-in provider's own profile. */
export async function getMyProviderProfile(): Promise<ProviderProfile> {
  const data = await api.get<{ provider: ProviderProfile }>('/providers/me');
  return data.provider;
}

/** GET /api/providers/me/services — the provider's own service list. */
  export async function listMyProviderServices(): Promise<PublicService[]> {
    const data = await api.get<{ services: PublicService[] }>('/providers/me/services');
    return data.services;
  }

  /**
   * PATCH /api/providers/me — update the signed-in provider's own business
   * profile. The server scopes the UPDATE to `user_id = <session>`, so a
   * userId sent here would simply be ignored; it is not part of the input type
   * at all, and `verificationStatus` is deliberately absent because the schema
   * is `.strict()` and only an ADMIN may change it.
   */
  export async function updateMyProviderProfile(
    input: UpdateMyProviderInput,
  ): Promise<ProviderProfile> {
    const data = await api.patch<{ profile: ProviderProfile }>('/providers/me', input);
    return data.profile;
  }

  /** POST /api/providers/me/services — add a service to the provider's catalogue. */
  export async function createMyProviderService(input: CreateServiceInput): Promise<PublicService> {
    const data = await api.post<{ service: PublicService }>('/providers/me/services', input);
    return data.service;
  }

  /** PATCH /api/providers/me/services/:id — rename, reprice or re-describe. */
  export async function updateMyProviderService(
    id: string,
    input: Partial<CreateServiceInput>,
  ): Promise<PublicService> {
    const data = await api.patch<{ service: PublicService }>(
      `/providers/me/services/${id}`,
      input,
    );
    return data.service;
  }

  /**
   * DELETE /api/providers/me/services/:id — deactivates the service.
   *
   * It is a soft delete (`is_active = false`), which is why historical bookings
   * keep resolving their service name. The server scopes the UPDATE to the
   * session's own provider id, so another provider's service id is a 404.
   */
  export async function deleteMyProviderService(id: string): Promise<PublicService> {
    const data = await api.delete<{ service: PublicService }>(
      `/providers/me/services/${id}`,
    );
    return data.service;
  }

/* ==========================================================================
   Reviews (ADR-028)
   ========================================================================== */

/**
 * POST /api/reviews — review a COMPLETED booking.
 *
 * Sends ONLY `{ bookingId, rating }` plus a `comment` when there is one. The
 * reviewer is the session user and the reviewed provider is derived from the
 * booking, so neither `customerId` nor `providerId` is sent — and the server's
 * strict schema would reject them anyway.
 *
 * A whitespace-only comment is omitted rather than sent as `''`, so the server
 * stores NULL and does not keep pointless blank text.
 */
export async function createReview(input: CreateReviewRequest): Promise<MyReview> {
  const trimmed = input.comment?.trim();
  const data = await api.post<{ review: MyReview }>('/reviews', {
    bookingId: input.bookingId,
    rating: input.rating,
    ...(trimmed ? { comment: trimmed } : {}),
  });
  return data.review;
}

/** GET /api/reviews/my — the authenticated customer's own reviews. */
export async function listMyReviews(): Promise<MyReview[]> {
  const data = await api.get<MyReviewsResponse>('/reviews/my');
  return data.reviews;
}

/* ==========================================================================
   In-app notifications (ADR-029)
   Every endpoint is scoped server-side to the session user, so there is no
   userId parameter anywhere below — and none is sent.
   ========================================================================== */

/** GET /api/notifications — the caller's own notifications, newest first. */
export async function listNotifications(options?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  params.set('page', String(options?.page ?? 1));
  params.set('pageSize', String(options?.pageSize ?? 20));
  if (options?.unreadOnly) params.set('unreadOnly', 'true');
  const data = await api.get<NotificationListResponse>(`/notifications?${params.toString()}`);
  return data;
}

/** GET /api/notifications/unread-count. */
export async function getUnreadCount(): Promise<number> {
  const data = await api.get<{ count: number }>('/notifications/unread-count');
  return data.count;
}

/**
 * PATCH /api/notifications/:id/read
 *
 * The id is a lookup identifier only: the server scopes the UPDATE to
 * `id = $1 AND user_id = <session>`, so another user's id is a 404. Nothing
 * about the notification's contents is sent.
 */
export async function markNotificationRead(id: string): Promise<Notification> {
  const data = await api.patch<{ notification: Notification }>(`/notifications/${id}/read`, {});
  return data.notification;
}

/** PATCH /api/notifications/read-all — scoped to the caller server-side. */
export async function markAllNotificationsRead(): Promise<number> {
  const data = await api.patch<{ updated: number }>('/notifications/read-all', {});
  return data.updated;
}

/* ==========================================================================
   Admin provider verification (ADR-027)
   All four endpoints are guarded server-side by requireAuth + requireRole('ADMIN')
   on the admin router. Nothing here ever sends an admin id: the server takes the
   acting admin from the session, so there is no field for one.
   ========================================================================== */

/**
 * GET /api/admin/providers/pending — the verification queue.
 *
 * The backend exposes NO list endpoint for approved/rejected/suspended
 * providers, so the dashboard deliberately does not pretend one exists. Only the
 * pending queue and individual provider detail are reachable.
 */
export async function listPendingProviders(): Promise<AdminProviderDetail[]> {
  const data = await api.get<{ providers: AdminProviderDetail[] }>('/admin/providers/pending');
  return data.providers;
}

/** GET /api/admin/providers/:id — full detail plus the decision history. */
export async function getAdminProvider(id: string): Promise<AdminProviderReview> {
  const data = await api.get<{ provider: AdminProviderReview }>(`/admin/providers/${id}`);
  return data.provider;
}

/**
 * PATCH /api/admin/providers/:id/approve — optional `note` (2–500 chars).
 *
 * Sends `{}` when there is no note, because the schema is `.strict()` and the
 * note is genuinely optional. The note is an audit annotation; it is never
 * invented by the client.
 */
export async function approveProvider(id: string, note?: string): Promise<ProviderProfile> {
  const trimmed = note?.trim();
  const data = await api.patch<{ provider: ProviderProfile }>(
    `/admin/providers/${id}/approve`,
    trimmed ? { note: trimmed } : {},
  );
  return data.provider;
}

/**
 * PATCH /api/admin/providers/:id/reject — `reason` REQUIRED, 5–500 chars.
 *
 * Note the minimum is 5 here, not the 3 used by the booking rejection schema —
 * the two endpoints are validated by different schemas and both were read
 * directly rather than assumed.
 */
export async function rejectProvider(id: string, reason: string): Promise<ProviderProfile> {
  const data = await api.patch<{ provider: ProviderProfile }>(
    `/admin/providers/${id}/reject`,
    { reason: reason.trim() },
  );
  return data.provider;
}

/** PATCH /api/admin/providers/:id/suspend — `reason` OPTIONAL (5–500 chars). */
export async function suspendProvider(
  id: string,
  reason?: string,
): Promise<ProviderProfile> {
  const trimmed = reason?.trim();
  const data = await api.patch<{ provider: ProviderProfile }>(
    `/admin/providers/${id}/suspend`,
    trimmed ? { reason: trimmed } : {},
  );
  return data.provider;
}




