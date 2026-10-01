/** Small presentation helpers shared by the home and directory cards. */

/** Two-letter monogram used when a provider has no usable image. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The single price formatter for the whole app.
 *
 * ServiceConnect is built for the Indian market, so every amount renders as
 * Indian Rupees using the `en-IN` locale. That locale does more than swap the
 * symbol — it applies the Indian digit grouping system (lakh/crore), so
 * 123456 renders as `₹1,23,456`, not `₹123,456`. `maximumFractionDigits: 0`
 * rounds to whole rupees, because every seeded and user-entered price is a
 * round figure and showing `.00` on every card is noise.
 *
 * Built once at module scope: constructing an `Intl.NumberFormat` is far more
 * expensive than calling `format`, and these run inside list renders.
 *
 * NOTE: prices are plain NUMERIC in the database. The rupee symbol exists only
 * at this formatting boundary and is never stored, sent to the API, or parsed.
 */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Formats a decimal string from the API (e.g. "9000.00") as "₹9,000".
 *
 * Returns null when the provider has no price, so callers can show a dash
 * instead of a misleading "₹0".
 */
export function formatPrice(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return INR.format(amount);
}
