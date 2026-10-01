import { MapPin, Search, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildQuery } from '../../lib/api';

const TRUST_POINTS = [
  { icon: ShieldCheck, label: 'Admin-verified professionals' },
  { icon: Star, label: 'Transparent ratings & pricing' },
  { icon: Sparkles, label: 'No call-out surprises' },
] as const;

/**
 * Hero: the exact headline from the brief, a two-field search that hands off
 * to the directory, and trust signals. The form is a real GET form so it
 * degrades gracefully without JavaScript; onSubmit only enhances it.
 */
export default function Hero() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Empty fields are omitted rather than sent blank, so the directory shows
    // everything instead of an empty result set.
    navigate(`/providers${buildQuery({ keyword: keyword.trim(), location: location.trim() })}`);
  }

  return (
    <section className="relative overflow-hidden bg-white">
      {/* Decorative background: soft brand wash, dot grid, floating blobs. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-50/80 via-white to-canvas" />
        <div className="bg-dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
        <div className="animate-float-slow absolute -left-20 top-10 h-64 w-64 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="animate-float-slower absolute -right-16 top-32 h-72 w-72 rounded-full bg-accent-100/60 blur-3xl" />
      </div>

      <div className="shell relative pb-16 pt-14 sm:pb-20 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <span className="eyebrow animate-fade-in">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Trusted local pros, one search away
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] text-ink sm:text-5xl lg:text-6xl">
            Find reliable local services.
            <span className="mt-2 block text-gradient">Book the right professional for the job.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            Plumbers, electricians, carpenters, painters, cleaners and more — every provider is
            reviewed by our team before customers can find them.
          </p>

          {/* Search ------------------------------------------------------ */}
          <form
            onSubmit={handleSubmit}
            method="get"
            action="/providers"
            className="animate-fade-up mx-auto mt-10 max-w-3xl"
          >
            <div className="rounded-2xl border border-line bg-white/90 p-2 shadow-glow backdrop-blur sm:p-3">
              <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto] sm:gap-3">
                <div className="flex items-center gap-3 rounded-xl border border-transparent px-3 transition-colors focus-within:border-brand-200 focus-within:bg-brand-50/60 sm:border-line">
                  <Search className="h-5 w-5 shrink-0 text-brand-500" aria-hidden="true" />
                  <label htmlFor="hero-keyword" className="sr-only">
                    What service do you need?
                  </label>
                  <input
                    id="hero-keyword"
                    name="keyword"
                    type="text"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="What service do you need?"
                    maxLength={120}
                    className="w-full bg-transparent py-3 text-base text-ink placeholder:text-ink-soft/70 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-transparent px-3 transition-colors focus-within:border-brand-200 focus-within:bg-brand-50/60 sm:border-line">
                  <MapPin className="h-5 w-5 shrink-0 text-brand-500" aria-hidden="true" />
                  <label htmlFor="hero-location" className="sr-only">
                    Where?
                  </label>
                  <input
                    id="hero-location"
                    name="location"
                    type="text"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Where?"
                    maxLength={120}
                    className="w-full bg-transparent py-3 text-base text-ink placeholder:text-ink-soft/70 focus:outline-none"
                  />
                </div>

                <button type="submit" className="btn btn-primary px-6 py-3 text-base">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search Services
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-ink-soft">
              Try &ldquo;leaking tap&rdquo;, &ldquo;panel upgrade&rdquo; or a city name.
            </p>
          </form>

          {/* Trust row --------------------------------------------------- */}
          <ul className="animate-fade-up mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {TRUST_POINTS.map((point) => (
              <li key={point.label} className="inline-flex items-center gap-2 text-sm text-ink-soft">
                <point.icon className="h-4 w-4 text-brand-500" aria-hidden="true" />
                {point.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
