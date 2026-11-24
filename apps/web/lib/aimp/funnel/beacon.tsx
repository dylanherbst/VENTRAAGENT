'use client';
// Counts one anonymous visit (or checkout click) per browser session. sessionStorage only; nothing if storage is blocked.
import { useEffect } from 'react';

export function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem('aimp_fs');
    if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('aimp_fs', id); }
    return id;
  } catch { return null; }
}

export function sendFunnel(target: { shop?: string; slug?: string }, step: 'visit' | 'checkout_click'): void {
  const session = sessionId();
  if (!session) return;
  const body = JSON.stringify({ ...target, step, session });
  try { if (!navigator.sendBeacon?.('/api/aimp/funnel', new Blob([body], { type: 'application/json' }))) void fetch('/api/aimp/funnel', { method: 'POST', body, keepalive: true }); } catch { /* counting must never break the page */ }
}

export function VisitBeacon({ shop, slug }: { shop?: string; slug?: string }) {
  useEffect(() => { sendFunnel(shop ? { shop } : { slug }, 'visit'); }, [shop, slug]);
  return null;
}
