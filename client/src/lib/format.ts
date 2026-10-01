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
 * Formats a decimal string from the API (e.g. "90.00") as "$90".
 * Returns null when the provider has no price, so callers can show a dash
 * instead of a misleading "$0".
 */
export function formatPrice(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `$${amount.toFixed(0)}`;
}
