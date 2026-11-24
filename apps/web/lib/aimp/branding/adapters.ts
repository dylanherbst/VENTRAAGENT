// Brand adapters (AMP-020): pure functions that turn one BrandProfile into what other parts read, so the store, product
// previews and marketing all show the same name, colours, tone and copy. They never write to storefront or product code.
import { storeThemes, type CoverStyle, type StoreConfig, type StoreFont, type StoreThemeName } from '../storefront/schema.ts';
import { meetsAA, normaliseHex } from './contrast.ts';
import { clip } from './generate.ts';
import type { BrandPalette, BrandProfile, BrandTone } from './types.ts';

/** Thrown when a draft or superseded brand is passed to an adapter: only the approved brand may reach the store or marketing. */
export class BrandNotApprovedError extends Error {
  constructor(status: string) { super(`Only an approved brand can be used for the store, product previews or marketing (this one is ${status}). Approve it first.`); this.name = 'BrandNotApprovedError'; }
}
function requireApproved(b: BrandProfile): void {
  if (b?.status !== 'approved') throw new BrandNotApprovedError(String(b?.status));
}

const channels = (hex: string): [number, number, number] => {
  const h = normaliseHex(hex) ?? '#000000';
  return [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
};
const dist = (a: string, b: string): number => { const x = channels(a), y = channels(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };

/** A built-in theme is safe to render only if its own text pairs reach WCAG AA: ink on bg and accentInk on accent. */
export function storeThemeIsAccessible(name: StoreThemeName): boolean {
  const t = storeThemes[name];
  return meetsAA(t.ink, t.bg) && meetsAA(t.accentInk, t.accent);
}

/**
 * The built-in storefront theme closest to the brand's background and accent, limited to themes that pass AA themselves
 * (blush does not: its button text is about 4.3:1). If none passed, the closest theme overall would be used.
 * The exact colours travel alongside in `palette`.
 */
export function nearestStoreTheme(p: BrandPalette): StoreThemeName {
  const all = Object.keys(storeThemes) as StoreThemeName[];
  const passing = all.filter(storeThemeIsAccessible);
  const pool = passing.length ? passing : all;
  let best: StoreThemeName = pool[0]!, bestScore = Number.POSITIVE_INFINITY;
  for (const name of pool) {
    const t = storeThemes[name];
    const score = dist(p.background, t.bg) * 2 + dist(p.accent, t.accent) + dist(p.primary, t.accent);
    if (score < bestScore) { best = name; bestScore = score; }
  }
  return best;
}

/** The brand parts of a StoreConfig. Spread these into a config; every field already satisfies validateStoreConfig. */
export interface StorefrontBrand {
  slug: StoreConfig['slug'];
  brand: StoreConfig['brand'];
  hero: StoreConfig['hero'];
  seo: StoreConfig['seo'];
  contact: Pick<StoreConfig['contact'], 'businessName'>;
  /** Exact approved colours, for renderers that can use them. The store schema itself only knows named themes. */
  palette: BrandPalette;
  brandId: string;
  brandVersion: number;
}

/** Throws BrandNotApprovedError unless the brand is approved. */
export function toStorefrontBrand(b: BrandProfile): StorefrontBrand {
  requireApproved(b);
  return {
    slug: b.slug,
    brand: { name: b.name, tagline: b.tagline, theme: nearestStoreTheme(b.palette), font: b.font },
    hero: {
      eyebrow: clip(`${b.input.niche} for ${b.input.audience}`, 60),
      heading: clip(b.tagline, 90),
      subheading: clip(b.shortDescription, 220),
      ctaLabel: 'Browse the shop',
    },
    seo: { title: clip(`${b.name} | ${b.tagline}`, 70), description: clip(b.shortDescription, 160) },
    contact: { businessName: b.name },
    palette: { ...b.palette },
    brandId: b.id,
    brandVersion: b.version,
  };
}

/** What product previews and marketing materials (covers, listings, social posts, emails) need. */
export interface ProductPreviewBrand {
  brandName: string;
  attribution: string;
  tagline: string;
  tone: BrandTone;
  fontStyle: StoreFont;
  colours: BrandPalette;
  cover: { style: CoverStyle; label: string; notes: string[] };
  listing: { shortDescription: string; longDescription: string };
  brandId: string;
  brandVersion: number;
}

/** Throws BrandNotApprovedError unless the brand is approved. */
export function toProductPreviewBrand(b: BrandProfile): ProductPreviewBrand {
  requireApproved(b);
  return {
    brandName: b.name,
    attribution: `By ${b.name}`,
    tagline: b.tagline,
    tone: b.tone,
    fontStyle: b.font,
    colours: { ...b.palette },
    cover: { style: b.visual.coverStyle, label: clip(b.name, 28), notes: [...b.visual.notes] },
    listing: { shortDescription: b.shortDescription, longDescription: b.longDescription },
    brandId: b.id,
    brandVersion: b.version,
  };
}
