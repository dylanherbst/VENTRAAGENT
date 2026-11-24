import type { Metadata } from 'next';
import { site } from '../../../lib/aimp/site-config';
import { BUILD_HREF, pageMeta } from '../../../lib/aimp/plant/site-pages';
import { SiteShell } from '../_site/site-shell';

export const metadata: Metadata = {
  title: pageMeta.contact.title,
  description: pageMeta.contact.description,
  robots: { index: false, follow: false }, // lab route until the owner approves indexing
};

export default function ContactPage() {
  // The address comes from site-config only. If it is ever removed, the page says so instead of showing an invented one.
  const email: string = site.supportEmail;
  return (
    <SiteShell page="contact">
      <section aria-labelledby="email-h">
        <h2 id="email-h" className="amp-h3">Email</h2>
        {email ? (
          <>
            <p className="amp-contact-email"><a href={`mailto:${email}`}>{email}</a></p>
            <p>This opens your own email app. There is no contact form on this site, and nothing is sent from this page.</p>
          </>
        ) : (
          <p>Contact details are being finalised. In the meantime you can <a href={BUILD_HREF}>start with the free preview</a>.</p>
        )}
      </section>

      <section aria-labelledby="before-h">
        <h2 id="before-h" className="amp-h3">Before you write</h2>
        <ul className="amp-plainlist">
          <li>Many questions are answered on the <a href="/plant-lab/faq">questions and answers</a> page.</li>
          <li>Plan details are on the <a href="/plant-lab/pricing">pricing</a> page, which shows draft pilot pricing.</li>
          <li>Please do not email card numbers, passwords or identity documents.</li>
        </ul>
      </section>
    </SiteShell>
  );
}
