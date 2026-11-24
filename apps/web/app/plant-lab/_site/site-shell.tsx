import type { ReactNode } from 'react';
import { site } from '../../../lib/aimp/site-config';
import { BUILD_HREF, PRIMARY_CTA, pageMeta, sitePages, statusLabels, type SitePageId, type Status } from '../../../lib/aimp/plant/site-pages';
import { TrackedLink } from '../tracked-link';
import { fontVars } from '../fonts';
import '../tokens.css';
import '../plant.css';
import './pages.css';

const statusClass: Record<Status, string> = { working: 'live', pilot: 'pilot', planned: 'soon' };

export function StatusPill({ status }: { status: Status }) {
  return <span className={`amp-status amp-status-${statusClass[status]}`}>{statusLabels[status]}</span>;
}

/** Shared frame for the public pages: header with links between them, the page heading, one primary call to action, footer. */
export function SiteShell({ page, notice, children }: { page: SitePageId; notice?: string; children: ReactNode }) {
  const meta = pageMeta[page];
  return (
    <div className={`amp amp-home amp-sub ${fontVars}`}>
      <a className="amp-skip" href="#main">Skip to content</a>
      <header className="amp-header">
        <div className="amp-wrap amp-header-inner">
          <a className="amp-logo" href="/plant-lab" aria-label={`${site.name} home`}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21c0-5 0-8 4.5-12.5C18.5 6.5 20 6 21 6c0 1-.5 2.5-2.5 4.5C14 15 12 16 12 21Zm0 0c0-3.5-1-6-4-8.5C6.5 11.3 5 11 4 11c0 1 .4 2.3 2 3.8C8.6 17.4 12 18 12 21Z" fill="currentColor" /></svg>
            {site.name}
          </a>
          <nav className="amp-pnav" aria-label="Main">
            {sitePages.map((p) => (
              <a key={p.id} href={p.href} aria-current={p.id === page ? 'page' : undefined}>{p.label}</a>
            ))}
          </nav>
          <TrackedLink className="amp-btn amp-btn-primary amp-btn-sm" href={BUILD_HREF} event={{ cta: 'header', page }}>{PRIMARY_CTA}</TrackedLink>
        </div>
      </header>

      <main id="main">
        <div className="amp-wrap">
          <div className="amp-page-head">
            {notice ? <p className="amp-notice">{notice}</p> : null}
            <h1 className="amp-display">{meta.h1}</h1>
            <p className="amp-lead">{meta.lead}</p>
          </div>
          <div className="amp-page-body">{children}</div>
        </div>

        <section className="amp-page-cta" aria-labelledby="page-cta-h">
          <div className="amp-wrap">
            <h2 id="page-cta-h" className="amp-h2">See a sample business first</h2>
            <p className="amp-lead">The preview is free and needs no account or card. It is a labelled sample, not a forecast.</p>
            <TrackedLink className="amp-btn amp-btn-primary" href={BUILD_HREF} event={{ cta: 'page_primary', page }}>{PRIMARY_CTA}</TrackedLink>
          </div>
        </section>
      </main>

      <footer className="amp-footer">
        <div className="amp-wrap amp-footer-inner">
          <p className="amp-logo">{site.name}</p>
          <nav className="amp-fnav" aria-label="Footer">
            <a href="/plant-lab">Home</a>
            {sitePages.map((p) => <a key={p.id} href={p.href}>{p.label}</a>)}
          </nav>
          <p className="amp-small">Pilot pricing and features are being tested and may change. Nothing on this site is financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
