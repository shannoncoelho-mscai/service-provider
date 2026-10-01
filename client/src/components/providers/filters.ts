/**
 * Directory filter model.
 *
 * The URL is the single source of truth: every filter is serialised into the
 * query string, so results are shareable, bookmarkable and survive a refresh or
 * the back button. This module owns the mapping in both directions so the page
 * and the filter panel can never disagree about what a filter means.
 *
 * Only non-default values are written, keeping shared URLs short and letting
 * "Clear all" produce a clean `/providers`.
 */

export type SortKey = 'newest' | 'rating' | 'price-asc' | 'price-desc';

/** Values shown in the UI. Price/rating are kept as strings while typing. */
export interface DirectoryFilters {
  keyword: string;
  location: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  rating: string;
  availability: string;
  sort: SortKey;
  page: number;
}

export const DEFAULT_FILTERS: DirectoryFilters = {
  keyword: '',
  location: '',
  category: '',
  minPrice: '',
  maxPrice: '',
  rating: '',
  availability: '',
  sort: 'newest',
  page: 1,
};

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

export const RATING_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Any rating' },
  { value: '3', label: '3.0 and up' },
  { value: '4', label: '4.0 and up' },
  { value: '4.5', label: '4.5 and up' },
];

const SORT_KEYS = SORT_OPTIONS.map((option) => option.value);

/** Reads filters out of a URL query string. Unknown values fall back to defaults. */
export function parseFilters(params: URLSearchParams): DirectoryFilters {
  const sort = params.get('sort') ?? '';
  const page = Number(params.get('page') ?? '1');

  return {
    keyword: params.get('keyword') ?? '',
    location: params.get('location') ?? '',
    category: params.get('category') ?? '',
    minPrice: params.get('minPrice') ?? '',
    maxPrice: params.get('maxPrice') ?? '',
    rating: params.get('rating') ?? '',
    availability: params.get('availability') ?? '',
    sort: (SORT_KEYS as string[]).includes(sort) ? (sort as SortKey) : 'newest',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * Serialises filters to a query string, omitting defaults.
 * `page` is always emitted when greater than 1 so the active page is explicit.
 */
export function serialiseFilters(filters: DirectoryFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.location.trim()) params.set('location', filters.location.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.minPrice) params.set('minPrice', filters.minPrice);
  if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.availability) params.set('availability', filters.availability);
  if (filters.sort !== 'newest') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

/** How many filters are narrowing the results (sort and page do not count). */
export function activeFilterCount(filters: DirectoryFilters): number {
  return [
    filters.keyword,
    filters.location,
    filters.category,
    filters.minPrice,
    filters.maxPrice,
    filters.rating,
    filters.availability,
  ].filter((value) => value !== '').length;
}
