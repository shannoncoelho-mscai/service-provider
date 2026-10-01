import { Eye, Handshake, ShieldCheck, Timer, Wallet } from 'lucide-react';
import Reveal from '../Reveal';
import SectionHeading from '../SectionHeading';

const REASONS = [
  {
    icon: ShieldCheck,
    title: 'Manually verified, not self-declared',
    text: 'Every provider is reviewed by our team before appearing in search. If verification lapses, the listing disappears automatically.',
  },
  {
    icon: Wallet,
    title: 'Prices you can see upfront',
    text: 'Each service carries a published starting price and duration, so you can compare like for like before you get in touch.',
  },
  {
    icon: Eye,
    title: 'Ratings that mean something',
    text: 'Reviews can only be left against completed bookings, so a rating reflects real work rather than a happy snap.',
  },
  {
    icon: Timer,
    title: 'Know who is actually available',
    text: 'Filter for providers currently offering services, and send your request without waiting to hear back.',
  },
  {
    icon: Handshake,
    title: 'One place, no chasing',
    text: 'Search, compare, request and review in one thread — instead of scattered phone calls and missed voicemails.',
  },
] as const;

export default function WhyServiceConnect() {
  return (
    <section id="why" className="border-y border-line bg-white py-16 sm:py-20">
      <div className="shell">
        <Reveal>
          <SectionHeading
            eyebrow="Why ServiceConnect"
            title="Built to remove the guesswork"
            description="Most bad experiences with local services come from the same three problems. We fixed all of them."
          />
        </Reveal>

        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map((reason, index) => (
            <Reveal key={reason.title} delay={index * 60}>
              <li
                className={`card h-full p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift ${
                  index === REASONS.length - 1 ? 'sm:col-span-2 lg:col-span-1' : ''
                }`}
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <reason.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-semibold leading-snug text-ink">{reason.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{reason.text}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
