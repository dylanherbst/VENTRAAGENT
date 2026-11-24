// Launch campaign generator (AMP-050). `buildDeterministicCampaign` writes the whole plan from the approved brand and the
// approved catalogue with no model and no clock of its own (the caller passes `now`). `buildLaunchCampaign` can then ask the
// llm adapter for better copy; model output is merged onto the same plan, run through the SAME validator, and dropped in
// favour of the built-in plan if anything is wrong. A missing or unapproved brand, a store that is not live, or an empty
// catalogue gives a clear error result, never a throw.
import type { BrandProfile, BrandTone } from '../branding/types.ts';
import { formatAud } from '../catalogue/pricing.ts';
import { stableHash } from '../providers/fixtures.ts';
import type { LlmAdapter } from '../providers/types.ts';
import { brokenClaimRules } from './claims.ts';
import { productSlugFor, productUrlFor, sellableListings, storeIssues, storeOwnershipIssues } from './links.ts';
import type { SellableListing } from './links.ts';
import { addDays, DEFAULT_WINDOW_DAYS, isWindow, parseDay, scheduleFor, utcDay } from './schedule.ts';
import { PRIMARY_CHANNEL } from './types.ts';
import type {
  CampaignChannel, CampaignContentItem, CampaignContext, CampaignIssue, CampaignPillar, CampaignSeoTheme, ContentFormat, EnrichmentStatus,
  LaunchCampaignInput, LaunchCampaignPlan, LaunchCampaignResult, PillarId,
} from './types.ts';
import { BOARD_MAX, campaignBrandIssues, KEYWORD_MAX, MAX_KEYWORDS, MAX_SEO_THEMES, validateCampaignPlan } from './validate.ts';

/** Pinterest runs every day; the launch announcement comes first, then each product moves through the other pillars. */
const ROTATION: readonly PillarId[] = ['launch', 'problem', 'inside', 'how_to'];
/** Export-only extras: one every fourth day from day 2, alternating channel. */
const EXTRAS: readonly { channel: CampaignChannel; format: ContentFormat; pillar: PillarId }[] = [
  { channel: 'instagram', format: 'caption', pillar: 'inside' },
  { channel: 'tiktok', format: 'video_script', pillar: 'how_to' },
];
const TONE_VERB: Readonly<Record<BrandTone, string>> = { warm: 'Find', playful: 'Grab', calm: 'See', professional: 'View', bold: 'Get' };
const TONE_NOTE: Readonly<Record<BrandTone, string>> = {
  warm: 'Keep it warm and friendly.', playful: 'Keep it light and playful.', calm: 'Keep it calm and uncluttered.',
  professional: 'Keep it clear and professional.', bold: 'Keep it bold and direct.',
};

const scope = (i: Pick<LaunchCampaignInput, 'workspaceId' | 'businessId'>): CampaignIssue[] =>
  (typeof i?.workspaceId === 'string' && i.workspaceId.trim() && typeof i.businessId === 'string' && i.businessId.trim()
    ? [] : [{ field: 'workspaceId', code: 'scope', message: 'A workspace and a business are needed to plan a campaign.' }]);

export const contextOf = (i: LaunchCampaignInput): CampaignContext => ({ workspaceId: i.workspaceId, businessId: i.businessId, brand: i.brand, listings: i.listings ?? [], store: i.store });

function pillarsFor(b: BrandProfile): CampaignPillar[] {
  const who = b.input.audience.toLowerCase();
  const niche = b.input.niche.toLowerCase();
  return [
    { id: 'launch', title: 'Now available', summary: `Introduce ${b.name} and each product, with its price and a link to its page.` },
    { id: 'problem', title: 'The everyday problem', summary: `Show the moment ${who} get stuck with ${niche}, and the product as a tidy way through it.` },
    { id: 'inside', title: 'What is inside', summary: 'Show the pages and what each one is for, exactly as the listing describes them.' },
    { id: 'how_to', title: 'How to use it', summary: 'A short, practical walkthrough of using the product in an ordinary week.' },
  ];
}

const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max).trim());

/** Search themes: one for the niche and audience, then one per real listing title. Built-in only; the model never rewrites them. */
function seoThemesFor(b: BrandProfile, listings: readonly SellableListing[]): CampaignSeoTheme[] {
  const niche = b.input.niche.trim().toLowerCase();
  const who = b.input.audience.trim().toLowerCase();
  const uniq = (xs: string[]): string[] => [...new Set(xs.map((x) => clip(x.trim(), KEYWORD_MAX)).filter(Boolean))].slice(0, MAX_KEYWORDS);
  const themes: CampaignSeoTheme[] = [{
    theme: clip(`${niche} for ${who}`, 140),
    keywords: uniq([niche, `${niche} for ${who}`, `${niche} printable`, `${niche} pdf download`]),
    pinterestBoard: clip(`${niche} for ${who}`, BOARD_MAX),
  }];
  for (const l of listings.slice(0, MAX_SEO_THEMES - 1)) {
    const title = l.title.trim();
    themes.push({
      theme: clip(`${title}: ${niche} for ${who}`, 140),
      keywords: uniq([title.toLowerCase(), `${title.toLowerCase()} pdf`, ...(title.toLowerCase().includes(niche) ? [`${niche} checklist printable`] : [`${niche} ${title.toLowerCase()}`])]),
      // A board is a topic people follow, never a product name.
      pinterestBoard: clip(`${niche} printables`, BOARD_MAX),
    });
  }
  return themes;
}

/** Listing copy that passes the claim rules, or a plain line built from the title when the listing text does not. */
function summaryOf(l: SellableListing, brandName: string): string {
  const s = l.shortDescription.trim();
  return brokenClaimRules(s, l).length === 0 && !/[<>]/.test(s) ? s : `${l.title} from ${brandName}.`;
}

function copyFor(pillar: PillarId, l: SellableListing, b: BrandProfile, price: string): Pick<CampaignContentItem, 'angle' | 'hook' | 'description'> {
  const summary = summaryOf(l, b.name);
  const tone = TONE_NOTE[b.tone];
  switch (pillar) {
    case 'launch': return { hook: `New from ${b.name}: ${l.title}`, angle: `Announce the product with its cover, its name and its price. ${tone}`, description: `${summary} Available now for ${price}.` };
    case 'problem': return { hook: `${l.title} for ${b.input.audience.toLowerCase()}`, angle: `Open on an everyday ${b.input.niche.toLowerCase()} moment, then show the product as the simple way through it. ${tone}`, description: summary };
    case 'inside': return { hook: `A look inside the ${l.title}`, angle: `Show the cover and one or two pages, as the listing describes them. ${tone}`, description: `${summary} PDF download.` };
    case 'how_to': return { hook: `How to use the ${l.title}`, angle: `Walk through using the product step by step in an ordinary week. ${tone}`, description: `${summary} Download the PDF and start with the first page.` };
  }
}

type Built = { ok: true; plan: LaunchCampaignPlan } | { ok: false; errors: CampaignIssue[] };

/** The built-in plan. Same input (including the clock's answer) always gives the same plan. */
export function buildDeterministicCampaign(input: LaunchCampaignInput): Built {
  const pre: CampaignIssue[] = [...scope(input)];
  if (pre.length) return { ok: false, errors: pre };
  const ctx = contextOf(input);
  const brandIssues = campaignBrandIssues(ctx);
  pre.push(...brandIssues, ...storeIssues(input.store));
  if (!brandIssues.length) pre.push(...storeOwnershipIssues(ctx));
  if (typeof input.now !== 'function') pre.push({ field: 'now', code: 'invalid', message: 'A clock is needed to date the campaign.' });
  if (pre.length) return { ok: false, errors: pre };

  const now = input.now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { ok: false, errors: [{ field: 'now', code: 'invalid', message: 'The clock did not give a valid date.' }] };
  const startDate = input.startDate ?? utcDay(now);
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (parseDay(startDate) === null) return { ok: false, errors: [{ field: 'startDate', code: 'schedule', message: 'The start date must be a real date written as YYYY-MM-DD.' }] };
  if (!isWindow(windowDays)) return { ok: false, errors: [{ field: 'windowDays', code: 'schedule', message: 'The launch window must be a whole number of days from 1 to 60.' }] };

  const brand = input.brand!;
  const listings = sellableListings(ctx);
  if (listings.length === 0) return { ok: false, errors: [{ field: 'listings', code: 'no_listings', message: 'There is nothing to promote yet. Approve at least one listing with a cover first.' }] };
  const slugs = listings.map(productSlugFor);
  const clash = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (clash) return { ok: false, errors: [{ field: 'listings', code: 'listing_mismatch', message: `Two listings would share the product page "${clash}". Rename one of them so each campaign link leads to one product.` }] };

  const campaign = `launch-${startDate}`;
  const n = listings.length;
  const item = (day: number, l: SellableListing, channel: CampaignChannel, format: ContentFormat, pillarId: PillarId): CampaignContentItem => {
    const priceLabel = formatAud(l.priceMinor);
    return {
      id: `d${String(day).padStart(2, '0')}-${channel}`, listingId: l.listingId, listingVersion: l.version, productTitle: l.title,
      channel, format, exportOnly: channel !== PRIMARY_CHANNEL, pillarId, ...copyFor(pillarId, l, brand, priceLabel),
      callToAction: `${TONE_VERB[brand.tone]} it at ${brand.name} for ${priceLabel}`,
      targetUrl: productUrlFor(input.store, l), attribution: { source: channel, medium: 'organic', campaign },
      priceMinor: l.priceMinor, currency: l.currency, priceLabel, day, scheduledDate: addDays(startDate, day - 1),
    };
  };
  const items: CampaignContentItem[] = [];
  for (let day = 1; day <= windowDays; day++) {
    const i = (day - 1) % n;
    const round = Math.floor((day - 1) / n);
    items.push(item(day, listings[i]!, PRIMARY_CHANNEL, 'pin_image', ROTATION[(round + i) % ROTATION.length]!));
    if (day % 4 === 2) {
      const k = (day - 2) / 4;
      const x = EXTRAS[k % EXTRAS.length]!;
      items.push(item(day, listings[k % n]!, x.channel, x.format, x.pillar));
    }
  }

  const niche = brand.input.niche.toLowerCase();
  const plan: LaunchCampaignPlan = {
    workspaceId: input.workspaceId, businessId: input.businessId, store: { slug: input.store.slug },
    brand: { id: brand.id, version: brand.version, name: brand.name, tone: brand.tone },
    audience: {
      who: brand.input.audience,
      problem: `Keeping on top of ${niche} without a simple system to follow.`,
      whereTheyAre: [`Pinterest searches and boards about ${niche}`, `Instagram posts and saves about ${niche} (export only)`, `Short how-to videos about ${niche} on TikTok (export only)`],
    },
    primaryChannel: PRIMARY_CHANNEL,
    secondaryChannels: EXTRAS.filter((x) => items.some((it) => it.channel === x.channel)).map((x) => ({ channel: x.channel, mode: 'export_only' as const })),
    pillars: pillarsFor(brand), seoThemes: seoThemesFor(brand, listings), items, schedule: scheduleFor(startDate, windowDays, items),
    source: 'deterministic', generatedAt: now.toISOString(),
  };
  const errors = validateCampaignPlan(plan, ctx);
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

/** Item fields a model may rewrite: copy only. Links, listings and prices always come from the computed plan; anything else the model sends is ignored. */
export const MODEL_ITEM_FIELDS = ['hook', 'angle', 'description', 'callToAction'] as const;

export function campaignPrompt(plan: LaunchCampaignPlan): { system: string; prompt: string } {
  const system = [
    `You improve the wording of an organic launch campaign for the store "${plan.brand.name}". Tone: ${plan.brand.tone}.`,
    'Only say what each product listing says. Never promise income or results, never guarantee anything, make no medical or financial claims,',
    'no scarcity or deadlines, no reviews, ratings or customer numbers, no discounts, and never the word "free". Do not change any link or price.',
    'Answer with JSON only: {"items":[{"id":"...","hook":"...","description":"...","callToAction":"..."}]} using the ids given.',
  ].join(' ');
  const prompt = JSON.stringify({
    audience: plan.audience,
    items: plan.items.map((i) => ({ id: i.id, product: i.productTitle, channel: i.channel, format: i.format, pillar: i.pillarId, price: i.priceLabel, link: i.targetUrl, hook: i.hook, description: i.description, callToAction: i.callToAction })),
  });
  return { system, prompt };
}

/** Merge a model answer onto the plan. Returns null (with a reason) when the answer is not the JSON shape asked for. */
export function applyModelCopy(plan: LaunchCampaignPlan, answer: unknown): { plan: LaunchCampaignPlan } | { plan: null; reason: string } {
  if (typeof answer !== 'string') return { plan: null, reason: 'The model gave no text.' };
  const from = answer.indexOf('{');
  const to = answer.lastIndexOf('}');
  let parsed: unknown;
  try { parsed = from >= 0 && to > from ? JSON.parse(answer.slice(from, to + 1)) : undefined; } catch { parsed = undefined; }
  const rows = typeof parsed === 'object' && parsed !== null ? (parsed as { items?: unknown }).items : undefined;
  if (!Array.isArray(rows) || rows.length === 0) return { plan: null, reason: 'The model did not answer with the JSON that was asked for.' };
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return { plan: null, reason: 'The model sent an item that is not readable.' };
    const id = (r as Record<string, unknown>).id;
    if (typeof id !== 'string' || !plan.items.some((i) => i.id === id) || byId.has(id)) return { plan: null, reason: 'The model sent an item that is not in the plan.' };
    byId.set(id, r as Record<string, unknown>);
  }
  const items = plan.items.map((it) => {
    const r = byId.get(it.id);
    if (!r) return it;
    const next: Record<string, unknown> = { ...it };
    for (const k of MODEL_ITEM_FIELDS) if (Object.hasOwn(r, k)) next[k] = r[k];
    return next as unknown as CampaignContentItem;
  });
  return { plan: { ...plan, items, source: 'llm' } };
}

export interface CampaignLlmOptions {
  /** The llm provider adapter, or null/undefined for the built-in plan only. */
  llm?: LlmAdapter | null;
  /** Stable key for the model call (e.g. the job step's key). Defaults to one derived from the scope and the prompt. */
  idempotencyKey?: string;
}

/**
 * Plan the launch campaign for one business from its approved brand and approved listings.
 * With an llm adapter the copy may be improved, but only if the improved plan passes validation; otherwise the built-in
 * plan is returned and `enrichment` says why.
 */
export async function buildLaunchCampaign(input: LaunchCampaignInput, opts: CampaignLlmOptions = {}): Promise<LaunchCampaignResult> {
  const base = buildDeterministicCampaign(input);
  if (!base.ok) return base;
  if (!opts.llm) return { ok: true, plan: base.plan, enrichment: { status: 'not_requested' } };

  const fallback = (reason: string, issues: CampaignIssue[] = []): LaunchCampaignResult => ({ ok: true, plan: base.plan, enrichment: { status: 'fallback', reason, issues } });
  const { system, prompt } = campaignPrompt(base.plan);
  const key = opts.idempotencyKey?.trim() ? `${opts.idempotencyKey.trim()}:campaign-copy` : `aimp-campaign:${input.workspaceId}:${input.businessId}:${stableHash(`${system}|${prompt}|${base.plan.schedule.startDate}|${base.plan.schedule.windowDays}`)}`;
  let answer: Awaited<ReturnType<LlmAdapter['generate']>>;
  try { answer = await opts.llm.generate({ system, prompt, idempotencyKey: key }); } catch { return fallback('The model call failed.'); }
  const merged = applyModelCopy(base.plan, answer?.text);
  if (merged.plan === null) return fallback(merged.reason);
  const issues = validateCampaignPlan(merged.plan, contextOf(input));
  if (issues.length) return fallback('The model copy broke the campaign rules.', issues);
  const enrichment: EnrichmentStatus = { status: 'applied', model: String(answer.model), fixture: answer.fixture === true };
  return { ok: true, plan: merged.plan, enrichment };
}
