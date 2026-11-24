'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { pageForPath, track } from '../../lib/aimp/plant/measure';

/**
 * Mounted once in the plant-lab layout, before the page content. Records the page view and watches FAQ opens
 * and contact-email clicks. Older analytics calls go straight to the measurement module (lib/aimp/analytics.ts
 * is a forwarder). It never reads or sends free text, and it makes no network call.
 */
export function MeasureBridge() {
  const pathname = usePathname();
  const page = pageForPath(pathname ?? '');

  useEffect(() => {
    if (!page) return;
    track('page_view', { page });
    if (page === 'build') track('build_step_reached', { step: 'choose' });
  }, [page]);

  useEffect(() => {
    const onToggle = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLDetailsElement) || !el.open || !el.parentElement) return;
      const items = Array.from(el.parentElement.querySelectorAll(':scope > details'));
      const index = items.indexOf(el);
      if (index >= 0 && index < 100) track('faq_open', { index });
    };
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="mailto:"]') : null;
      if (a) track('contact_click', { channel: 'email' });
    };
    document.addEventListener('toggle', onToggle, true); // toggle does not bubble
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return null;
}
