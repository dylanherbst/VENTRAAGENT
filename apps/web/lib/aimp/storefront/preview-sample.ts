// The words and products a template preview shows, taken from the store's own draft. Plain data, no React, so tests can load it.
import type { StoreConfig } from './schema.ts';

export interface LookSample {
  name: string; eyebrow: string; heading: string; subheading: string; cta: string;
  products: { title: string; price: string; cover: string }[];
  hero: { title: string; price: string; what: string }; trust: { title: string; body: string }[]; faq: string[];
}

export function sampleFrom(c: StoreConfig): LookSample {
  return {
    name: c.brand.name, eyebrow: c.hero.eyebrow, heading: c.hero.heading, subheading: c.hero.subheading, cta: c.hero.ctaLabel,
    products: c.products.slice(0, 5).map((p) => ({ title: p.title, price: `$${(p.priceMinor / 100).toFixed(2)}`, cover: p.cover.label })),
    hero: ((p) => ({ title: p?.title ?? '', price: p ? `$${(p.priceMinor / 100).toFixed(2)}` : '', what: p ? `${p.format}${p.pages ? `, ${p.pages} pages` : ''}` : '' }))(c.products.find((x) => x.featured) ?? c.products[0]),
    trust: c.trust.slice(0, 3).map((t) => ({ title: t.title, body: t.body })), faq: c.faq.slice(0, 2).map((f) => f.question),
  };
}
