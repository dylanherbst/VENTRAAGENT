// Deterministic template generator (AMP-051). No model and no network: the same plan item and attempt always give the same
// text. It only rearranges words the approved plan already contains (hook, description, call to action, price, themes), which
// the claim rules have already passed. A real model generator implements the same `AssetGenerator` and is validated the same way.
import type { CampaignContentItem, CampaignSeoTheme, LaunchCampaignPlan } from '../campaigns/types.ts';
import { LIMITS, PIN_IMAGE } from './types.ts';
import type { AssetGenerator, AssetKind, ContentByKind, GenerateInput } from './types.ts';

export const TEMPLATE_GENERATOR_ID = 'template-v1';

/** Cut at a word boundary so the text never exceeds `max` characters. */
export function fit(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** The plan theme for an item: round-robin by item order so the choice never depends on anything but the plan. */
export function themeFor(plan: LaunchCampaignPlan, item: CampaignContentItem): CampaignSeoTheme | null {
  if (plan.seoThemes.length === 0) return null;
  const idx = Math.max(0, plan.items.findIndex((i) => i.id === item.id));
  return plan.seoThemes[idx % plan.seoThemes.length] ?? null;
}

const pick = <T>(list: readonly T[], attempt: number): T => list[attempt % list.length] as T;
/** A keyword someone would type: no cut-off text and no word said twice in a row or twice overall. */
const goodKeyword = (k: string): boolean => {
  if (!k || k.includes('…')) return false;
  const w = k.toLowerCase().split(/\s+/);
  return new Set(w).size === w.length;
};
const keywordsFor = (item: CampaignContentItem, theme: CampaignSeoTheme | null): string[] => {
  const base = theme?.keywords ?? [item.productTitle.toLowerCase()];
  const all = [...new Set(base.map((k) => fit(k.trim(), LIMITS.keywordMax)))].filter(goodKeyword);
  return (all.length ? all : [fit(item.productTitle.toLowerCase(), LIMITS.keywordMax)]).slice(0, LIMITS.keywordsMax);
};
const sentence = (t: string): string => { const x = t.trim(); return /[.!?…]$/.test(x) ? x : `${x}.`; };
/** Join sentences without saying the same thing twice (same price, same words). */
const joinUnique = (parts: string[], price = ''): string => {
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    const low = p.toLowerCase();
    if (out.some((o) => o.toLowerCase().includes(low) || low.includes(o.toLowerCase()))) continue;
    if (price && low.includes(price.toLowerCase()) && out.some((o) => o.toLowerCase().includes(price.toLowerCase()))) continue;
    out.push(sentence(p));
  }
  return out.join(' ');
};
/** The few words printed on the Pin picture. Fixed per kind of post so it is never cut off. */
const overlayFor = (item: CampaignContentItem): string => {
  switch (item.pillarId) {
    case 'launch': return 'Now available';
    case 'problem': return 'Made for busy planners';
    case 'inside': return 'See what is inside';
    case 'how_to': return 'How to use it';
  }
};
const stripBrandPrefix = (hook: string, brand: string): string => hook.replace(new RegExp(`^New from ${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '');

function pin({ item, plan, theme, attempt }: GenerateInput<'pin'>): ContentByKind['pin'] {
  const brand = plan.brand.name;
  const hook = stripBrandPrefix(item.hook, brand);
  const title = item.pillarId === 'launch' ? pick([`${hook}: now available`, `${hook}, ${item.priceLabel}`], attempt) : pick([hook, `${hook} | ${brand}`], attempt);
  return {
    title: fit(title, LIMITS.pinTitle),
    description: fit(joinUnique([item.description, item.callToAction], item.priceLabel), LIMITS.pinDescription),
    altText: fit(`Cover of the ${item.productTitle} by ${brand}`, LIMITS.pinAltText),
    destinationUrl: item.targetUrl,
    board: fit(theme?.pinterestBoard ?? `${brand} ideas`, LIMITS.pinBoard),
    imageBrief: fit(`Vertical Pin showing the cover of ${item.productTitle}. Headline on the image: "${overlayFor(item)}". Style: ${plan.brand.tone}. ${item.angle}`, LIMITS.imageBrief),
    imageSpec: { width: PIN_IMAGE.width, height: PIN_IMAGE.height, aspect: PIN_IMAGE.aspect, fileName: `${item.id}.png`, textOverlay: overlayFor(item) },
    publishDate: item.scheduledDate,
    keywords: keywordsFor(item, theme),
  };
}

function caption({ item, plan, attempt }: GenerateInput<'caption'>): ContentByKind['caption'] {
  const hook = stripBrandPrefix(item.hook, plan.brand.name);
  const lead = sentence(attempt % 2 === 0 ? hook : `${item.productTitle}. ${hook}`);
  const variants = [
    `${lead}\n\n${joinUnique([item.description])}\n\n${sentence(item.callToAction)}`,
    joinUnique([`${item.productTitle} from ${plan.brand.name} is ${item.priceLabel}`, item.description, 'Link in bio'], item.priceLabel),
    joinUnique([hook, item.callToAction], item.priceLabel),
  ].map((v) => fit(v.replace(/[ \t]+/g, ' '), LIMITS.captionMax));
  return { variants, destinationUrl: item.targetUrl, publishDate: item.scheduledDate };
}

function videoScript({ item, plan, attempt }: GenerateInput<'video_script'>): ContentByKind['video_script'] {
  return {
    hook: fit(item.hook, LIMITS.videoHook),
    beats: [
      `Open on the cover of ${item.productTitle}. Say the hook out loud.`,
      fit(`Name the everyday problem: ${plan.audience.problem}`, LIMITS.videoBeat),
      fit(`Show what is inside: ${item.description}`, LIMITS.videoBeat),
      `Show the price on screen: ${item.priceLabel}.`,
    ],
    callToAction: fit(item.callToAction, LIMITS.videoCta),
    onScreenText: [fit(item.hook, LIMITS.onScreenLine), fit(item.productTitle, LIMITS.onScreenLine), fit(`${item.priceLabel} at ${plan.brand.name}`, LIMITS.onScreenLine)],
    targetLengthSeconds: pick([30, 25, 35], attempt),
    destinationUrl: item.targetUrl,
    publishDate: item.scheduledDate,
  };
}

function seo({ item, plan, theme, attempt }: GenerateInput<'seo'>): ContentByKind['seo'] {
  const title = pick([`${item.productTitle} | ${plan.brand.name}`, `${item.productTitle} by ${plan.brand.name}`], attempt);
  return {
    pageTitle: fit(title, LIMITS.seoTitle),
    metaDescription: fit(item.description, LIMITS.seoDescription),
    keywords: keywordsFor(item, theme),
    url: item.targetUrl,
  };
}

export function createTemplateGenerator(): AssetGenerator {
  return {
    id: TEMPLATE_GENERATOR_ID,
    async generate<K extends AssetKind>(input: GenerateInput<K>): Promise<ContentByKind[K]> {
      switch (input.kind) {
        case 'pin': return pin(input as GenerateInput<'pin'>) as ContentByKind[K];
        case 'caption': return caption(input as GenerateInput<'caption'>) as ContentByKind[K];
        case 'video_script': return videoScript(input as GenerateInput<'video_script'>) as ContentByKind[K];
        case 'seo': return seo(input as GenerateInput<'seo'>) as ContentByKind[K];
        default: throw new Error(`Unknown asset kind: ${String(input.kind)}`);
      }
    },
  };
}
