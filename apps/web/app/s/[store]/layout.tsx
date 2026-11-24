import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { canonicalBase } from '../../../lib/aimp/hosts/seo';
import { loadPublishedStore, policyPages } from '../../../lib/aimp/storefront/load';
import { renderConfig } from '../../../lib/aimp/storefront/render-config';
import { storeBase } from './_ui/base';
import './store.css';
import './store-templates.css';
import { storeFontVars } from './_ui/fonts';

export const dynamic = 'force-dynamic';

type Props = { children: ReactNode; params: Promise<{ store: string }> };

export async function generateMetadata({ params }: { params: Promise<{ store: string }> }): Promise<Metadata> {
  // Published snapshot only (AMP-032): an unpublished or paused store gets no metadata of its own and is not indexed.
  const store = await loadPublishedStore((await params).store);
  if (!store) return { title: 'Store not found', robots: { index: false, follow: false } };
  const origin = canonicalBase(store.slug, process.env).origin;
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: store.seo.title, template: `%s · ${store.brand.name}` },
    description: store.seo.description,
    robots: renderConfig(store).robots,
  };
}

export default async function StoreLayout({ children, params }: Props) {
  const store = await loadPublishedStore((await params).store);
  if (!store) notFound();
  const base = await storeBase(store.slug);
  const rc = renderConfig(store);
  const vars = rc.cssVars as CSSProperties;
  const year = new Date().getUTCFullYear();
  return (
    <div className={`st ${storeFontVars}`} style={vars} {...rc.attrs}>
      <a className="st-skip" href="#st-main">Skip to content</a>
      {store.demo ? <p className="st-demo" role="note"><strong>DEMO STORE</strong> Sample products and policies. Checkout is turned off.</p> : null}
      <header className="st-header">
        <div className="st-wrap st-header-inner">
          <a className="st-logo" href={base || '/'}>{rc.logo ? <img className="st-logo-img" src={rc.logo} alt="" width={36} height={36} /> : null}<span>{store.brand.name}</span></a>
          <nav aria-label="Store">
            <a href={`${base}/#catalogue`}>Shop</a>
            <a href={`${base}/#faq`}>FAQ</a>
            <a href={`${base}/contact`}>Contact</a>
          </nav>
        </div>
      </header>
      <main id="st-main">{children}</main>
      <footer className="st-footer">
        <div className="st-wrap st-footer-inner">
          <div>
            <p className="st-logo">{store.brand.name}</p>
            <p className="st-muted">{store.brand.tagline}</p>
          </div>
          <nav aria-label="Policies" className="st-footer-links">
            {Object.entries(policyPages).map(([key, title]) => <a key={key} href={`${base}/policies/${key}`}>{title}</a>)}
            <a href={`${base}/contact`}>Contact</a>
          </nav>
          <p className="st-small st-muted">
            © {year} {store.contact.businessName}{store.contact.abn ? `, ABN ${store.contact.abn}` : ''}. Prices in AUD.
            <br />Store built with AiMoneyPrinter.
          </p>
        </div>
      </footer>
    </div>
  );
}
