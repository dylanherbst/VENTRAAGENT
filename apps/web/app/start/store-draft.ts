// Builds the first draft of a customer's store from what they have already approved: the approved brand (through the
// branding adapter) and the approved catalogue listings (through the catalogue adapter). Pure; tested in
// test/aimp-glass-journey.test.ts. The lib has no composer for this yet, so the sample trust points, FAQ and policies
// are taken from the DEMO store and the config is marked `demo: true`: it shows a DEMO banner, is never indexed and can
// never take payment (validateStoreConfig enforces that).
import type { StorefrontBrand } from '../../lib/aimp/branding/adapters.ts';
import { toStoreProduct } from '../../lib/aimp/catalogue/storefront.ts';
import type { PublicListing } from '../../lib/aimp/catalogue/types.ts';
import { demoStore } from '../../lib/aimp/storefront/demo-store.ts';
import type { CoverStyle, StoreConfig, StoreProduct } from '../../lib/aimp/storefront/schema.ts';

export const SAMPLE_CONTACT_EMAIL = 'hello@example.com';

export interface ListingExtras { pages?: number; includes: string[] }
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function storeProductsFrom(listings: readonly PublicListing[], coverStyle: CoverStyle, extras: Readonly<Record<string, ListingExtras | undefined>>): StoreProduct[] {
  const seen = new Set<string>();
  return listings.map((l, i) => {
    const x = extras[l.productId];
    const includes = (x?.includes ?? []).map((t) => clip(t.replace(/[<>]/g, ''), 120)).filter(Boolean).slice(0, 12);
    const p = toStoreProduct(l, { coverStyle, featured: i === 0, ...(x?.pages ? { pages: x.pages } : {}), includes: includes.length ? includes : ['Instant digital download'] });
    // Two listings with the same title would share a slug; the store schema refuses duplicates, so number the later ones.
    let slug = p.slug;
    for (let n = 2; seen.has(slug); n += 1) slug = `${p.slug}-${n}`;
    seen.add(slug);
    return { ...p, slug, summary: clip(p.summary, 160), cover: { style: p.cover.style, label: clip(p.cover.label, 28) } };
  });
}

export function buildStoreDraft(brand: StorefrontBrand, products: StoreProduct[]): StoreConfig {
  return {
    version: 1,
    slug: brand.slug,
    status: 'draft',
    demo: true,
    brand: { ...brand.brand },
    hero: { ...brand.hero },
    sections: ['featured', 'catalogue', 'trust', 'faq'],
    products,
    bundles: [],
    faq: structuredClone(demoStore.faq),
    trust: structuredClone(demoStore.trust),
    policies: structuredClone(demoStore.policies),
    contact: { email: SAMPLE_CONTACT_EMAIL, responseTime: 'within 2 business days', businessName: brand.contact.businessName },
    merchant: { chargesEnabled: false },
    seo: { ...brand.seo },
  };
}
