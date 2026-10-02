import {
  BadgeCheck,
  Briefcase,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Store,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  createMyProviderService,
  deleteMyProviderService,
  getMyProviderProfile,
  listCategories,
  listMyProviderServices,
  updateMyProviderService,
  updateMyProviderProfile,
} from '../lib/api';
import { formatPrice } from '../lib/format';
import type {
  CategoryOption,
  CreateServiceInput,
  ProviderProfile,
  ProviderService,
  UpdateMyProviderInput,
} from '../types';
import VerificationNotice from '../components/provider/VerificationNotice';
import { Alert, ErrorState, Field, LoadingState, inputClass } from '../components/ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; profile: ProviderProfile }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'error' };

/** Draft of the editable business profile. */
interface ProfileDraft {
  businessName: string;
  description: string;
  phone: string;
  city: string;
  serviceAreas: string;
  yearsExperience: string;
  hourlyRate: string;
}

const draftFrom = (profile: ProviderProfile): ProfileDraft => ({
  businessName: profile.businessName ?? '',
  description: profile.description ?? '',
  phone: profile.phone ?? '',
  city: profile.city ?? '',
  serviceAreas: profile.serviceAreas.join(', '),
  yearsExperience: profile.yearsExperience > 0 ? String(profile.yearsExperience) : '',
  hourlyRate: profile.hourlyRate ?? '',
});

/** Comma/newline separated areas → the string[] the API expects. */
function parseAreas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((area) => area.trim())
    .filter(Boolean);
}

/** Goa service areas offered as quick-add chips; the field stays free text. */
const SUGGESTED_AREAS = [
  'Panaji',
  'Mapusa',
  'Margao',
  'Ponda',
  'Porvorim',
  'Vasco da Gama',
];

/**
 * A service form. Prices are rupees held as strings until submitted.
 *
 * `categoryId` is set only when the provider PICKS an existing suggestion; the
 * moment they type, it is cleared and `categoryInput` is sent as free text for
 * the server to resolve. That keeps "pick one of ours" and "invent a new one"
 * mutually exclusive without a mode switch.
 */
interface ServiceDraft {
  id: string | null;
  name: string;
  description: string;
  /** The visible text in the category combobox. */
  categoryInput: string;
  /** '' when the text is a NEW category the server must resolve. */
  categoryId: string;
  priceFrom: string;
  priceTo: string;
  durationMinutes: string;
}

const blankService = (): ServiceDraft => ({
  id: null,
  name: '',
  description: '',
  categoryInput: '',
  categoryId: '',
  priceFrom: '',
  priceTo: '',
  durationMinutes: '',
});

/**
 * Edit an existing service.
 *
 * The owner's DTO already carries BOTH `categoryId` and `categoryName`, so no
 * slug-to-id lookup is needed here — the previous version had to search the
 * category list for a matching slug, which silently failed for a category not
 * present in that list.
 */
function toDraft(service: ProviderService): ServiceDraft {
  return {
    id: service.id,
    name: service.name,
    description: service.description ?? '',
    categoryInput: service.categoryName,
    categoryId: service.categoryId,
    priceFrom: service.priceFrom,
    priceTo: service.priceTo ?? '',
    durationMinutes: service.durationMinutes ? String(service.durationMinutes) : '',
  };
}

/**
 * Validate a service draft against the server's own rules, before sending.
 *
 * The category check mirrors the schema's "exactly one selector" rule: either a
 * picked id, or non-empty free text. Note the trim — the server collapses
 * whitespace and slugs the name, so "  " is not a category.
 */
function validateService(draft: ServiceDraft): string | null {
  if (!draft.name.trim()) return 'Enter a service name.';
  if (draft.name.trim().length < 3) return 'The name must be at least 3 characters.';
  if (!draft.categoryId && !draft.categoryInput.trim()) {
    return 'Choose a category or type a new one.';
  }

  const from = Number(draft.priceFrom);
  if (draft.priceFrom.trim() === '' || !Number.isFinite(from) || from < 0) {
    return 'Enter a starting price.';
  }
  if (draft.priceTo.trim() !== '') {
    const to = Number(draft.priceTo);
    if (!Number.isFinite(to) || to < 0) return 'The upper price must be a number.';
    if (to < from) return 'The upper price must be at least the starting price.';
  }
  if (draft.durationMinutes.trim() !== '') {
    const minutes = Number(draft.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
      return 'The duration must be a whole number of minutes between 15 and 1440.';
    }
  }
  return null;
}

/** Shared field set for the service editor, so create and edit stay identical. */
function ServiceFields({
  draft,
  categories,
  busy,
  onChange,
}: {
  draft: ServiceDraft;
  categories: CategoryOption[];
  busy: boolean;
  onChange: (patch: Partial<ServiceDraft>) => void;
}) {
  // Filter the existing categories by what has been typed so far. Matching is
  // case-insensitive on both name and slug, so "plumb" finds "Plumbing". An
  // EMPTY box shows everything rather than nothing, so the provider can browse
  // the list without typing first.
  const term = draft.categoryInput.trim().toLowerCase();
  const suggestions = categories
    .filter(
      (category) =>
        term === '' ||
        category.name.toLowerCase().includes(term) ||
        category.slug.includes(term),
    )
    .slice(0, 8);

  return (
    <>
      <Field id="service-name" label="Service name" required>
        {(field) => (
          <input
            {...field}
            type="text"
            required
            disabled={busy}
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Emergency pipe repair"
            className={`${inputClass} mt-1.5`}
          />
        )}
      </Field>

      {/*
        Category combobox: free text with suggestions.

        A provider must be able to invent a category ("Pest Control",
        "CCTV Installation") that does not exist yet, so a <select> is the wrong
        control — it can only offer what is already there. Typing filters the
        suggestions; clicking one pins its id. Typing anything else leaves
        `categoryId` empty and the server resolves the free text into a real
        category row (ADR-031).
      */}
      <div>
        <label htmlFor="service-category" className="block text-sm font-semibold text-ink">
          Category <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-ink-soft">
          Pick one of the suggestions, or type your own — a new category is created
          automatically.
        </p>
        <input
          id="service-category"
          type="text"
          required
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls="service-category-suggestions"
          autoComplete="off"
          disabled={busy}
          value={draft.categoryInput}
          onChange={(e) =>
            // Any edit clears the pinned id: the text is now the source of truth
            // and may no longer describe the category that was picked.
            onChange({ categoryInput: e.target.value, categoryId: '' })
          }
          placeholder="e.g. Plumbing, or Pest Control"
          className={`${inputClass} mt-1.5`}
        />

        {suggestions.length > 0 && (
          <ul
            id="service-category-suggestions"
            role="listbox"
            aria-label="Category suggestions"
            className="mt-1.5 max-h-44 overflow-y-auto rounded-xl border border-line bg-white shadow-soft"
          >
            {suggestions.map((category) => (
              <li key={category.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={draft.categoryId === category.id}
                  disabled={busy}
                  onClick={() =>
                    onChange({ categoryInput: category.name, categoryId: category.id })
                  }
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-brand-50"
                >
                  <span>{category.name}</span>
                  {draft.categoryId === category.id && (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Says plainly which of the two will be sent, so the provider is never
            guessing about a hidden id. */}
        <p className="mt-1.5 text-xs text-ink-soft">
          {draft.categoryId
            ? 'Using an existing category.'
            : draft.categoryInput.trim()
              ? `Will create the category "${draft.categoryInput.trim()}".`
              : 'Suggestions appear as you type.'}
        </p>
      </div>

      <Field
        id="service-price-from"
        label="Price from (₹)"
        required
        hint="Rupees only — the ₹ symbol is added when the price is displayed."
      >
        {(field) => (
          <input
            {...field}
            type="number"
            required
            min={0}
            step={1}
            disabled={busy}
            value={draft.priceFrom}
            onChange={(e) => onChange({ priceFrom: e.target.value })}
            placeholder="2500"
            className={`${inputClass} mt-1.5`}
          />
        )}
      </Field>

      <Field
        id="service-price-to"
        label="Price up to (₹)"
        hint="Optional. Leave blank if the price is a flat figure."
      >
        {(field) => (
          <input
            {...field}
            type="number"
            min={0}
            step={1}
            disabled={busy}
            value={draft.priceTo}
            onChange={(e) => onChange({ priceTo: e.target.value })}
            placeholder="5000"
            className={`${inputClass} mt-1.5`}
          />
        )}
      </Field>

      <Field
        id="service-duration"
        label="Typical duration (minutes)"
        hint="Optional. 15 to 1440 minutes."
      >
        {(field) => (
          <input
            {...field}
            type="number"
            min={15}
            max={1440}
            step={15}
            disabled={busy}
            value={draft.durationMinutes}
            onChange={(e) => onChange({ durationMinutes: e.target.value })}
            placeholder="90"
            className={`${inputClass} mt-1.5`}
          />
        )}
      </Field>

      <Field
        id="service-description"
        label="Description"
        hint="Optional. What is included, and when a customer should book this."
      >
        {(field) => (
          <textarea
            {...field}
            rows={2}
            maxLength={2000}
            disabled={busy}
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            className={`${inputClass} mt-1.5 resize-y`}
          />
        )}
      </Field>
    </>
  );
}

/**
 * One row of the provider's own service list.
 *
 * EXPORTED (rather than inlined in the page's `.map`) so the crash that whited
 * out /provider/business is directly renderable in a test. `service.categoryName`
 * is flat because the OWNER endpoints return it flat — see `ProviderService`.
 * Rendering `service.category.name` here is what threw "Cannot read properties
 * of undefined (reading 'name')".
 */
export function ProviderServiceRow({
  service,
  busy,
  onEdit,
  onRemove,
}: {
  service: ProviderService;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{service.name}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{service.categoryName}</p>
          {!service.isActive && (
            <p className="mt-1 text-xs font-semibold text-amber-600">
              Inactive — customers cannot book this service
            </p>
          )}
          {service.description && (
            <p className="mt-1.5 text-sm text-ink-soft">{service.description}</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-brand-700">
              {formatPrice(service.priceFrom)}
              {service.priceTo && service.priceTo !== service.priceFrom
                ? ` – ${formatPrice(service.priceTo)}`
                : ''}
            </span>
            {service.durationMinutes && (
              <span className="inline-flex items-center gap-1 text-ink-soft">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {service.durationMinutes} min
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${service.name}`}
            className="btn btn-ghost p-2"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${service.name}`}
            className="btn btn-ghost p-2 text-red-600 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * "My business" — the provider's own profile and service catalogue (Phase 18).
 *
 * This exposes endpoints that already existed (`PATCH /providers/me` and the
 * four `/providers/me/services` routes) but had no UI. It is deliberately the
 * PROVIDER's own row: the server scopes every write to the verified session, so
 * there is no id to pick and nothing to spoof. Verification status is shown but
 * never editable — only an ADMIN can change it, and the profile schema is
 * `.strict()`, so an attempt would be rejected rather than quietly ignored.
 */
export default function ProviderBusinessPage() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [services, setServices] = useState<ProviderService[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [editing, setEditing] = useState<ServiceDraft | null>(null);
  const [savingService, setSavingService] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, mine, cats] = await Promise.all([
        getMyProviderProfile(),
        listMyProviderServices(),
        listCategories(),
      ]);
      setServices(mine);
      setCategories(cats);
      setDraft(draftFrom(profile));
      setState({ status: 'ready', profile });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setState({ status: 'unauthorized' });
      else if (err instanceof ApiError && err.status === 403) setState({ status: 'forbidden' });
      else setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingProfile || state.status !== 'ready' || !draft) return;

    // Send ONLY the fields that actually changed. The server rejects an empty
    // body ("at least one field must be provided"), and sending every field
    // would let an untouched optional field be blanked by a stale input.
    const original = draftFrom(state.profile);
    const input: UpdateMyProviderInput = {};
    if (draft.businessName.trim() && draft.businessName !== original.businessName) {
      input.businessName = draft.businessName.trim();
    }
    if (draft.description !== original.description) {
      input.description = draft.description.trim() || null;
    }
    if (draft.phone !== original.phone) input.phone = draft.phone.trim() || null;
    if (draft.city.trim() && draft.city !== original.city) input.city = draft.city.trim();
    if (parseAreas(draft.serviceAreas).join('|') !== parseAreas(original.serviceAreas).join('|')) {
      input.serviceAreas = parseAreas(draft.serviceAreas);
    }
    if (draft.yearsExperience !== original.yearsExperience) {
      const years = Number(draft.yearsExperience || '0');
      input.yearsExperience = Number.isFinite(years) ? years : 0;
    }
    if (draft.hourlyRate !== original.hourlyRate) {
      const rate = Number(draft.hourlyRate);
      input.hourlyRate = draft.hourlyRate.trim() !== '' && Number.isFinite(rate) ? rate : null;
    }

    if (Object.keys(input).length === 0) return;

    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const updated = await updateMyProviderProfile(input);
      setState({ status: 'ready', profile: updated });
      setDraft(draftFrom(updated));
      setProfileSaved(true);
    } catch (err) {
      setProfileError(
        err instanceof ApiError
          ? err.message
          : 'We could not save your details. Please try again.',
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || savingService) return;

    const problem = validateService(editing);
    if (problem) {
      setServiceError(problem);
      return;
    }

    setSavingService(true);
    setServiceError(null);
    // Exactly ONE category selector is sent. A picked suggestion goes across as
    // its id; typed text goes across as `categoryName` for the server to resolve
    // into a real category. Sending both is rejected by the schema as ambiguous.
    const payload: CreateServiceInput = {
      ...(editing.categoryId
        ? { categoryId: editing.categoryId }
        : { categoryName: editing.categoryInput.trim() }),
      name: editing.name.trim(),
      description: editing.description.trim() || null,
      priceFrom: Number(editing.priceFrom),
      priceTo: editing.priceTo.trim() === '' ? null : Number(editing.priceTo),
      durationMinutes:
        editing.durationMinutes.trim() === '' ? null : Number(editing.durationMinutes),
    };

    try {
      const saved = editing.id
        ? await updateMyProviderService(editing.id, payload)
        : await createMyProviderService(payload);
      setServices((current) =>
        editing.id
          ? current.map((service) => (service.id === saved.id ? saved : service))
          : [...current, saved],
      );
      setEditing(null);
    } catch (err) {
      setServiceError(
        err instanceof ApiError ? err.message : 'We could not save that service.',
      );
    } finally {
      setSavingService(false);
    }
  }

  async function removeService(service: ProviderService) {
    if (removingId) return;
    setRemovingId(service.id);
    setServiceError(null);
    try {
      await deleteMyProviderService(service.id);
      setServices((current) => current.filter((item) => item.id !== service.id));
      // If the removed row was open in the editor, close it too.
      setEditing((current) => (current?.id === service.id ? null : current));
    } catch (err) {
      setServiceError(
        err instanceof ApiError ? err.message : 'We could not remove that service.',
      );
    } finally {
      setRemovingId(null);
    }
  }

// --- gates ---------------------------------------------------------------
  if (state.status === 'loading') return <LoadingState label="Loading your business" />;

  if (state.status === 'unauthorized') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="Please sign in"
          message="You need to be signed in as a provider to manage your business."
        />
      </div>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <div className="shell py-12">
        <ErrorState
          title="This area is for providers"
          message="You are signed in with a different account type, so there is no business profile to show here."
        />
      </div>
    );
  }

  if (state.status === 'error' || !draft) {
    return (
      <div className="shell py-12">
        <ErrorState
          title="We could not load your business"
          message="Something went wrong fetching your profile. Please try again."
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const { profile } = state;

  return (
    <div className="shell py-8">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">My business</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Keep your details and services up to date. Customers see this information on your public
          profile once you are approved.
        </p>
      </header>

      <div className="mt-5">
        <VerificationNotice status={profile.verificationStatus} />
      </div>

      {profile.verificationStatus === 'PENDING' && (
        <div className="mt-4">
          <Alert variant="info">
            Your provider profile is pending administrator verification. You will appear in public
            listings after approval.
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* ---------------- Business profile ---------------- */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Store className="h-4 w-4 text-brand-600" aria-hidden="true" />
            Business profile
          </h2>

          <form onSubmit={saveProfile} noValidate className="mt-4 space-y-4">
            {profileError && <Alert>{profileError}</Alert>}
            {profileSaved && !profileError && (
              <Alert variant="info">Your business details have been saved.</Alert>
            )}

            <Field id="businessName" label="Business name" required>
              {(field) => (
                <input
                  {...field}
                  type="text"
                  required
                  disabled={savingProfile}
                  value={draft.businessName}
                  onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
                  className={`${inputClass} mt-1.5`}
                />
              )}
            </Field>

            <Field id="business-description" label="Business description">
              {(field) => (
                <textarea
                  {...field}
                  rows={3}
                  maxLength={2000}
                  disabled={savingProfile}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className={`${inputClass} mt-1.5 resize-y`}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="business-phone" label="Contact number">
                {(field) => (
                  <input
                    {...field}
                    type="tel"
                    disabled={savingProfile}
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    placeholder="+91 98220 12345"
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </Field>

              <Field id="business-city" label="City" required>
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    required
                    disabled={savingProfile}
                    value={draft.city}
                    onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </Field>
            </div>

            <Field
              id="business-areas"
              label="Service areas"
              hint="Separate towns with a comma. These appear on your public profile."
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  disabled={savingProfile}
                  value={draft.serviceAreas}
                  onChange={(e) => setDraft({ ...draft, serviceAreas: e.target.value })}
                  placeholder="Panaji, Mapusa"
                  className={`${inputClass} mt-1.5`}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_AREAS.map((area) => {
                const chosen = parseAreas(draft.serviceAreas).some(
                  (value) => value.toLowerCase() === area.toLowerCase(),
                );
                return (
                  <button
                    key={area}
                    type="button"
                    disabled={savingProfile || chosen}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        serviceAreas: [...parseAreas(draft.serviceAreas), area].join(', '),
                      })
                    }
                    className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                  >
                    + {area}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="business-years"
                label="Years of experience"
                hint="Whole number, 0 to 60."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    disabled={savingProfile}
                    value={draft.yearsExperience}
                    onChange={(e) => setDraft({ ...draft, yearsExperience: e.target.value })}
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </Field>

              <Field
                id="business-rate"
                label="Indicative starting rate (₹)"
                hint="Optional. A number in rupees, not a currency string."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min={0}
                    step={1}
                    disabled={savingProfile}
                    value={draft.hourlyRate}
                    onChange={(e) => setDraft({ ...draft, hourlyRate: e.target.value })}
                    placeholder="7500"
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </Field>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="btn btn-primary px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {savingProfile ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                'Save business details'
              )}
            </button>
          </form>

          {/*
            Read-only summary of what the public profile will show. Especially
            useful while PENDING, because an unapproved provider cannot preview
            their own public page at all.
          */}
          <dl className="mt-6 divide-y divide-line border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-soft">Visible in public search</dt>
              <dd className="font-medium text-ink">
                {profile.verificationStatus === 'APPROVED' ? 'Yes' : 'Not yet — awaiting approval'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-soft">Active services</dt>
              <dd className="font-medium text-ink">{services.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-soft">Service areas</dt>
              <dd className="max-w-[60%] text-right font-medium text-ink">
                {profile.serviceAreas.length > 0 ? profile.serviceAreas.join(', ') : 'None set'}
              </dd>
            </div>
          </dl>
        </section>

        {/* ---------------- Services ---------------- */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Briefcase className="h-4 w-4 text-brand-600" aria-hidden="true" />
            My services
          </h2>

          {serviceError && (
            <div className="mt-3">
              <Alert>{serviceError}</Alert>
            </div>
          )}

          {/* Editor: create (id null) or edit an existing row. */}
          {editing ? (
            <form
              onSubmit={saveService}
              noValidate
              className="mt-4 space-y-4 rounded-2xl border border-line bg-canvas/50 p-4"
            >
              <h3 className="text-sm font-semibold text-ink">
                {editing.id ? 'Edit service' : 'Add a service'}
              </h3>
              <ServiceFields
                draft={editing}
                categories={categories}
                busy={savingService}
                onChange={(patch) => setEditing({ ...editing, ...patch })}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingService}
                  className="btn btn-primary px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  {savingService ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : editing.id ? (
                    'Save changes'
                  ) : (
                    'Add service'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setServiceError(null);
                  }}
                  className="btn btn-ghost px-4 py-2.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditing(blankService());
                setServiceError(null);
              }}
              className="btn btn-primary mt-4 w-full px-4 py-2.5 text-sm"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a service
            </button>
          )}

          {services.length === 0 ? (
            <p className="mt-5 rounded-xl bg-canvas px-4 py-6 text-center text-sm text-ink-soft">
              You have not added any services yet. Add at least one so customers can book you.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {services.map((service) => (
                <ProviderServiceRow
                  key={service.id}
                  service={service}
                  busy={removingId === service.id}
                  onEdit={() => {
                    setEditing(toDraft(service));
                    setServiceError(null);
                  }}
                  onRemove={() => void removeService(service)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
