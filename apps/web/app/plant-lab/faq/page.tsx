import type { Metadata } from 'next';
import { faqItems, pageMeta } from '../../../lib/aimp/plant/site-pages';
import { SiteShell } from '../_site/site-shell';

export const metadata: Metadata = {
  title: pageMeta.faq.title,
  description: pageMeta.faq.description,
  robots: { index: false, follow: false }, // lab route until the owner approves indexing
};

export default function FaqPage() {
  return (
    <SiteShell page="faq">
      <section className="amp-faq" aria-labelledby="faq-list-h">
        <h2 id="faq-list-h" className="amp-h3">Common questions</h2>
        <div>
          {faqItems.map((f) => (
            <details key={f.q}>
              <summary>{f.q}<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="more-h">
        <h2 id="more-h" className="amp-h3">Something else?</h2>
        <p>If your question is not answered here, <a href="/plant-lab/contact">contact us</a>.</p>
      </section>
    </SiteShell>
  );
}
