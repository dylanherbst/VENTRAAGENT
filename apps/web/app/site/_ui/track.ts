'use client';
// Conversion events (owner brief: visits, CTA clicks, demo engagement, pricing views, checkout starts/completions/abandonment,
// by source and device). Nothing leaves the browser unless the visitor accepts analytics. With consent, events go to
// window.dataLayer, so any analytics tool the owner adds later (and only then) can read them. No third-party script is loaded here.
export type SiteEvent = 'page_view' | 'cta_click' | 'journey_select' | 'demo_play' | 'demo_tab' | 'receptionist_demo' | 'setter_demo'
  | 'pricing_view' | 'get_started_open' | 'chat_message' | 'email_capture' | 'checkout_start' | 'checkout_complete' | 'checkout_abandon';
const KEY = 'ventra-site-consent';
export function consent(): 'yes' | 'no' | null {
  try { const v = localStorage.getItem(KEY); return v === 'yes' || v === 'no' ? v : null; } catch { return null; }
}
export function setConsent(v: 'yes' | 'no') {
  try { localStorage.setItem(KEY, v); } catch { /* private mode: treat as not stored */ }
  if (v === 'yes') track('page_view');
}
function context() {
  const p = new URLSearchParams(location.search);
  return { source: p.get('utm_source') ?? (document.referrer ? new URL(document.referrer).hostname : 'direct'), campaign: p.get('utm_campaign'), device: matchMedia('(max-width: 859px)').matches ? 'mobile' : 'desktop', path: location.pathname };
}
export function track(event: SiteEvent, detail: Record<string, string | number | boolean | null> = {}) {
  if (typeof window === 'undefined' || consent() !== 'yes') return;
  const w = window as unknown as { dataLayer?: unknown[] };
  (w.dataLayer ??= []).push({ event: 'ventra_' + event, ...context(), ...detail, at: Date.now() });
}
