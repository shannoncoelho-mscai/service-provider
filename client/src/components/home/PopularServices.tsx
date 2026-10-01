import {
  Armchair,
  Car,
  Droplets,
  Hammer,
  PaintRoller,
  Snowflake,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Reveal from '../Reveal';
import SectionHeading from '../SectionHeading';

/**
 * Popular Services.
 *
 * Each card links to a REAL seeded category slug, so no card is a dead end.
 * Two labels are phrased for customers while pointing at the closest seeded
 * category: "Mechanics" → automotive-repair, "AC & Appliance Repair" →
 * appliance-repair.
 */
const CATEGORIES = [
  { slug: 'plumbing', label: 'Plumbing', hint: 'Leaks, drains, boilers', icon: Wrench, tint: 'bg-brand-50 text-brand-600' },
  { slug: 'electrical', label: 'Electrical', hint: 'Wiring, panels, lighting', icon: Zap, tint: 'bg-accent-50 text-accent-600' },
  { slug: 'carpentry', label: 'Carpentry', hint: 'Furniture, doors, decks', icon: Hammer, tint: 'bg-brand-50 text-brand-600' },
  { slug: 'painting', label: 'Painting', hint: 'Interior & exterior', icon: PaintRoller, tint: 'bg-accent-50 text-accent-600' },
  { slug: 'automotive-repair', label: 'Mechanics', hint: 'Servicing & repairs', icon: Car, tint: 'bg-brand-50 text-brand-600' },
  { slug: 'cleaning', label: 'Cleaning', hint: 'Homes & offices', icon: Sparkles, tint: 'bg-accent-50 text-accent-600' },
  { slug: 'appliance-repair', label: 'AC & Appliance Repair', hint: 'Cooling & white goods', icon: Snowflake, tint: 'bg-brand-50 text-brand-600' },
  { slug: 'interior-design', label: 'Interior Design', hint: 'Rooms & styling', icon: Armchair, tint: 'bg-accent-50 text-accent-600' },
] as const;

export default function PopularServices() {
  return (
    <section id="services" className="py-16 sm:py-20">
      <div className="shell">
        <Reveal>
          <SectionHeading
            eyebrow="Popular services"
            title="Start with what you need fixed"
            description="Eight everyday trades, one search. Pick a category to see verified professionals who cover it."
          />
        </Reveal>

        <ul className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {CATEGORIES.map((category, index) => (
            <Reveal key={category.slug} delay={index * 45}>
              <li className="h-full list-none">
                <Link
                  to={`/providers?category=${category.slug}`}
                  className="card group flex h-full flex-col p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift"
                >
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${category.tint} transition-transform duration-300 group-hover:scale-110`}
                  >
                    <category.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-semibold leading-snug text-ink">{category.label}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{category.hint}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition-colors group-hover:text-brand-700">
                    Browse
                    <Droplets className="h-3.5 w-3.5 -rotate-45 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
