import { pool } from '../../config/database';
import { HttpError } from '../../shared/httpError';
import {
  PUBLIC_COLUMNS,
  toPublicDto,
  type ProviderRow,
  type PublicProviderDto,
} from './search.service';

/**
 * Public provider profile (ADR-022).
 *
 * APPROVED-ONLY
 *   The base row is read from `public_providers`, the same view that gates
 *   search. A PENDING / REJECTED / SUSPENDED provider (or a deactivated user)
 *   therefore has NO row, and the endpoint returns the same 404 as an id that
 *   does not exist. Returning 403 instead would confirm the id exists and hand
 *   out a free enumeration oracle for unverified providers — exactly the
 *   reasoning used for cross-provider service access in ADR-020.
 *
 * PUBLIC EXPOSURE
 *   The base row goes through `toPublicDto`, the identical allow-list used by
 *   search results, so no field can be public in one response and private in
 *   the other. Nested collections are each built by their own allow-list:
 *     - services: id, name, description, price range, duration, category.
 *       Inactive services are excluded — a deactivated service is not
 *       bookable and should not be advertised.
 *     - images: url + alt text only. No ids, timestamps or ordering columns.
 *     - reviews: rating, comment, created_at ONLY. The reviewer's identity is
 *       deliberately withheld: no customer_id, no booking_id, no name or
 *       email. Reviews are already anonymous everywhere in the app.
 *   password hashes, email, phone, owner name, verified_by, hourly_rate,
 *   street address and every admin_action_log field are never selected.
 *
 * SQL INJECTION
 *   The only user input is the id, which is validated as a UUID by the route
 *   and bound as $1 here.
 */

/** A service as shown on a public profile. */
export interface PublicServiceDto {
  id: string;
  name: string;
  description: string | null;
  priceFrom: string;
  priceTo: string | null;
  durationMinutes: number | null;
  category: { slug: string; name: string };
  /**
   * Photos of THIS service. Always present (never undefined) so the client does
   * not need `?.` or a null check, and empty for the common case of a service
   * with no photos — the customer UI then renders exactly the layout it did
   * before this field existed. Images are optional in the data model by design;
   * they are never required to publish a service.
   */
  images: PublicImageDto[];
}

/** A gallery image. */
export interface PublicImageDto {
  url: string;
  altText: string | null;
}

/** A review. Deliberately anonymous. */
export interface PublicReviewDto {
  rating: number;
  comment: string | null;
  createdAt: Date;
}

export interface PublicProviderProfileDto extends PublicProviderDto {
  services: PublicServiceDto[];
  images: PublicImageDto[];
  reviews: PublicReviewDto[];
}

/** Reviews shown on the profile; `reviewCount` remains the true total. */
const REVIEW_LIMIT = 20;

export async function getPublicProviderProfile(
  providerId: string,
): Promise<PublicProviderProfileDto> {
  const base = await pool.query<ProviderRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM public_providers v WHERE v.id = $1`,
    [providerId],
  );
  const row = base.rows[0];

  // Identical response for "not approved" and "does not exist".
  if (!row) throw new HttpError(404, 'Provider not found');

  const provider = toPublicDto(row);

  // Four small reads, issued together.
  const [services, images, reviews, serviceImages] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      description: string | null;
      price_from: string;
      price_to: string | null;
      duration_minutes: number | null;
      category_slug: string;
      category_name: string;
    }>(
      `SELECT s.id, s.name, s.description, s.price_from, s.price_to,
              s.duration_minutes, c.slug AS category_slug, c.name AS category_name
         FROM services s
         JOIN service_categories c ON c.id = s.category_id
        WHERE s.provider_id = $1
          AND s.is_active
          AND c.is_active
        ORDER BY s.price_from ASC, s.name ASC`,
      [providerId],
    ),
    pool.query<{ url: string; alt_text: string | null }>(
      `SELECT url, alt_text
         FROM provider_images
        WHERE provider_id = $1
        ORDER BY sort_order ASC, created_at ASC`,
      [providerId],
    ),
    pool.query<{ rating: number; comment: string | null; created_at: Date }>(
      // No customer identity, no booking id: reviews are public but anonymous.
      `SELECT rating, comment, created_at
         FROM reviews
        WHERE provider_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [providerId, REVIEW_LIMIT],
    ),
    // Per-service photos, keyed by service id, for ONE round trip.
    //
    // Scoped to the SAME rows the service query above can return (active
    // service + active category), so visibility cannot leak through an image: an
    // image belonging to a deactivated service is not published even if its row
    // still exists. And because this whole function is only reached through the
    // `public_providers` read above, an unapproved provider returns 404 before
    // any of these queries run (ADR-022).
    pool.query<{ service_id: string; url: string; alt_text: string | null }>(
      `SELECT si.service_id, si.url, si.alt_text
         FROM service_images si
         JOIN services s ON s.id = si.service_id
         JOIN service_categories c ON c.id = s.category_id
        WHERE s.provider_id = $1
          AND s.is_active
          AND c.is_active
        ORDER BY si.sort_order ASC, si.created_at ASC`,
      [providerId],
    ),
  ]);

  // Bucket the flat image rows by service id so the service mapper below can do
  // a single lookup instead of re-querying per service (N+1).
  const imagesByService = new Map<string, PublicImageDto[]>();
  for (const row of serviceImages.rows) {
    const list = imagesByService.get(row.service_id);
    if (list) list.push({ url: row.url, altText: row.alt_text });
    else imagesByService.set(row.service_id, [{ url: row.url, altText: row.alt_text }]);
  }

  return {
    ...provider,
    services: services.rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceFrom: s.price_from,
      priceTo: s.price_to,
      durationMinutes: s.duration_minutes,
      category: { slug: s.category_slug, name: s.category_name },
      // Always an array, possibly empty — the UI omits the section when it is,
      // so services without photos keep the exact layout they had before.
      images: imagesByService.get(s.id) ?? [],
    })),
    images: images.rows.map((i) => ({ url: i.url, altText: i.alt_text })),
    reviews: reviews.rows.map((r) => ({
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
    })),
  };
}
