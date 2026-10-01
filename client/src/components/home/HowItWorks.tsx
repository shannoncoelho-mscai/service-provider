import { CalendarCheck, Search, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import Reveal from '../Reveal';
import SectionHeading from '../SectionHeading';

const STEPS = [
  {
    icon: Search,
    title: 'Search & compare',
    text: 'Tell us the job and your area. Filter by trade, budget, rating and availability to shortlist the right people.',
  },
  {
    icon: CalendarCheck,
    title: 'Send a booking request',
    text: 'Pick a service and a time that suits you. The provider accepts, reschedules or explains why they cannot take it.',
  },
  {
    icon: ShieldCheck,
    title: 'Get it done, then review',
    text: 'Every provider is verified by our team before going live, and completed jobs feed their public rating.',
  },
] as const;

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-line bg-white py-16 sm:py-20">
      <div className="shell">
        <Reveal>
          <SectionHeading
            eyebrow="How ServiceConnect works"
            title="Three steps from problem to fixed"
            description="No phone tag, no guessing who is actually available. Everything happens in one place."
          />
        </Reveal>

        <ol className="mt-12 grid gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 90}>
              <li className="card relative h-full p-6">
                {/* Connector line between steps on wide screens. */}
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[calc(50%+2.5rem)] top-11 hidden h-px w-[calc(100%-4rem)] bg-gradient-to-r from-brand-200 to-transparent md:block"
                  />
                )}

                <div className="flex items-center gap-4">
                  <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lift">
                    <step.icon className="h-5 w-5" aria-hidden="true" />
                    <span className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-accent-500 text-xs font-bold text-white">
                      {index + 1}
                    </span>
                  </span>
                  <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-ink-soft">{step.text}</p>
              </li>
            </Reveal>
          ))}
        </ol>

        <Reveal delay={120} className="mt-10 text-center">
          <Link to="/providers" className="btn btn-primary px-6 py-3">
            Browse verified providers
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
