import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="shell py-20 text-center">
      <p className="font-display text-6xl font-extrabold text-brand-600">404</p>
      <h1 className="mt-4 text-2xl font-bold text-ink">Page not found</h1>
      <p className="mt-2 text-ink-soft">The page you are looking for does not exist.</p>
      <Link to="/" className="btn btn-primary mt-6 px-5 py-2.5 text-sm">
        Back to home
      </Link>
    </div>
  );
}
