import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { storeMetadata } from '../../../../../lib/aimp/hosts/seo';
import { findProduct, formatPrice, loadPublishedStore, purchaseState } from '../../../../../lib/aimp/storefront/load';
import { storeBase } from '../../_ui/base';
import { BuyButton, Cover, Price, ProductCard } from '../../_ui/parts';
import { TestPurchaseForm } from '../../_ui/test-purchase-form';
import { offerTestPurchase } from '../../_server/test-purchase';
import { testPurchaseDeps } from '../../_server/wiring';

type Params = { params: Promise<{ store: string; product: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { store: s, product: p } = await params;
  const store = await loadPublishedStore(s);
  const product = store ? findProduct(store, p) : undefined;
  if (!store || !product) return { title: 'Not found', robots: { index: false, follow: false } };
  // No product images exist yet; when catalogue assets are wired, pass only preview/cover/mockup rows as `assets`.
  return storeMetadata(store, process.env, { path: `/products/${product.slug}`, title: product.title, description: product.summary });
}

export default async function ProductPage({ params }: Params) {
  const { store: s, product: p } = await params;
  const store = await loadPublishedStore(s);
  const product = store ? findProduct(store, p) : undefined;
  if (!store || !product) notFound();
  const base = await storeBase(store.slug);
  const state = purchaseState(store);
  const testOffer = await offerTestPurchase(testPurchaseDeps(), store);
  const related = store.products.filter((x) => x.slug !== product.slug).slice(0, 3);
  // Structured data for search (plan §D06). No availability claim until checkout is live.
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.title, description: product.summary,
    brand: { '@type': 'Brand', name: store.brand.name },
    offers: { '@type': 'Offer', price: (product.priceMinor / 100).toFixed(2), priceCurrency: 'AUD' },
  };

  return (
    <>
      <div className="st-wrap st-crumbs"><a href={base || '/'}>Home</a> / <a href={`${base}/#catalogue`}>Shop</a> / <span aria-current="page">{product.title}</span></div>
      <article className="st-wrap st-product">
        <div className="st-product-art"><Cover style={product.cover.style} label={product.cover.label} large /></div>
        <div className="st-product-info">
          <p className="st-eyebrow">Digital download · {product.format}{product.pages ? ` · ${product.pages} pages` : ''}</p>
          <h1>{product.title}</h1>
          <p className="st-lead">{product.summary}</p>
          <p className="st-price-lg"><Price minor={product.priceMinor} compareAt={product.compareAtMinor} /></p>
          <BuyButton state={state} id="buy-product" label={`Buy now · ${formatPrice(product.priceMinor)}`} />
          <h2 className="st-h3">What you get</h2>
          <ul className="st-list st-checks">{product.includes.map((i) => <li key={i}>{i}</li>)}</ul>
          <div className="st-prose">{product.description.map((d) => <p key={d}>{d}</p>)}</div>
          <p className="st-small st-muted">Digital product: nothing is shipped. Personal use only. See the <a href={`${base}/policies/refund`}>refund policy</a>.</p>
        </div>
      </article>
      {testOffer ? <TestPurchaseForm store={store.slug} label={testOffer.label} /> : null}
      {related.length > 0 ? (
        <section className="st-wrap st-section" aria-labelledby="related-h">
          <h2 id="related-h">You may also like</h2>
          <div className="st-grid">{related.map((r) => <ProductCard key={r.slug} product={r} base={base} />)}</div>
        </section>
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    </>
  );
}
