import { AlertCircle, ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FilterPanel, { type FilterDraft } from '../components/providers/FilterPanel';
import ProviderCard, { ProviderCardSkeleton } from '../components/providers/ProviderCard';
import {
  activeFilterCount,
  parseFilters,
  serialiseFilters,
  type DirectoryFilters,
} from '../components/providers/filters';
import { listCategories, searchProviders } from '../lib/api';
import type { CategoryOption, ProviderSearchResponse } from '../types';

const PAGE_SIZE = 12;

/** Maps the UI sort key onto the API's separate `sort` + `order` parameters. */
function toApiQuery(filters: DirectoryFilters) {
  const [sort, order] =
    filters.sort === 'price-asc'
      ? (['price', 'asc'] as const)
      : filters.sort === 'price-desc'
        ? (['price', 'desc'] as const)
        : filters.sort === 'rating'
          ? (['rating', 'desc'] as const)
          : (['newest', 'desc'] as const);

  return {
    keyword: filters.keyword || undefined,
    location: filters.location || undefined,
    category: filters.category || undefined,
    minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
    rating: filters.rating ? Number(filters.rating) : undefined,
    availability: filters.availability === 'true' ? true : undefined,
    sort,
    order,
    page: filters.page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Provider search directory.
 *
 * The URL is the single source of truth: every filter is serialised into the
 * query string, so a result set is shareable and survives refresh and the back
 * button. All filtering happens server-side — this page never filters
 * client-side, and it never receives contact details because the API does not
 * send them (ADR-021).
 */
export default function ProvidersPage() {
  const [params, setParams] = useSearchParams();

  // Committed filters come straight from the URL.
  const filters = parseFilters(params);
  const queryKey = params.toString();

  const [draft, setDraft] = useState<FilterDraft>({
    keyword: filters.keyword,
    location: filters.location,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
  });
  const [data, setData] = useState<ProviderSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Re-sync the text inputs when the URL changes elsewhere (clear all, back).
  useEffect(() => {
    const current = parseFilters(new URLSearchParams(queryKey));
    setDraft({
      keyword: current.keyword,
      location: current.location,
      minPrice: current.minPrice,
      maxPrice: current.maxPrice,
    });
  }, [queryKey]);

  // Category options come from the API, so the list can never go stale.
  useEffect(() => {
    let cancelled = false;
    listCategories()
      .then((result) => !cancelled && setCategories(result))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch results for the current URL.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    searchProviders(toApiQuery(parseFilters(new URLSearchParams(queryKey))))
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  function commit(next: Partial<DirectoryFilters>) {
    const merged: DirectoryFilters = { ...filters, ...next };
    // Any change that narrows results should return to the first page.
    if (!('page' in next)) merged.page = 1;
    setParams(serialiseFilters(merged));
  }

  /** Commits the uncommitted text/price inputs (search bar and price fields). */
  function commitDraft() {
    commit({
      keyword: draft.keyword,
      location: draft.location,
      minPrice: draft.minPrice,
      maxPrice: draft.maxPrice,
    });
  }

  const activeCount = activeFilterCount(filters);
  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 0;

  const filterPanelProps = {
    categories,
    filters,
    draft,
    onDraftChange: (patch: Partial<FilterDraft>) => setDraft((prev) => ({ ...prev, ...patch })),
    onSubmit: commitDraft,
    onChange: commit,
    onClearAll: () => setParams(new URLSearchParams()),
    activeCount,
  };

  return (
    <div className="shell py-8 sm:py-12">
      {/* Page header + mobile filter trigger --------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-ink">Find a pro</h1>
          <p className="mt-2 text-ink-soft">
            Every listing is verified by our team before it appears here.
          </p>
        </div>

        {/* Mobile-only trigger; the sidebar is hidden below lg. */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="btn btn-ghost px-4 py-2.5 text-sm lg:hidden"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="ml-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-xs text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile quick search — controls stay usable without the drawer. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commitDraft();
        }}
        className="card mt-5 flex gap-2 p-2 sm:hidden"
      >
        <div className="flex flex-1 items-center gap-2 px-2">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          <input
            value={draft.keyword}
            onChange={(event) => setDraft((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="Search services"
            aria-label="Search services"
            className="w-full bg-transparent py-2 text-sm focus:outline-none"
          />
        </div>
        <button type="submit" className="btn btn-primary px-4 py-2 text-sm">
          Search
        </button>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr]">
        {/* Desktop sidebar ------------------------------------------- */}
        <aside className="hidden lg:block">
          <div className="card sticky top-20 p-5">
            <FilterPanel {...filterPanelProps} />
          </div>
        </aside>

        {/* Results --------------------------------------------------- */}
        <section aria-live="polite" aria-busy={loading}>
          {/* Result count + reset ------------------------------------- */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              {loading
                ? 'Searching…'
                : failed
                  ? 'Search unavailable'
                  : `${total} verified ${total === 1 ? 'provider' : 'providers'} found`}
            </p>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams())}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
            )}
          </div>

          {/* Loading state ------------------------------------------ */}
          {loading && (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <li key={index}>
                  <ProviderCardSkeleton />
                </li>
              ))}
            </ul>
          )}

          {/* Error state -------------------------------------------- */}
          {!loading && failed && (
            <div className="card mt-4 flex flex-col items-center gap-3 p-10 text-center">
              <AlertCircle className="h-8 w-8 text-accent-500" aria-hidden="true" />
              <p className="font-semibold text-ink">Could not load providers</p>
              <p className="max-w-sm text-sm text-ink-soft">
                The search service is not responding. Start the API with{' '}
                <code className="rounded bg-brand-50 px-1 py-0.5 font-mono text-brand-700">
                  npm run dev:server
                </code>{' '}
                and try again.
              </p>
              <button
                type="button"
                onClick={() => commit({})}
                className="btn btn-ghost mt-1 px-4 py-2 text-sm"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {/* Empty state -------------------------------------------- */}
          {!loading && !failed && total === 0 && (
            <div className="card mt-4 p-10 text-center">
              <p className="font-semibold text-ink">No providers match those filters</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
                Try a broader keyword, a different area, or widen the price and rating range.
              </p>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => setParams(new URLSearchParams())}
                  className="btn btn-primary mt-5 px-5 py-2.5 text-sm"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {/* Results ------------------------------------------------- */}
          {!loading && !failed && total > 0 && (
            <>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data?.providers.map((provider) => (
                  <li key={provider.id}>
                    <ProviderCard provider={provider} />
                  </li>
                ))}
              </ul>

              {totalPages > 1 && (
                <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                  <button
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() => commit({ page: filters.page - 1 })}
                    className="btn btn-ghost px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous
                  </button>
                  <span className="text-sm text-ink-soft">
                    Page {filters.page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={!data?.pagination.hasNext}
                    onClick={() => commit({ page: filters.page + 1 })}
                    className="btn btn-ghost px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>

      {/* Mobile filter drawer ---------------------------------------- */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
        >
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 right-0 flex w-[min(22rem,90vw)] flex-col overflow-y-auto bg-white p-5 shadow-lift">
            <FilterPanel {...filterPanelProps} onClose={() => setDrawerOpen(false)} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="btn btn-primary mt-4 w-full px-4 py-3 text-sm"
            >
              Show results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


