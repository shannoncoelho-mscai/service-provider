import type { ReactNode } from 'react';

interface SectionHeadingProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}

/** Consistent section header: eyebrow pill, display title, supporting copy. */
export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  className = '',
}: SectionHeadingProps) {
  const centered = align === 'center';

  return (
    <div
      className={`${centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'} ${className}`}
    >
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-bold leading-tight text-ink sm:text-4xl">{title}</h2>
      {description && (
        <p className={`mt-4 text-base leading-relaxed text-ink-soft sm:text-lg ${centered ? 'mx-auto' : ''}`}>
          {description}
        </p>
      )}
    </div>
  );
}
