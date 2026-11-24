'use client';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
/** Fades content in as it scrolls into view. Reduced motion: shown at once (CSS). */
export function Reveal({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`vs-reveal ${className}`}>{children}</Tag>;
}
