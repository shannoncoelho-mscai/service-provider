import { MapPin, Search, Wallet, X, Zap } from 'lucide-react';
import type { FormEvent } from 'react';
import type { CategoryOption } from '../../types';
import { RATING_OPTIONS, SORT_OPTIONS, type DirectoryFilters, type SortKey } from './filters';

export interface FilterDraft {
  keyword: string;
  location: string;
  minPrice: string;
  maxPrice: string;
}

interface FilterPanelProps {
  categories: CategoryOption[];
  /** Committed state, read from the URL. */
  filters: DirectoryFilters;
  /** Uncommitted text/price input values. */
  draft: FilterDraft;
  onDraftChange: (patch: Partial<FilterDraft>) => void;
  /** Commits the draft (search / price) filters to the URL. */
  onSubmit: () => void;
  /** Applies a discrete filter immediately. */
  onChange: (patch: Partial<DirectoryFilters>) => void;
  onClearAll: () => void;
  activeCount: number;
  /** Renders a close button when used inside the mobile drawer. */
  onClose?: () => void;
}

function FieldLabel({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft"
    >
      {children}
    </label>
  );
}

/**
 * The complete filter set, shared by the desktop sidebar and the mobile drawer
 * so the two can never drift apart.
 *
 * Text and price fields are deliberately *draft* state committed on submit;
 * chips, selects and the availability toggle apply immediately, which keeps
 * clicks feeling instant without spamming history for every keystroke.
 */
export default function FilterPanel({
  categories,
  filters,
  draft,
  onDraftChange,
  onSubmit,
  onChange,
  onClearAll,
  activeCount,
  onClose,
}: FilterPanelProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {onClose && (
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-brand-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Keyword + location -------------------------------------------- */}
      <div>
        <FieldLabel htmlFor="filter-keyword">Service</FieldLabel>
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 focus-within:border-brand-300">
          <Search className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          <input
            id="filter-keyword"
            type="text"
            value={draft.keyword}
            onChange={(e) => onDraftChange({ keyword: e.target.value })}
            placeholder="e.g. leaking tap"
            maxLength={120}
            className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
          />
        </div>

        <div className="mt-3">
          <FieldLabel htmlFor="filter-location">Location</FieldLabel>
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 focus-within:border-brand-300">
            <MapPin className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            <input
              id="filter-location"
              type="text"
              value={draft.location}
              onChange={(e) => onDraftChange({ location: e.target.value })}
              placeholder="City or service area"
              maxLength={120}
              className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Category ------------------------------------------------------ */}
      <div>
        <FieldLabel htmlFor="filter-category">Category</FieldLabel>
        <select
          id="filter-category"
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value, page: 1 })}
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm focus:border-brand-300 focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name} ({category.providerCount})
            </option>
          ))}
        </select>
      </div>

      {/* Price --------------------------------------------------------- */}
      <div>
        <FieldLabel htmlFor="filter-min-price">Price range (₹)</FieldLabel>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-line px-2.5 focus-within:border-brand-300">
            <Wallet className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
            <input
              id="filter-min-price"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.minPrice}
              onChange={(e) => onDraftChange({ minPrice: e.target.value })}
              placeholder="Min"
              aria-label="Minimum price in rupees"
              className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
            />
          </div>
          <span className="text-ink-soft" aria-hidden="true">
            –
          </span>
          <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-line px-2.5 focus-within:border-brand-300">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.maxPrice}
              onChange={(e) => onDraftChange({ maxPrice: e.target.value })}
              placeholder="Max"
              aria-label="Maximum price in rupees"
              className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Rating -------------------------------------------------------- */}
      <div>
        <FieldLabel htmlFor="filter-rating">Minimum rating</FieldLabel>
        <select
          id="filter-rating"
          value={filters.rating}
          onChange={(e) => onChange({ rating: e.target.value, page: 1 })}
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm focus:border-brand-300 focus:outline-none"
        >
          {RATING_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Availability -------------------------------------------------- */}
      <button
        type="button"
        onClick={() => onChange({ availability: filters.availability === 'true' ? '' : 'true', page: 1 })}
        aria-pressed={filters.availability === 'true'}
        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
          filters.availability === 'true'
            ? 'border-brand-300 bg-brand-50 text-brand-800'
            : 'border-line text-ink hover:bg-brand-50/50'
        }`}
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <Zap className="h-4 w-4 shrink-0" aria-hidden="true" />
          Available now
        </span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            filters.availability === 'true' ? 'bg-brand-600' : 'bg-slate-300'
          }`}
          aria-hidden="true"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              filters.availability === 'true' ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>

      {/* Sort ---------------------------------------------------------- */}
      <div>
        <FieldLabel htmlFor="filter-sort">Sort by</FieldLabel>
        <select
          id="filter-sort"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm focus:border-brand-300 focus:outline-none"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Actions ------------------------------------------------------- */}
      <div className="mt-auto flex gap-2 pt-1">
        <button type="submit" className="btn btn-primary flex-1 px-4 py-2.5 text-sm">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </button>
        {activeCount > 0 && (
          <button type="button" onClick={onClearAll} className="btn btn-ghost px-4 py-2.5 text-sm">
            Clear ({activeCount})
          </button>
        )}
      </div>
    </form>
  );
}
