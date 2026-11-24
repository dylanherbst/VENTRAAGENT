// Blueprint preview generator (website plan §02). Pure and deterministic: the same model, niche and seed always give
// the same preview. It assembles real, usable content from a tested blueprint; AI personalisation replaces it after signup.
import type { BusinessModel } from '../contracts.ts';
import type { StoreConfig, StoreProduct } from '../storefront/schema.ts';
import { findNiche, getBlueprint, type NicheVariant } from './blueprints.ts';

export const previewLabel = 'Sample preview from a tested blueprint — AI-personalised generation unlocks after signup';

/** Stripe's standard Australian domestic card rate. International and premium cards cost more. */
export const cardFee = { percent: 1.65, fixedMinor: 30 } as const;
export const cardFeeMinor = (saleMinor: number): number => Math.round((saleMinor * cardFee.percent) / 100) + cardFee.fixedMinor;

export interface PreviewInput { model: BusinessModel; niche: string; seed?: number }

export interface PinAsset {
  title: string;
  description: string;
  board: string;
  cover: StoreProduct['cover'];
  productTitle: string;
}

export interface Preview {
  source: 'blueprint';
  label: string;
  model: { id: BusinessModel; title: string };
  niche: { id: string; label: string; audience: string };
  seed: number;
  brand: { name: string; tagline: string };
  offer: { summary: string };
  products: StoreProduct[];
  bundle: { slug: string; title: string; summary: string; productTitles: string[]; priceMinor: number; itemsTotalMinor: number; savingMinor: number };
  store: StoreConfig;
  pricing: {
    lowMinor: number;
    highMinor: number;
    launchPriceMinor: number;
    bundleSavingMinor: number;
    feeExample: { saleMinor: number; feeMinor: number; afterFeeMinor: number };
    feeNote: string;
    rationale: string;
  };
  marketing: { channel: 'Pinterest'; pins: PinAsset[] };
}

/** A$15 or A$15.50: whole dollars drop the cents. */
export const money = (minor: number): string => `A$${minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2)}`;
const listJoin = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function slugify(text: string): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return s.length >= 3 ? s : `${s}-shop`.replace(/^-/, '');
}

const normaliseSeed = (seed: number | undefined): number => (Number.isInteger(seed) && (seed as number) >= 0 ? (seed as number) : 0);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function storeProducts(niche: NicheVariant): StoreProduct[] {
  return niche.products.map((p, i) => ({
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    description: [p.detail],
    priceMinor: p.priceMinor,
    format: p.format,
    ...(p.pages ? { pages: p.pages } : {}),
    includes: [...p.includes],
    tags: [...niche.tags],
    featured: i < 3,
    cover: { ...p.cover },
  }));
}

export function generatePreview({ model, niche: nicheId, seed }: PreviewInput): Preview {
  const blueprint = getBlueprint(model);
  const niche = findNiche(model, nicheId);
  if (!niche) throw new Error(`Unknown niche "${nicheId}" for ${model}`);
  const s = normaliseSeed(seed);
  const name = niche.names[s % niche.names.length];
  const slug = slugify(name);
  const products = storeProducts(niche);
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const bundleItems = niche.bundle.productSlugs.map((x) => bySlug.get(x)).filter((p): p is StoreProduct => Boolean(p));
  const itemsTotalMinor = bundleItems.reduce((sum, p) => sum + p.priceMinor, 0);
  const bundle = {
    slug: niche.bundle.slug, title: niche.bundle.title, summary: niche.bundle.summary,
    productTitles: bundleItems.map((p) => p.title), priceMinor: niche.bundle.priceMinor,
    itemsTotalMinor, savingMinor: itemsTotalMinor - niche.bundle.priceMinor,
  };

  const prices = products.map((p) => p.priceMinor);
  const launchPriceMinor = median(prices);
  const feeMinor = cardFeeMinor(launchPriceMinor);

  const formats = listJoin([...new Set(products.map((p) => p.format))]);
  const audience = niche.audience.charAt(0).toLowerCase() + niche.audience.slice(1);
  const offerSummary = `${products.length} products for ${audience}, from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}, plus the ${bundle.title} at ${money(bundle.priceMinor)}. Formats: ${formats}, sold as instant downloads.`;

  const faq = [
    { question: 'Will I receive a physical product?', answer: 'No. These are digital files. You download them straight after payment and print or edit them yourself.' },
    { question: 'How do I get my files?', answer: 'After payment you go to a secure download page and we email you the link. If a link expires, ask and we will send a new one.' },
    ...blueprint.faq,
    { question: 'What if a file does not work?', answer: 'Email us. If a file is faulty or not as described, we will fix it or refund you.' },
  ];

  const store: StoreConfig = {
    version: 1,
    slug,
    status: 'draft',
    demo: true,
    brand: { name, tagline: niche.tagline, theme: 'pearl', font: niche.font },
    hero: { eyebrow: niche.label, heading: niche.heroHeading, subheading: niche.heroSubheading, ctaLabel: niche.ctaLabel },
    sections: ['featured', 'bundles', 'catalogue', 'trust', 'faq'],
    products,
    bundles: [{ slug: niche.bundle.slug, title: niche.bundle.title, summary: niche.bundle.summary, productSlugs: [...niche.bundle.productSlugs], priceMinor: niche.bundle.priceMinor }],
    faq,
    trust: [
      { title: 'Instant download', body: 'Files arrive on the receipt page and by email as soon as payment is confirmed.' },
      { title: 'Checked before listing', body: 'Every file is opened, printed or edited in a test run before it goes on sale.' },
      { title: 'Real help', body: 'Questions about a file? Email us and a person replies within two business days.' },
    ],
    policies: {
      refund: [
        'Because these are digital downloads, we do not offer refunds for change of mind once a file has been downloaded.',
        'This does not limit your rights under the Australian Consumer Law. If a file is faulty, significantly different from its description or unusable, contact us and we will replace it or refund you.',
      ],
      privacy: [
        'We collect your name, email and order details to deliver your files and provide support. Payments are processed by Stripe; we never see your full card number.',
        'We only send marketing emails if you opt in, and you can unsubscribe at any time.',
      ],
      terms: [
        'All products are digital files licensed for personal use unless the product says otherwise.',
        'Prices are in Australian dollars and include GST where applicable.',
      ],
    },
    contact: { email: 'owner@example.com', responseTime: 'within 2 business days', businessName: `${name} (sample)` },
    merchant: { chargesEnabled: false },
    seo: { title: `${name} · ${niche.label}`.slice(0, 70), description: `${niche.tagline}. Instant digital download.`.slice(0, 160) },
  };

  const pins: PinAsset[] = niche.pins.map((pin) => {
    const product = bySlug.get(pin.productSlug) ?? products[0];
    return { title: pin.title, description: pin.description, board: pin.board, cover: { ...product.cover }, productTitle: product.title };
  });

  return {
    source: 'blueprint',
    label: previewLabel,
    model: { id: model, title: blueprint.title },
    niche: { id: niche.id, label: niche.label, audience: niche.audience },
    seed: s,
    brand: { name, tagline: niche.tagline },
    offer: { summary: offerSummary },
    products,
    bundle,
    store,
    pricing: {
      lowMinor: Math.min(...prices),
      highMinor: Math.max(...prices),
      launchPriceMinor,
      bundleSavingMinor: bundle.savingMinor,
      feeExample: { saleMinor: launchPriceMinor, feeMinor, afterFeeMinor: launchPriceMinor - feeMinor },
      feeNote: `Card fees of about ${cardFee.percent}% + 30c are paid per sale for standard Australian cards (international cards cost more). On each ${money(launchPriceMinor)} sale that is about ${money(feeMinor)}, before your plan, GST and income tax.`,
      rationale: niche.pricingRationale,
    },
    marketing: { channel: 'Pinterest', pins },
  };
}
