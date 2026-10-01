import { ArrowRight, BadgeCheck, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import Reveal from '../Reveal';

const PERKS = [
  'Publish your services and prices in minutes',
  'Set your own service area and availability',
  'Accept or decline every booking request',
  'Build a public rating from completed jobs',
] as const;

/** Call to action for professionals. */
export default function ProviderCta() {
  return (
    <section className="py-16 sm:py-20">
      <div className="shell">
        <Reveal>
          <div className="relative overflow-hidden rounded-4xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 px-6 py-12 text-white shadow-glow sm:px-12 sm:py-14">
            {/* Decorative wash — purely visual. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="animate-float-slow absolute -right-10 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <div className="bg-dot-grid absolute inset-0 opacity-20 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
            </div>

            <div className="relative grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-100">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  For professionals
                </span>

                <h2 className="mt-5 text-3xl font-bold leading-tight sm:text-4xl">
                  Do you work locally? Get found by customers who are ready to book.
                </h2>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-brand-100">
                  Create a free profile, list what you offer, and let verified customers come to
                  you. You stay in control of what you take on.
                </p>

                <ul className="mt-7 grid gap-2.5 sm:grid-cols-2">
                  {PERKS.map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-sm text-brand-50">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
                      {perk}
                    </li>
                  ))}
                </ul>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link to="/login" className="btn btn-invert px-6 py-3">
                    List your business
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href="#how-it-works"
                    className="btn border border-white/25 px-6 py-3 text-white hover:bg-white/10"
                  >
                    See how it works
                  </a>
                </div>
              </div>

              {/* Simple credibility panel — avoids generic dashboard chrome. */}
              <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur-sm">
                <p className="text-sm font-semibold text-white">What happens next</p>
                <ol className="mt-4 space-y-4">
                  {[
                    { step: '01', text: 'Register as a provider — your profile starts as pending.' },
                    { step: '02', text: 'Our team reviews your details and trade credentials.' },
                    { step: '03', text: 'Once approved you appear in search and can take bookings.' },
                  ].map((item) => (
                    <li key={item.step} className="flex gap-3">
                      <span className="font-display text-sm font-bold text-accent-400">
                        {item.step}
                      </span>
                      <span className="text-sm leading-relaxed text-brand-50">{item.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
