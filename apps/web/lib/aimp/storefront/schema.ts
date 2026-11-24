// AiMoneyPrinter storefront config (plan §D01/§D02). AI produces a validated config like this, never executable code.
// The renderer only reads fields that pass validateStoreConfig; anything else is rejected before it reaches a page.
import { templateIds, templateById, resolvePalette, checkLogo } from './templates.ts';

export const storeThemes = {
  pearl: { bg: '#fbfaf8', surface: '#ffffff', ink: '#1d1b26', muted: '#6b6878', line: '#e9e6ef', accent: '#6d4fd8', accentInk: '#ffffff', soft: '#efeafc' },
  sage: { bg: '#f7f8f4', surface: '#ffffff', ink: '#1f2a22', muted: '#5f6b62', line: '#e2e7df', accent: '#3f7a57', accentInk: '#ffffff', soft: '#e6f0e8' },
  blush: { bg: '#fdf8f6', surface: '#ffffff', ink: '#2b1f22', muted: '#7a6669', line: '#f0e3e0', accent: '#c4566a', accentInk: '#ffffff', soft: '#fbe9ec' },
  ink: { bg: '#121117', surface: '#1b1a22', ink: '#f4f2f8', muted: '#a9a5b6', line: '#2d2b36', accent: '#c7b6ff', accentInk: '#16131f', soft: '#262236' },
} as const;
export type StoreThemeName = keyof typeof storeThemes;
export type StoreTheme = (typeof storeThemes)[StoreThemeName];

export const storeFonts = ['serif', 'sans', 'rounded'] as const;
export type StoreFont = (typeof storeFonts)[number];
export const storeSections = ['featured', 'catalogue', 'bundles', 'trust', 'faq', 'newsletter'] as const;
export type StoreSection = (typeof storeSections)[number];
export const productFormats = ['PDF', 'PNG', 'JPG', 'XLSX', 'ZIP', 'Google Sheets', 'Canva link'] as const;
export type ProductFormat = (typeof productFormats)[number];
export const coverStyles = ['grid', 'lines', 'dots', 'arch'] as const;
export type CoverStyle = (typeof coverStyles)[number];

export interface StoreProduct {
  slug: string;
  /** AMP-104: the product this store product was published from. Optional: older snapshots and demo stores have none. Never shown to buyers. */
  productId?: string;
  title: string;
  summary: string;
  description: string[];
  priceMinor: number;
  compareAtMinor?: number;
  format: ProductFormat;
  pages?: number;
  includes: string[];
  tags: string[];
  featured: boolean;
  cover: { style: CoverStyle; label: string };
}
export interface StoreBundle { slug: string; title: string; summary: string; productSlugs: string[]; priceMinor: number }
export interface StoreConfig {
  version: 1;
  slug: string;
  status: 'draft' | 'published';
  /** True for sample stores. Rendered with a visible DEMO banner and never indexed. */
  demo: boolean;
  brand: { name: string; tagline: string; theme: StoreThemeName; font: StoreFont; /** Optional look from templates.ts. Unset = the plain theme. */ template?: string; /** Optional #rrggbb accent that replaces the template's. */ accent?: string; /** Optional small PNG/JPEG/WebP data URL. */ logo?: string };
  hero: { eyebrow: string; heading: string; subheading: string; ctaLabel: string };
  sections: StoreSection[];
  products: StoreProduct[];
  bundles: StoreBundle[];
  faq: { question: string; answer: string }[];
  trust: { title: string; body: string }[];
  policies: { refund: string[]; privacy: string[]; terms: string[] };
  contact: { email: string; responseTime: string; businessName: string; abn?: string };
  /** Mirrors the Stripe merchant state. No live buy button unless charges are enabled (plan §D03). */
  merchant: { chargesEnabled: boolean };
  seo: { title: string; description: string };
}

export type ValidationResult = { ok: true; config: StoreConfig } | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/;
// Store address (sites.slug) follows the database rule: 3-42 chars, ^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$ (we also refuse double hyphens).
export const STORE_SLUG_MAX = 42;
export const STORE_SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,40}[a-z0-9]$/;
export const STORE_SLUG_MESSAGE = `3-${STORE_SLUG_MAX} lowercase letters, digits or single hyphens`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ABN = /^\d{2} ?\d{3} ?\d{3} ?\d{3}$/;
const MAX_PRICE_MINOR = 100_000_00;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate untrusted (e.g. AI-generated) config. Returns every problem found, with a path, rather than the first. */
export function validateStoreConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const text = (v: unknown, path: string, max: number, min = 1): v is string => {
    if (typeof v !== 'string' || v.trim().length < min || v.length > max) { errors.push(`${path}: text ${min}-${max} chars`); return false; }
    if (/[<>]/.test(v)) { errors.push(`${path}: angle brackets are not allowed`); return false; }
    return true;
  };
  const textList = (v: unknown, path: string, maxItems: number, maxLen: number, minItems = 0) => {
    if (!Array.isArray(v) || v.length < minItems || v.length > maxItems) { errors.push(`${path}: list of ${minItems}-${maxItems}`); return; }
    v.forEach((item, i) => text(item, `${path}[${i}]`, maxLen));
  };
  const oneOf = <T extends string>(v: unknown, path: string, options: readonly T[]): v is T => {
    if (typeof v !== 'string' || !options.includes(v as T)) { errors.push(`${path}: one of ${options.join(', ')}`); return false; }
    return true;
  };
  const price = (v: unknown, path: string) => {
    if (!Number.isInteger(v) || (v as number) < 100 || (v as number) > MAX_PRICE_MINOR) errors.push(`${path}: whole cents between 100 and ${MAX_PRICE_MINOR}`);
  };

  if (!isObj(input)) return { ok: false, errors: ['config: must be an object'] };
  const c = input;
  if (c.version !== 1) errors.push('version: must be 1');
  if (typeof c.slug !== 'string' || !STORE_SLUG.test(c.slug)) errors.push(`slug: ${STORE_SLUG_MESSAGE}`);
  oneOf(c.status, 'status', ['draft', 'published'] as const);
  if (typeof c.demo !== 'boolean') errors.push('demo: boolean');

  if (!isObj(c.brand)) errors.push('brand: object'); else {
    text(c.brand.name, 'brand.name', 60); text(c.brand.tagline, 'brand.tagline', 120);
    oneOf(c.brand.theme, 'brand.theme', Object.keys(storeThemes) as StoreThemeName[]); oneOf(c.brand.font, 'brand.font', storeFonts);
    if (c.brand.template !== undefined) oneOf(c.brand.template, 'brand.template', templateIds);
    if (c.brand.accent !== undefined) { const t = templateById(c.brand.template ?? 'clean-launch')!; const r = resolvePalette(t, String(c.brand.accent)); if (!r.ok) errors.push(`brand.accent: ${r.message}`); }
    if (c.brand.logo !== undefined) { const r = checkLogo(c.brand.logo); if (!r.ok) errors.push(`brand.logo: ${r.message}`); }
  }
  if (!isObj(c.hero)) errors.push('hero: object'); else {
    text(c.hero.eyebrow, 'hero.eyebrow', 60); text(c.hero.heading, 'hero.heading', 90);
    text(c.hero.subheading, 'hero.subheading', 220); text(c.hero.ctaLabel, 'hero.ctaLabel', 30);
  }
  if (!Array.isArray(c.sections) || c.sections.length > storeSections.length) errors.push('sections: list');
  else {
    c.sections.forEach((s, i) => oneOf(s, `sections[${i}]`, storeSections));
    if (new Set(c.sections).size !== c.sections.length) errors.push('sections: duplicates');
  }

  const productSlugs = new Map<string, number>();
  if (!Array.isArray(c.products) || c.products.length < 1 || c.products.length > 60) errors.push('products: 1-60 items');
  else c.products.forEach((p, i) => {
    const at = `products[${i}]`;
    if (!isObj(p)) { errors.push(`${at}: object`); return; }
    if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) errors.push(`${at}.slug: invalid`);
    else if (productSlugs.has(p.slug)) errors.push(`${at}.slug: duplicate`);
    else productSlugs.set(p.slug, typeof p.priceMinor === 'number' ? p.priceMinor : 0);
    if (p.productId !== undefined && (typeof p.productId !== 'string' || p.productId.length < 1 || p.productId.length > 120)) errors.push(`${at}.productId: 1-120 characters`);
    text(p.title, `${at}.title`, 80); text(p.summary, `${at}.summary`, 160);
    textList(p.description, `${at}.description`, 6, 600, 1);
    price(p.priceMinor, `${at}.priceMinor`);
    if (p.compareAtMinor !== undefined) {
      price(p.compareAtMinor, `${at}.compareAtMinor`);
      if (typeof p.compareAtMinor === 'number' && typeof p.priceMinor === 'number' && p.compareAtMinor <= p.priceMinor) errors.push(`${at}.compareAtMinor: must exceed price`);
    }
    oneOf(p.format, `${at}.format`, productFormats);
    if (p.pages !== undefined && (!Number.isInteger(p.pages) || (p.pages as number) < 1 || (p.pages as number) > 1000)) errors.push(`${at}.pages: 1-1000`);
    textList(p.includes, `${at}.includes`, 12, 120, 1); textList(p.tags, `${at}.tags`, 8, 30);
    if (typeof p.featured !== 'boolean') errors.push(`${at}.featured: boolean`);
    if (!isObj(p.cover)) errors.push(`${at}.cover: object`);
    else { oneOf(p.cover.style, `${at}.cover.style`, coverStyles); text(p.cover.label, `${at}.cover.label`, 28); }
  });

  if (!Array.isArray(c.bundles) || c.bundles.length > 10) errors.push('bundles: 0-10 items');
  else c.bundles.forEach((b, i) => {
    const at = `bundles[${i}]`;
    if (!isObj(b)) { errors.push(`${at}: object`); return; }
    if (typeof b.slug !== 'string' || !SLUG.test(b.slug) || productSlugs.has(b.slug)) errors.push(`${at}.slug: invalid or clashes with a product`);
    text(b.title, `${at}.title`, 80); text(b.summary, `${at}.summary`, 160); price(b.priceMinor, `${at}.priceMinor`);
    if (!Array.isArray(b.productSlugs) || b.productSlugs.length < 2) { errors.push(`${at}.productSlugs: at least 2`); return; }
    let sum = 0;
    for (const s of b.productSlugs) {
      if (typeof s !== 'string' || !productSlugs.has(s)) errors.push(`${at}.productSlugs: unknown product ${String(s)}`);
      else sum += productSlugs.get(s) ?? 0;
    }
    if (typeof b.priceMinor === 'number' && sum > 0 && b.priceMinor >= sum) errors.push(`${at}.priceMinor: must be below the items' total`);
  });

  if (!Array.isArray(c.faq) || c.faq.length > 12) errors.push('faq: 0-12 items');
  else c.faq.forEach((f, i) => { if (!isObj(f)) errors.push(`faq[${i}]: object`); else { text(f.question, `faq[${i}].question`, 140); text(f.answer, `faq[${i}].answer`, 600); } });
  if (!Array.isArray(c.trust) || c.trust.length > 4) errors.push('trust: 0-4 items');
  else c.trust.forEach((t, i) => { if (!isObj(t)) errors.push(`trust[${i}]: object`); else { text(t.title, `trust[${i}].title`, 40); text(t.body, `trust[${i}].body`, 160); } });

  if (!isObj(c.policies)) errors.push('policies: object'); else {
    textList(c.policies.refund, 'policies.refund', 12, 800, 1); textList(c.policies.privacy, 'policies.privacy', 12, 800, 1);
    textList(c.policies.terms, 'policies.terms', 12, 800, 1);
  }
  if (!isObj(c.contact)) errors.push('contact: object'); else {
    if (typeof c.contact.email !== 'string' || !EMAIL.test(c.contact.email) || c.contact.email.length > 120) errors.push('contact.email: valid email');
    text(c.contact.responseTime, 'contact.responseTime', 60); text(c.contact.businessName, 'contact.businessName', 120);
    if (c.contact.abn !== undefined && (typeof c.contact.abn !== 'string' || !ABN.test(c.contact.abn))) errors.push('contact.abn: 11 digits');
  }
  if (!isObj(c.merchant) || typeof c.merchant.chargesEnabled !== 'boolean') errors.push('merchant.chargesEnabled: boolean');
  if (!isObj(c.seo)) errors.push('seo: object'); else { text(c.seo.title, 'seo.title', 70); text(c.seo.description, 'seo.description', 160); }
  if (c.demo === true && c.merchant !== undefined && isObj(c.merchant) && c.merchant.chargesEnabled === true) errors.push('merchant.chargesEnabled: demo stores can never take payment');

  return errors.length ? { ok: false, errors } : { ok: true, config: input as unknown as StoreConfig };
}
