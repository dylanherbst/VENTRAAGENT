import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { storeMetadata } from '../../../lib/aimp/hosts/seo';
import { loadPublishedStore, purchaseState } from '../../../lib/aimp/storefront/load';
import type { StoreSection } from '../../../lib/aimp/storefront/schema';
import { storeBase } from './_ui/base';
import { BundleCard, Cover, ProductCard } from './_ui/parts';
import { formatPrice } from '../../../lib/aimp/storefront/load';
import { VisitBeacon } from '../../../lib/aimp/funnel/beacon';
import { TestPurchaseForm } from './_ui/test-purchase-form';
import { OptInForm } from './_ui/opt-in-form';
import { readOptInWording } from './_server/audience';
import { optInDeps } from './_server/audience-wiring';
import { offerTestPurchase } from './_server/test-purchase';
import { testPurchaseDeps } from './_server/wiring';

export async function generateMetadata({ params }: { params: Promise<{ store: string }> }): Promise<Metadata> {
  const store = await loadPublishedStore((await params).store);
  return store ? storeMetadata(store, process.env, { path: '' }) : { title: 'Store not found', robots: { index: false, follow: false } };
}

export default async function StoreHome({ params }: { params: Promise<{ store: string }> }) {
  const store = await loadPublishedStore((await params).store);
  if (!store) notFound();
  const base = await storeBase(store.slug);
  const state = purchaseState(store);
  const testOffer = await offerTestPurchase(testPurchaseDeps(), store);
  // The consent line is read from the store's own stored form; if it cannot be read, the sign-up form is not shown at all.
  const optInWording = testOffer ? await readOptInWording(optInDeps(), store.slug) : null;
  const featured = store.products.filter((p) => p.featured);
  const hero = featured[0] ?? store.products[0];
  const heroCovers = [hero, ...store.products.filter((p) => p !== hero)].slice(0, 3);
  const show = (s: StoreSection) => store.sections.includes(s);

  return (
    <>
      <VisitBeacon slug={store.slug} />
      <section className="st-hero">
        <div className="st-wrap st-hero-inner">
          <div className="st-hero-copy">
            {store.hero.eyebrow ? <p className="st-eyebrow">{store.hero.eyebrow}</p> : null}
            <h1>{store.hero.heading}</h1>
            <p className="st-lead">{store.hero.subheading}</p>
            <div className="st-hero-actions">
              <a className="st-btn st-btn-primary" href="#catalogue">{store.hero.ctaLabel}</a>
              <p className="st-hero-price"><span className="st-hero-price-num">{formatPrice(hero.priceMinor)}</span> <span className="st-hero-price-what">{hero.title}, {hero.format}{hero.pages ? `, ${hero.pages} pages` : ''}</span></p>
            </div>
          </div>
          <div className="st-hero-art">
            {heroCovers.map((p, i) => <Cover key={p.slug} style={p.cover.style} label={p.cover.label} large={i === 0} />)}
            <span className="st-sticker" aria-hidden="true">Instant download</span>
          </div>
        </div>
      </section>

      {show('trust') && store.trust.length > 0 ? (
        <section className="st-wrap st-trust" aria-label="Why buy here">
          {store.trust.map((t) => <div key={t.title}><h2 className="st-h3">{t.title}</h2><p className="st-muted">{t.body}</p></div>)}
        </section>
      ) : null}

      {show('featured') && featured.length > 0 ? (
        <section className="st-wrap st-section" aria-labelledby="featured-h">
          <h2 id="featured-h">Most loved</h2>
          <div className="st-grid">{featured.map((p) => <ProductCard key={p.slug} product={p} base={base} />)}</div>
        </section>
      ) : null}

      {show('bundles') && store.bundles.length > 0 ? (
        <section className="st-wrap st-section" aria-labelledby="bundles-h">
          <h2 id="bundles-h">Bundles</h2>
          {store.bundles.map((b) => <BundleCard key={b.slug} store={store} bundle={b} base={base} state={state} />)}
        </section>
      ) : null}

      {show('catalogue') ? (
        <section id="catalogue" className="st-wrap st-section" aria-labelledby="all-h">
          <h2 id="all-h">All products</h2>
          <div className="st-grid">{store.products.map((p) => <ProductCard key={p.slug} product={p} base={base} />)}</div>
        </section>
      ) : null}

      {testOffer ? <TestPurchaseForm store={store.slug} label={testOffer.label} /> : null}
      {testOffer && optInWording ? <OptInForm store={store.slug} wording={optInWording} /> : null}

      {show('faq') && store.faq.length > 0 ? (
        <section id="faq" className="st-wrap st-section st-narrow" aria-labelledby="faq-h">
          <h2 id="faq-h">Questions</h2>
          {store.faq.map((f) => (
            <details key={f.question} className="st-faq">
              <summary>{f.question}</summary>
              <p>{f.answer}</p>
            </details>
          ))}
        </section>
      ) : null}

      {show('newsletter') ? (
        <section className="st-wrap st-section">
          <div className="st-newsletter">
            <h2>Get a free weekly printable</h2>
            <p className="st-muted">Join the list for one new page each week. Unsubscribe any time.</p>
            <form className="st-signup" aria-describedby="signup-note">
              <label className="st-sr" htmlFor="signup-email">Email address</label>
              <input id="signup-email" type="email" placeholder="you@example.com" disabled={store.demo} />
              <button type="button" className="st-btn st-btn-primary" disabled>Subscribe</button>
            </form>
            <p id="signup-note" className="st-note">{store.demo ? 'Demo store: sign-up is turned off.' : 'Sign-up opens once consent capture is connected.'}</p>
          </div>
        </section>
      ) : null}
    </>
  );
}
