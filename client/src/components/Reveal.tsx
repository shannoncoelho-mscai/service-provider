import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Stagger in milliseconds, for grids of cards. */
  delay?: number;
  className?: string;
}

/**
 * Fades content up the first time it scrolls into view.
 *
 * Motion is a nicety, never a requirement: if the OS asks for reduced motion
 * the content renders immediately and no observer is attached. Elements also
 * start visible if IntersectionObserver is unavailable, so content can never
 * be trapped at opacity 0.
 */
export default function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect(); // reveal once, then stop watching
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 ease-out ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3.5 opacity-0'
      } ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
