import { Mail, MapPin, Phone, ShieldCheck, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';

const COLUMNS = [
  {
    title: 'Find services',
    links: [
      { label: 'Plumbing', to: '/providers?category=plumbing' },
      { label: 'Electrical', to: '/providers?category=electrical' },
      { label: 'Cleaning', to: '/providers?category=cleaning' },
      { label: 'Mechanics', to: '/providers?category=automotive-repair' },
    ],
  },
  {
    title: 'For providers',
    links: [
      { label: 'List your business', to: '/login' },
      { label: 'How verification works', to: '/#how-it-works' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/#why' },
      { label: 'How it works', to: '/#how-it-works' },
      { label: 'Browse all', to: '/providers' },
    ],
  },
] as const;

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-white">
      <div className="shell py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          {/* Brand */}
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                <Wrench className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="font-display text-lg font-bold tracking-tight text-ink">
                ServiceConnect
              </span>
            </Link>

            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-soft">
              A local service marketplace where every professional is verified by our team before
              customers can find them.
            </p>

            <ul className="mt-5 space-y-2.5 text-sm text-ink-soft">
              <li className="inline-flex items-center gap-2">
                <Mail className="h-4 w-4 text-brand-500" aria-hidden="true" />
                hello@serviceconnect.example
              </li>
              <li className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4 text-brand-500" aria-hidden="true" />
                +1 (555) 013-4000
              </li>
              <li className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-brand-500" aria-hidden="true" />
                Remote-first · College project
              </li>
            </ul>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
                  {column.title}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="text-sm text-ink-soft transition-colors hover:text-brand-600"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-soft">
            © {year} ServiceConnect. A college project — providers shown are fictional demo data.
          </p>
          <p className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-500" aria-hidden="true" />
            Providers are verified before they appear in search
          </p>
        </div>
      </div>
    </footer>
  );
}
