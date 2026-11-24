import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { availability, checkBusiness } from '../../start/_server/runtime';
import { getOfferState } from '../../../lib/aimp/offers/store';
import { buildShopPage } from '../../../lib/aimp/shop/page';
import { BuyBox } from './buy-box';
import { VisitBeacon } from '../../../lib/aimp/funnel/beacon';
import './shop.css';

export const dynamic = 'force-dynamic';

async function load(business: string) {
  if (!availability().available || !checkBusiness(business)) return null;
  return buildShopPage(getOfferState(business), business, { paymentsLive: false });
}

export async function generateMetadata({ params }: { params: Promise<{ business: string }> }): Promise<Metadata> {
  const shop = await load((await params).business);
  return shop ? { title: shop.title, description: shop.pitch } : { title: 'Shop' };
}

// Shareable one-page shop. Mobile first: the price and Buy now sit in a bar that stays at the bottom of a phone screen.
export default async function ShopPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const shop = await load(business);
  if (!shop) notFound();
  return (
    <main className="shop">
      <VisitBeacon shop={business} />
      <header className="shop-hero">
        <p className="shop-for">{shop.forWho}</p>
        <h1>{shop.title}</h1>
        <p className="shop-pitch">{shop.pitch}</p>
        <p className="shop-price">{shop.priceLabel}</p>
        <BuyBox business={business} label={shop.buy.label} live={shop.buy.live} note={shop.buy.note} />
      </header>
      <section aria-labelledby="get-h">
        <h2 id="get-h">What you get</h2>
        <ul>{shop.whatYouGet.map((t) => <li key={t}>{t}</li>)}</ul>
        <ul className="shop-facts">{shop.facts.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section aria-labelledby="sample-h">
        <h2 id="sample-h">See inside first</h2>
        <p>A free sample of the real pages.</p>
        <a className="shop-btn shop-btn-alt" href={shop.sampleHref} target="_blank" rel="noopener">Open the free sample (PDF)</a>
      </section>
      <section aria-labelledby="after-h">
        <h2 id="after-h">After you buy</h2>
        <p>{shop.afterBuying}</p>
      </section>
      <div className="shop-bar" role="region" aria-label="Buy">
        <span className="shop-bar-price">{shop.priceLabel}</span>
        <a className="shop-btn" href="#buy" aria-disabled={!shop.buy.live}>{shop.buy.label}</a>
      </div>
    </main>
  );
}
