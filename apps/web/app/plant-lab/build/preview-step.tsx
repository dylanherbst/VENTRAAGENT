'use client';

import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { track } from '../../../lib/aimp/analytics';
import { money, type Preview } from '../../../lib/aimp/preview/generate';
import { storeThemes, validateStoreConfig, type StoreConfig, type StoreFont } from '../../../lib/aimp/storefront/schema';
import { Cover, Price } from '../../s/[store]/_ui/parts';
import { ProfitCalculator } from './profit-calculator';
import { IconArrowLeft, IconArrowRight, IconCheck, IconCircle, IconInfo, IconRefresh } from './icons';

// Same variable mapping as the tenant store layout (app/s/[store]/layout.tsx), so Cover and Price render identically.
const fontStacks: Record<StoreFont, string> = {
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', -apple-system, sans-serif",
};
function storeVars(store: StoreConfig): CSSProperties {
  const t = storeThemes[store.brand.theme];
  return {
    '--st-bg': t.bg, '--st-surface': t.surface, '--st-ink': t.ink, '--st-muted': t.muted, '--st-line': t.line,
    '--st-accent': t.accent, '--st-accent-ink': t.accentInk, '--st-soft': t.soft, '--st-font': fontStacks[store.brand.font],
  } as CSSProperties;
}

type Props = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  preview: Preview;
  onBack: () => void;
  onAnotherName: () => void;
  onAnotherNiche: () => void;
  onLaunch: () => void;
};

const STAGE_MS = 300;

export function PreviewStep({ headingRef, preview, onBack, onAnotherName, onAnotherNiche, onLaunch }: Props) {
  const p = preview;
  // Real check: the generated store config goes through the same validator every live store must pass.
  const check = useMemo(() => validateStoreConfig(p.store), [p.store]);
  const stages = [
    { label: 'Brand', detail: `${p.brand.name}: “${p.brand.tagline}”` },
    { label: 'Products', detail: `${p.products.length} products and the ${p.bundle.title}` },
    { label: 'Store', detail: check.ok ? 'Store settings passed every validation check' : `Store settings failed ${check.errors.length} checks` },
    { label: 'Pricing', detail: `${money(p.pricing.lowMinor)}–${money(p.pricing.highMinor)}, launch price ${money(p.pricing.launchPriceMinor)}` },
    { label: 'Marketing', detail: `${p.marketing.pins.length} Pinterest pins drafted for your approval` },
  ];
  const [done, setDone] = useState(0);
  const complete = done >= stages.length;

  useEffect(() => {
    const finish = () => track('preview_complete', { model: p.model.id, niche: p.niche.id });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDone(stages.length);
      finish();
      return;
    }
    let i = 0;
    let timer = 0;
    const tick = () => {
      i += 1;
      setDone(i);
      if (i < stages.length) timer = window.setTimeout(tick, STAGE_MS);
      else finish();
    };
    timer = window.setTimeout(tick, STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [p.model.id, p.niche.id, stages.length]);

  // Regenerating remounts this step, which drops focus from the button that was pressed; put it on the new heading.
  useEffect(() => {
    if (complete && (document.activeElement === document.body || document.activeElement === null)) headingRef.current?.focus({ preventScroll: true });
  }, [complete, headingRef]);

  const vars = storeVars(p.store);
  const featured = p.store.products.filter((x) => x.featured).slice(0, 3);

  return (
    <section className="bp-step-body" aria-labelledby="bp-preview-h">
      <button type="button" className="bp-back" onClick={onBack}><IconArrowLeft size={18} /> Back to choices</button>

      <p className="bp-note" role="note"><IconInfo size={18} /><span>{p.label}</span></p>

      <div className="bp-brand">
        <h1 id="bp-preview-h" ref={headingRef} tabIndex={-1}>{complete ? p.brand.name : 'Putting your preview together'}</h1>
        {complete ? (
          <>
            <p className="bp-brand-tagline">{p.brand.tagline}</p>
            <p className="bp-brand-meta">{p.niche.label} · {p.model.title}</p>
          </>
        ) : <p className="bp-lead">Using the {p.niche.label.toLowerCase()} blueprint for {p.model.title.toLowerCase()}.</p>}
      </div>

      {!complete ? (
        <ol className="bp-checklist" aria-live="polite">
          {stages.map((s, i) => (
            <li key={s.label} className={i < done ? 'is-done' : i === done ? 'is-active' : ''}>
              <span className="bp-check-icon">{i < done ? <IconCheck size={18} /> : <IconCircle size={18} />}</span>
              <span className="bp-check-label">{s.label}</span>
              <span className="bp-check-detail">{i < done ? s.detail : i === done ? 'Working…' : ''}</span>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <div className="bp-intro">
            <p className="bp-offer">{p.offer.summary}</p>
            <ul className="bp-assembled" aria-label="What was assembled">
              {stages.map((s) => <li key={s.label}><IconCheck size={14} /> {s.label}</li>)}
            </ul>
            <div className="bp-actions">
              <button type="button" className="amp-btn amp-btn-primary" onClick={onLaunch}>Save &amp; Launch My Business <IconArrowRight size={18} /></button>
              <button type="button" className="amp-btn amp-btn-secondary" onClick={onAnotherName}><IconRefresh size={18} /> Try another name</button>
              <button type="button" className="amp-btn amp-btn-secondary" onClick={onAnotherNiche}>Try another niche</button>
            </div>
          </div>

          <section className="bp-section" aria-labelledby="bp-products-h">
            <h2 id="bp-products-h">Products</h2>
            <p className="bp-section-lead">Each one is a real file the product engine can make and check. Prices are in AUD incl. GST.</p>
            <div className="st bp-st" style={vars}>
              <ul className="bp-products">
                {p.products.map((x) => (
                  <li key={x.slug} className="st-card bp-product">
                    <Cover style={x.cover.style} label={x.cover.label} />
                    <div className="st-card-body">
                      <span className="st-card-meta">{x.format}{x.pages ? ` · ${x.pages} ${x.pages === 1 ? 'page' : 'pages'}` : ''}</span>
                      <h3 className="st-card-title">{x.title}</h3>
                      <p className="bp-product-summary">{x.summary}</p>
                      <ul className="bp-includes">{x.includes.slice(0, 3).map((inc) => <li key={inc}>{inc}</li>)}</ul>
                      <Price minor={x.priceMinor} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="bp-bundle">
                <div>
                  <h3>{p.bundle.title}</h3>
                  <p className="bp-bundle-items">{p.bundle.productTitles.join(' + ')}</p>
                </div>
                <div className="bp-bundle-price">
                  <Price minor={p.bundle.priceMinor} compareAt={p.bundle.itemsTotalMinor} />
                  <span className="bp-small">Saves buyers {money(p.bundle.savingMinor)}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="bp-section" aria-labelledby="bp-site-h">
            <h2 id="bp-site-h">Website</h2>
            <p className="bp-section-lead">Your storefront, rendered from the same store settings a live store uses. Checkout stays off until you connect payments.</p>
            <div className="bp-browser">
              <div className="bp-browser-bar" aria-hidden="true">
                <span className="bp-browser-dots"><i /><i /><i /></span>
                <span className="bp-browser-url">{p.store.slug} · draft</span>
              </div>
              <div className="st bp-site" style={vars}>
                <div className="bp-site-head">
                  <span className="st-logo">{p.store.brand.name}</span>
                  <span className="bp-site-nav" aria-hidden="true"><span>Shop</span><span>FAQ</span><span>Contact</span></span>
                </div>
                <div className="bp-site-hero">
                  <div>
                    <p className="bp-site-h">{p.store.hero.heading}</p>
                    <p className="bp-site-sub">{p.store.hero.subheading}</p>
                    <span className="st-btn st-btn-primary bp-site-cta">{p.store.hero.ctaLabel}</span>
                  </div>
                  <div className="bp-site-art"><Cover style={featured[0].cover.style} label={featured[0].cover.label} large /></div>
                </div>
                <div className="bp-site-grid">
                  {featured.map((x) => (
                    <div key={x.slug} className="bp-site-item">
                      <Cover style={x.cover.style} label={x.cover.label} />
                      <span className="bp-site-item-title">{x.title}</span>
                      <Price minor={x.priceMinor} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="bp-section" aria-labelledby="bp-pricing-h">
            <h2 id="bp-pricing-h">Pricing direction</h2>
            <dl className="bp-stats">
              <div><dt>Price range</dt><dd>{money(p.pricing.lowMinor)}–{money(p.pricing.highMinor)}</dd></div>
              <div><dt>Suggested launch price</dt><dd>{money(p.pricing.launchPriceMinor)}</dd></div>
              <div><dt>Bundle saving for buyers</dt><dd>{money(p.pricing.bundleSavingMinor)}</dd></div>
            </dl>
            <p className="bp-body">{p.pricing.rationale}</p>
            <p className="bp-small bp-muted">{p.pricing.feeNote} These are starting prices to test, not a forecast of sales.</p>
            <h3 className="bp-calc-h">Profit calculator</h3>
            <ProfitCalculator launchPriceMinor={p.pricing.launchPriceMinor} />
          </section>

          <section className="bp-section" aria-labelledby="bp-pins-h">
            <h2 id="bp-pins-h">Marketing: Pinterest pins</h2>
            <p className="bp-section-lead">Three pins drafted for the boards your buyers search. Nothing is posted until you approve it.</p>
            <ul className="st bp-pins" style={vars}>
              {p.marketing.pins.map((pin) => (
                <li key={pin.title} className="bp-pin-item">
                  <div className="bp-pin">
                    <Cover style={pin.cover.style} label={pin.cover.label} />
                    <div className="bp-pin-caption">
                      <span className="bp-pin-title">{pin.title}</span>
                      <span className="bp-pin-brand">{p.brand.name}</span>
                    </div>
                  </div>
                  <p className="bp-pin-board">Board: {pin.board}</p>
                  <p className="bp-pin-desc">{pin.description}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className="bp-actionbar bp-actionbar-end">
            <p className="bp-actionbar-text"><strong>Like where this is going?</strong><span className="bp-muted"> See plans, connections and approvals next.</span></p>
            <button type="button" className="amp-btn amp-btn-primary" onClick={onLaunch}>Save &amp; Launch My Business <IconArrowRight size={18} /></button>
          </div>
        </>
      )}
    </section>
  );
}
