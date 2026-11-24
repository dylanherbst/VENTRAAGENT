import type { Metadata } from 'next';
import { capabilities, control, howSteps, pageMeta } from '../../../lib/aimp/plant/site-pages';
import { SiteShell, StatusPill } from '../_site/site-shell';

export const metadata: Metadata = {
  title: pageMeta['how-it-works'].title,
  description: pageMeta['how-it-works'].description,
  robots: { index: false, follow: false }, // lab route until the owner approves indexing
};

export default function HowItWorksPage() {
  return (
    <SiteShell page="how-it-works">
      <section aria-labelledby="steps-h">
        <h2 id="steps-h" className="amp-h3">The steps</h2>
        <ol className="amp-steps">
          {howSteps.map((s, i) => (
            <li key={s.title}>
              <span className="amp-step-n">Step {i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <StatusPill status={s.status} />
            </li>
          ))}
        </ol>
      </section>

      <section className="amp-after" aria-labelledby="status-h">
        <h2 id="status-h" className="amp-h3">What works today, and what does not yet</h2>
        <ul>
          {capabilities.map((c) => (
            <li key={c.title}>
              <div><strong>{c.title}</strong><p>{c.body}</p></div>
              <StatusPill status={c.status} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="control-h">
        <h2 id="control-h" className="amp-h3">You stay in control</h2>
        <ul className="amp-plainlist">
          {control.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </section>
    </SiteShell>
  );
}
