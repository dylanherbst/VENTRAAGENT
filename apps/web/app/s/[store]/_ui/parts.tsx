import type { CoverStyle, StoreBundle, StoreConfig, StoreProduct } from '../../../../lib/aimp/storefront/schema';
import { bundleItems, formatPrice, type PurchaseState } from '../../../../lib/aimp/storefront/load';

/** Deterministic product cover drawn in the store's own palette. Replaced by real rendered covers from the factory. */
export function Cover({ style, label, large = false }: { style: CoverStyle; label: string; large?: boolean }) {
  const n = Array.from({ length: 10 }, (_, i) => i);
  // A printed page: a coloured title band, then the page's own pattern, so each product type is recognisable at a glance.
  return (
    <div className={`st-cover${large ? ' st-cover-lg' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 300 380" preserveAspectRatio="xMidYMid slice">
        <rect width="300" height="380" fill="var(--st-soft)" />
        <rect x="44" y="34" width="216" height="318" fill="var(--st-ink)" opacity="0.08" transform="translate(5 6)" />
        <rect x="44" y="34" width="216" height="318" fill="var(--st-surface)" />
        <rect x="44" y="34" width="216" height="92" fill="var(--st-accent)" />
        <text x="62" y="92" fontSize={Math.max(13, Math.min(24, Math.floor(330 / Math.max(label.length, 1))))} fill="var(--st-accent-ink)" style={{ fontFamily: 'var(--st-font)' }}>{label}</text>
        {style === 'grid' && n.slice(0, 6).map((i) => <rect key={i} x="62" y={146 + i * 32} width="180" height="22" fill="none" stroke="var(--st-line)" strokeWidth="1.5" />)}
        {style === 'lines' && n.map((i) => <line key={i} x1="62" x2="242" y1={152 + i * 19} y2={152 + i * 19} stroke="var(--st-line)" strokeWidth="1.5" />)}
        {style === 'dots' && n.slice(0, 7).flatMap((r) => n.slice(0, 7).map((c) => <circle key={`${r}-${c}`} cx={70 + c * 27} cy={152 + r * 27} r="3.2" fill="var(--st-accent)" fillOpacity="0.35" />))}
        {style === 'arch' && <path d="M100 330V222a52 52 0 0 1 104 0v108" fill="var(--st-soft)" stroke="var(--st-accent)" strokeWidth="2" />}
      </svg>
    </div>
  );
}

export function Price({ minor, compareAt }: { minor: number; compareAt?: number }) {
  return (
    <span className="st-price">
      {formatPrice(minor)}
      {compareAt ? <s className="st-compare" aria-label={`Was ${formatPrice(compareAt)}`}>{formatPrice(compareAt)}</s> : null}
    </span>
  );
}

/** The only buy control. It cannot render an active button unless purchaseState allows it (plan §D03, §E02). */
export function BuyButton({ state, id, label = 'Buy now' }: { state: PurchaseState; id: string; label?: string }) {
  if (!state.canBuy) {
    return (
      <div className="st-buy">
        <button type="button" className="st-btn st-btn-primary" disabled aria-describedby={`${id}-note`}>{label}</button>
        <p id={`${id}-note`} className="st-note">{state.reason}</p>
      </div>
    );
  }
  // Unreachable until checkoutBuilt is true; the checkout form is added with the Stripe checkout route.
  return <div className="st-buy"><button type="button" className="st-btn st-btn-primary">{label}</button></div>;
}

export function ProductCard({ product, base }: { product: StoreProduct; base: string }) {
  return (
    <a className="st-card" href={`${base}/products/${product.slug}`}>
      <Cover style={product.cover.style} label={product.cover.label} />
      <span className="st-card-body">
        <span className="st-card-meta">{product.format}{product.pages ? `, ${product.pages} pages` : ''}</span>
        <span className="st-card-title">{product.title}</span>
        <span className="st-card-summary">{product.summary}</span>
        <Price minor={product.priceMinor} compareAt={product.compareAtMinor} />
      </span>
    </a>
  );
}

export function BundleCard({ store, bundle, base, state }: { store: StoreConfig; bundle: StoreBundle; base: string; state: PurchaseState }) {
  const items = bundleItems(store, bundle);
  const total = items.reduce((sum, p) => sum + p.priceMinor, 0);
  return (
    <article className="st-bundle">
      <div className="st-bundle-covers">
        {items.slice(0, 3).map((p) => <Cover key={p.slug} style={p.cover.style} label={p.cover.label} />)}
      </div>
      <div className="st-bundle-body">
        <p className="st-save">Save {formatPrice(total - bundle.priceMinor)} together</p>
        <h3>{bundle.title}</h3>
        <p className="st-muted">{bundle.summary}</p>
        <ul className="st-list">
          {items.map((p) => <li key={p.slug}><a href={`${base}/products/${p.slug}`}>{p.title}</a></li>)}
        </ul>
        <Price minor={bundle.priceMinor} compareAt={total} />
        <BuyButton state={state} id={`buy-${bundle.slug}`} label="Buy the bundle" />
      </div>
    </article>
  );
}
