import type { Metadata } from 'next';
import { site } from '../../../lib/aimp/site-config';
import { PRICING_NOTICE, comparisonRows, pageMeta, planButton, pricingNotes, statusLabels } from '../../../lib/aimp/plant/site-pages';
import { SiteShell } from '../_site/site-shell';
import { TrackedLink } from '../tracked-link';

export const metadata: Metadata = {
  title: pageMeta.pricing.title,
  description: pageMeta.pricing.description,
  robots: { index: false, follow: false }, // lab route until the owner approves indexing
};

const features = comparisonRows.filter((r) => r.id !== 'price');

export default function PricingPage() {
  return (
    <SiteShell page="pricing" notice={PRICING_NOTICE}>
      <section aria-labelledby="compare-h">
        <h2 id="compare-h" className="amp-h3">Compare the plans</h2>
        <ul className="amp-compare">
          {site.plans.map((plan) => (
            <li key={plan.id}>
              <h3>{plan.name}</h3>
              <p className="amp-price">{plan.priceAud === 0 ? 'Free' : <>A${plan.priceAud}<span> a month (draft)</span></>}</p>
              <p className="amp-plan-blurb">{plan.blurb}</p>
              <dl>
                {features.map((row) => {
                  const value = row.cells[plan.id];
                  return (
                    <div key={row.id}>
                      <dt>{row.label}{row.status ? ` (${statusLabels[row.status].toLowerCase()})` : ''}</dt>
                      <dd className={value === 'Not included' ? 'is-off' : undefined}>{value}</dd>
                    </div>
                  );
                })}
              </dl>
              <TrackedLink className="amp-btn amp-btn-secondary" href={planButton(plan).href} event={{ cta: 'pricing_page', plan: plan.id }}>
                {planButton(plan).label}
              </TrackedLink>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notes-h">
        <h2 id="notes-h" className="amp-h3">What to know about these prices</h2>
        <ul className="amp-plainlist">
          {pricingNotes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>
    </SiteShell>
  );
}
