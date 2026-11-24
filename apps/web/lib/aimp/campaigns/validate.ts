// Campaign validation (AMP-050). One validator for every plan, whether the built-in generator or a model wrote it. It checks
// the plan against the REAL brand, listings and store passed in `ctx`, never against what the plan says about itself:
//  - every item sells one approved listing of this workspace and business, and links to that listing's product URL here;
//  - brand name and tone are the approved brand's; prices are the catalogue's; copy passes the claim rules;
//  - the schedule is the dated window it says it is.
// Pure; plain-English messages that name the field; nothing is thrown for bad input.
import { formatAud } from '../catalogue/pricing.ts';
import { claimIssues } from './claims.ts';
import { lookupListing, productUrlFor, storeIssues, storeOwnershipIssues } from './links.ts';
import { addDays, isWindow, parseDay } from './schedule.ts';
import { campaignChannels, channelFormats, contentFormats, pillarIds, PRIMARY_CHANNEL } from './types.ts';
import type { CampaignContext, CampaignIssue, CampaignIssueCode } from './types.ts';

export const HOOK_MAX = 140;
export const ANGLE_MAX = 240;
export const DESCRIPTION_MAX = 500;
export const CTA_MAX = 120;
export const AUDIENCE_MAX = 240;
export const MAX_ITEMS = 200;
export const MAX_SEO_THEMES = 12;
export const MAX_KEYWORDS = 8;
export const KEYWORD_MAX = 60;
export const BOARD_MAX = 100;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const issue = (field: string, code: CampaignIssueCode, message: string): CampaignIssue => ({ field, code, message });

/** The approved brand for this scope, or the reason there is none. */
export function campaignBrandIssues(ctx: Pick<CampaignContext, 'workspaceId' | 'businessId' | 'brand'>): CampaignIssue[] {
  const b = ctx.brand;
  if (!b || b.status !== 'approved' || b.workspaceId !== ctx.workspaceId || b.businessId !== ctx.businessId) {
    return [issue('brand', 'brand_not_approved', 'Approve the brand first. A campaign uses the approved brand name and tone.')];
  }
  return [];
}

function text(v: unknown, field: string, label: string, max: number, listing: Parameters<typeof claimIssues>[3]): CampaignIssue[] {
  if (typeof v !== 'string' || v.trim().length === 0) return [issue(field, 'invalid', `The ${label} is missing.`)];
  const out: CampaignIssue[] = [];
  if (v.length > max) out.push(issue(field, 'invalid', `The ${label} is ${v.length} characters; the limit is ${max}.`));
  if (/[<>]/.test(v)) out.push(issue(field, 'invalid', `The ${label} cannot contain < or >.`));
  out.push(...claimIssues(v, field, label, listing));
  return out;
}

/** Every problem with a campaign plan. Empty means it links to the right products and uses the approved brand and claims. */
export function validateCampaignPlan(plan: unknown, ctx: CampaignContext): CampaignIssue[] {
  if (!isRec(plan)) return [issue('plan', 'invalid', 'The campaign plan is missing.')];
  const out: CampaignIssue[] = [];

  if (plan.workspaceId !== ctx.workspaceId || plan.businessId !== ctx.businessId) out.push(issue('plan', 'scope', 'This campaign belongs to a different business.'));

  const noBrand = campaignBrandIssues(ctx);
  out.push(...noBrand);
  const b = noBrand.length ? null : ctx.brand!;
  if (b) {
    const pb = isRec(plan.brand) ? plan.brand : {};
    if (pb.name !== b.name) out.push(issue('brand.name', 'brand_mismatch', `The campaign must use the approved brand name "${b.name}".`));
    if (pb.tone !== b.tone) out.push(issue('brand.tone', 'brand_mismatch', `The campaign must use the approved brand tone (${b.tone}).`));
    if (pb.id !== b.id || pb.version !== b.version) out.push(issue('brand', 'brand_mismatch', 'The campaign was written for a different version of the brand. Regenerate it.'));
  }

  const noStore = storeIssues(ctx.store);
  out.push(...noStore);
  if (!noBrand.length) out.push(...storeOwnershipIssues(ctx));
  if (!noStore.length && (!isRec(plan.store) || plan.store.slug !== ctx.store.slug)) out.push(issue('store.slug', 'link_mismatch', 'The campaign points at a different store.'));

  const aud = isRec(plan.audience) ? plan.audience : {};
  out.push(...text(aud.who, 'audience.who', 'audience', AUDIENCE_MAX, null));
  out.push(...text(aud.problem, 'audience.problem', 'audience problem', AUDIENCE_MAX, null));
  if (!Array.isArray(aud.whereTheyAre) || aud.whereTheyAre.length === 0 || aud.whereTheyAre.length > 6) out.push(issue('audience.whereTheyAre', 'invalid', 'List one to six places the audience can be found.'));
  else aud.whereTheyAre.forEach((w, i) => out.push(...text(w, `audience.whereTheyAre.${i}`, 'audience place', AUDIENCE_MAX, null)));

  if (plan.primaryChannel !== PRIMARY_CHANNEL) out.push(issue('primaryChannel', 'invalid', 'Pinterest is the launch channel.'));
  const secondary = new Set<string>();
  if (!Array.isArray(plan.secondaryChannels)) out.push(issue('secondaryChannels', 'invalid', 'The list of extra channels is missing.'));
  else for (const s of plan.secondaryChannels) {
    if (!isRec(s) || !(campaignChannels as readonly unknown[]).includes(s.channel) || s.channel === PRIMARY_CHANNEL || s.mode !== 'export_only' || secondary.has(s.channel as string)) {
      out.push(issue('secondaryChannels', 'invalid', 'Extra channels must be known, listed once, and export only.'));
    } else secondary.add(s.channel as string);
  }

  const pillars = new Set<string>();
  if (!Array.isArray(plan.pillars) || plan.pillars.length === 0) out.push(issue('pillars', 'invalid', 'The campaign needs at least one content pillar.'));
  else plan.pillars.forEach((p, i) => {
    if (!isRec(p) || !(pillarIds as readonly unknown[]).includes(p.id) || pillars.has(p.id as string)) { out.push(issue(`pillars.${i}`, 'invalid', 'Each content pillar must be a known pillar, listed once.')); return; }
    pillars.add(p.id as string);
    out.push(...text(p.title, `pillars.${i}.title`, 'pillar title', HOOK_MAX, null), ...text(p.summary, `pillars.${i}.summary`, 'pillar summary', ANGLE_MAX, null));
  });

  if (!Array.isArray(plan.seoThemes) || plan.seoThemes.length === 0 || plan.seoThemes.length > MAX_SEO_THEMES) out.push(issue('seoThemes', 'invalid', `List one to ${MAX_SEO_THEMES} Pinterest and search themes.`));
  else plan.seoThemes.forEach((t, i) => {
    const f = `seoThemes.${i}`;
    if (!isRec(t)) { out.push(issue(f, 'invalid', 'This search theme is not readable.')); return; }
    out.push(...text(t.theme, `${f}.theme`, 'search theme', HOOK_MAX, null), ...text(t.pinterestBoard, `${f}.pinterestBoard`, 'Pinterest board name', BOARD_MAX, null));
    if (!Array.isArray(t.keywords) || t.keywords.length === 0 || t.keywords.length > MAX_KEYWORDS) out.push(issue(`${f}.keywords`, 'invalid', `Give one to ${MAX_KEYWORDS} keywords for each search theme.`));
    else t.keywords.forEach((k, j) => out.push(...text(k, `${f}.keywords.${j}`, 'keyword', KEYWORD_MAX, null)));
  });

  const sched = isRec(plan.schedule) ? plan.schedule : {};
  const start = parseDay(sched.startDate) === null ? null : (sched.startDate as string);
  const window = isWindow(sched.windowDays) ? sched.windowDays : null;
  if (start === null) out.push(issue('schedule.startDate', 'schedule', 'The start date must be a real date written as YYYY-MM-DD.'));
  if (window === null) out.push(issue('schedule.windowDays', 'schedule', 'The launch window must be a whole number of days from 1 to 60.'));
  if (start !== null && window !== null && sched.endDate !== addDays(start, window - 1)) out.push(issue('schedule.endDate', 'schedule', 'The end date does not match the start date and the length of the window.'));

  const ids = new Set<string>();
  const byDay = new Map<number, string[]>();
  if (!Array.isArray(plan.items) || plan.items.length === 0) out.push(issue('items', 'invalid', 'The campaign has no content items.'));
  else if (plan.items.length > MAX_ITEMS) out.push(issue('items', 'invalid', `The campaign has too many content items; the limit is ${MAX_ITEMS}.`));
  else plan.items.forEach((raw, i) => {
    const f = `items.${i}`;
    if (!isRec(raw)) { out.push(issue(f, 'invalid', 'This content item is not readable.')); return; }
    if (typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) out.push(issue(`${f}.id`, 'invalid', 'Each content item needs its own id.'));
    else ids.add(raw.id);

    const found = lookupListing(ctx, raw.listingId);
    const l = found.ok ? found.listing : null;
    if (!found.ok) out.push(issue(`${f}.listingId`, found.code, found.message));
    if (l) {
      if (raw.productTitle !== l.title || raw.listingVersion !== l.version) out.push(issue(`${f}.productTitle`, 'listing_mismatch', 'The product name or version does not match the approved listing. Regenerate the campaign.'));
      if (!noStore.length && raw.targetUrl !== productUrlFor(ctx.store, l)) out.push(issue(`${f}.targetUrl`, 'link_mismatch', "The link must be this listing's product page in this store."));
      if (raw.priceMinor !== l.priceMinor || raw.currency !== l.currency || raw.priceLabel !== formatAud(l.priceMinor)) {
        out.push(issue(`${f}.priceMinor`, 'price_mismatch', `The price must be the listing price, ${formatAud(l.priceMinor)} ${l.currency}.`));
      }
    }
    const claimOn = l ? { priceMinor: l.priceMinor, currency: l.currency } : null;
    out.push(
      ...text(raw.hook, `${f}.hook`, 'headline', HOOK_MAX, claimOn), ...text(raw.angle, `${f}.angle`, 'angle', ANGLE_MAX, claimOn),
      ...text(raw.description, `${f}.description`, 'description', DESCRIPTION_MAX, claimOn), ...text(raw.callToAction, `${f}.callToAction`, 'call to action', CTA_MAX, claimOn),
    );

    const channelOk = (campaignChannels as readonly unknown[]).includes(raw.channel) && (raw.channel === PRIMARY_CHANNEL || secondary.has(raw.channel as string));
    if (!channelOk) out.push(issue(`${f}.channel`, 'invalid', 'The channel must be Pinterest or one of the listed export-only channels.'));
    else {
      const ch = raw.channel as (typeof campaignChannels)[number];
      if (!(contentFormats as readonly unknown[]).includes(raw.format) || !(channelFormats[ch] as readonly unknown[]).includes(raw.format)) out.push(issue(`${f}.format`, 'invalid', 'That format does not fit the channel.'));
      if (raw.exportOnly !== (ch !== PRIMARY_CHANNEL)) out.push(issue(`${f}.exportOnly`, 'invalid', 'Only Pinterest items can be scheduled; every other channel is export only.'));
      const at = isRec(raw.attribution) ? raw.attribution : {};
      if (at.source !== ch || at.medium !== 'organic' || typeof at.campaign !== 'string' || !/^[a-z0-9-]{1,60}$/.test(at.campaign)) out.push(issue(`${f}.attribution`, 'invalid', 'The attribution labels do not match the channel.'));
    }
    if (!pillars.has(raw.pillarId as string)) out.push(issue(`${f}.pillarId`, 'invalid', "The item's content pillar is not one of the campaign's pillars."));

    if (start !== null && window !== null) {
      const day = raw.day;
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > window) out.push(issue(`${f}.day`, 'schedule', 'The item is scheduled outside the launch window.'));
      else {
        if (raw.scheduledDate !== addDays(start, day - 1)) out.push(issue(`${f}.scheduledDate`, 'schedule', 'The scheduled date does not match the day in the launch window.'));
        if (typeof raw.id === 'string') byDay.set(day, [...(byDay.get(day) ?? []), raw.id]);
      }
    }
  });

  if (start !== null && window !== null) {
    const days = Array.isArray(sched.days) ? sched.days : [];
    const ok = days.length === window && days.every((d, i) => isRec(d) && d.day === i + 1 && d.date === addDays(start, i) && Array.isArray(d.itemIds)
      && JSON.stringify(d.itemIds) === JSON.stringify(byDay.get(i + 1) ?? []));
    if (!ok) out.push(issue('schedule.days', 'schedule', 'The schedule does not list every day of the window with the items planned for it.'));
  }
  return out;
}
