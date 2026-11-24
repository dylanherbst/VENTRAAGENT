'use client';
import { useEffect } from 'react';

/** Scrolls to and focuses the element named in the URL hash once it exists (editors load after the page).
 *  Opens a <details> target. Presentation only; gives up after about 3 seconds. */
export function HashAnchor() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        window.clearInterval(timer);
        if (el instanceof HTMLDetailsElement) el.open = true;
        // The anchor may be a zero-height marker placed before the section: use the section that follows it.
        const root = el.classList.contains('v-anchor') && el.nextElementSibling instanceof HTMLElement ? el.nextElementSibling : el;
        root.scrollIntoView({ block: 'start' });
        const control = root.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');
        const target = control ?? root;
        if (!control && !target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      } else if (++tries > 30) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
export const Anchor = ({ id }: { id: string }) => <span id={id} className="v-anchor" aria-hidden="true" />;
