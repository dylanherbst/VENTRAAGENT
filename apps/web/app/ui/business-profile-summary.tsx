'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { summariseBusiness, UNREADABLE } from '../../lib/business-profile-summary';
import type { BusinessProfileSummary as Summary, Part } from '../../lib/business-profile-summary';
import { offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import { pricingScenarioStorageKey, restorePricingScenarioWorksheet } from '../../lib/local-pricing-scenario';
import type { Profile } from '../../lib/onboarding';

function read<T>(load: () => T | null): Part<T> { try { return load(); } catch { return UNREADABLE; } }

// Read-only. Reads each saved part through its own restore function; a failure marks only that part unreadable.
export default function BusinessProfileSummary({ profile }: { profile: Profile }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    const id = profile.id;
    setS(summariseBusiness({
      profile,
      offers: read(() => { const r = restoreLocalOffers(localStorage.getItem(offerStorageKey(id)), profile); if (!r) throw new Error('unreadable'); return r; }),
      pricing: read(() => restorePricingScenarioWorksheet(localStorage.getItem(pricingScenarioStorageKey(id)), id)),
    }));
  }, [profile]);
  if (!s) return <p role="status">Loading…</p>;
  return <section aria-label="Business profile summary" data-testid="business-profile-summary">
    <h2>{s.name || 'Your business'}</h2>
    <p>{s.route} · {s.stage} · {s.pathways.join(' and ')}. Read from what you have saved in this browser; nothing here is estimated. <Link href="/onboarding">Edit business details</Link></p>
    {s.details.length > 0 && <dl>{s.details.map(d => <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>}
    <h3>Offers and pricing</h3>
    {s.offers.status === 'unreadable' ? <p role="alert" data-testid="summary-offers-unreadable">Saved offers could not be read. Nothing was changed.</p>
      : s.offers.value.length === 0 ? <p data-testid="summary-offers-empty">No saved offers yet. <Link href="/business?tab=offers">Add an offer</Link></p>
      : <ul data-testid="summary-offers">{s.offers.value.map(o => <li key={o.id}>{o.name} ({o.kind}): {o.price}</li>)}</ul>}
    <p data-testid="summary-pricing">{s.pricingScenario.status === 'unreadable' ? 'Your saved pricing scenario could not be read.' : s.pricingScenario.value.saved ? `Pricing scenario saved (revision ${s.pricingScenario.value.revision}).` : 'No pricing scenario saved yet.'}</p>
    <h3>Plan progress</h3>
    <p data-testid="summary-progress">{s.planProgress.done} of {s.planProgress.total} plan steps marked complete{s.planProgress.nextStep ? `. Next: ${s.planProgress.nextStep}` : ''}.</p>
  </section>;
}
