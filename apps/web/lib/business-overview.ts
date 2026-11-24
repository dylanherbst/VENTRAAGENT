import type { Contact } from './local-crm-contacts.ts';
import { dealStages } from './local-crm-pipeline.ts';
import type { Deal, DealStage } from './local-crm-pipeline.ts';
import type { LocalOffer } from './local-offers.ts';
import { blankRuleset, scoreAll } from './local-lead-scoring.ts';
import type { LeadRuleset } from './local-lead-scoring.ts';
import type { EmailCampaign, CampaignStatus } from './local-email-campaigns.ts';
import type { ContentPost, ContentStatus } from './local-content-calendar.ts';
import type { Funnel } from './local-funnels.ts';
import type { BookingPage } from './local-booking-page.ts';
import type { ProgressTracker } from './local-student-progress.ts';
import type { LeadFormDraft } from './local-lead-forms.ts';
import { formatMoney, openPipelineValue, wonValue } from './sales-report.ts';
import type { MoneyByCurrency } from './sales-report.ts';

// Pure, read-only overview. Every figure is counted from the saved data passed in. Nothing is estimated,
// projected or invented. A part is null when nothing is saved, or UNREADABLE when it could not be read.
// An unreadable part is reported as such and is never treated as zero.

export const UNREADABLE = { unreadable: true } as const;
export type Unreadable = typeof UNREADABLE;
export type Part<T> = T | null | Unreadable;
export const isUnreadable = (v: unknown): v is Unreadable => typeof v === 'object' && v !== null && (v as { unreadable?: unknown }).unreadable === true;

export type OverviewInput = {
  profileId: string;
  todayIso: string;
  offers: Part<readonly LocalOffer[]>;
  contacts: Part<readonly Contact[]>;
  deals: Part<readonly Deal[]>;
  ruleset: Part<LeadRuleset>;
  leadForm: Part<LeadFormDraft>;
  campaigns: Part<readonly EmailCampaign[]>;
  posts: Part<readonly ContentPost[]>;
  funnels: Part<readonly Funnel[]>;
  booking: Part<BookingPage>;
  students: Part<ProgressTracker>;
};

export type Section<T> = { status: 'unreadable' } | { status: 'ok'; value: T };
const unreadable = { status: 'unreadable' } as const;
const ok = <T,>(value: T): Section<T> => ({ status: 'ok', value });

export const upcomingPostLimit = 3;

export type ChecklistItem = { id: string; state: 'empty' | 'unreadable'; text: string; href: string };
export type Overview = {
  offers: Section<number>;
  contacts: Section<number>;
  deals: Section<{ total: number; byStage: Record<DealStage, number>; won: number; openValue: MoneyByCurrency; wonValue: MoneyByCurrency }>;
  leadForm: Section<boolean>;
  campaigns: Section<{ total: number; byStatus: Record<CampaignStatus, number> }>;
  content: Section<{ total: number; byStatus: Record<ContentStatus, number>; upcoming: ContentPost[] }>;
  funnels: Section<number>;
  booking: Section<{ configured: boolean; appointmentTypes: number }>;
  students: Section<number>;
  contactFunnel: Section<{ contacts: number; withDeal: number; wonDeals: number; dealRatio: number | null; wonRatio: number | null }>;
  leadMix: Section<{ hot: number; warm: number; cold: number; rules: 'saved' | 'default' }>;
  consentGaps: Section<{ count: number; contacts: { id: string; name: string; consentStatus: string }[] }>;
  setupChecklist: ChecklistItem[];
};

const list = <T,>(p: Part<readonly T[]>): Section<readonly T[]> => (isUnreadable(p) ? unreadable : ok(p ?? []));

/** Date part (YYYY-MM-DD) of a date or ISO timestamp. */
const dayOf = (iso: string) => iso.slice(0, 10);

export function upcomingPosts(posts: readonly ContentPost[], todayIso: string, limit = upcomingPostLimit): ContentPost[] {
  const today = dayOf(todayIso);
  return posts
    .filter(p => p.status !== 'posted-manually' && p.plannedDate >= today)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function computeOverview(input: OverviewInput): Overview {
  const offers = list(input.offers);
  const contacts = list(input.contacts);
  const deals = list(input.deals);
  const campaigns = list(input.campaigns);
  const posts = list(input.posts);
  const funnels = list(input.funnels);

  const dealsOut: Overview['deals'] = deals.status === 'unreadable' ? unreadable : (() => {
    const byStage = Object.fromEntries(dealStages.map(s => [s, 0])) as Record<DealStage, number>;
    for (const d of deals.value) byStage[d.stage] += 1;
    return ok({ total: deals.value.length, byStage, won: byStage.won, openValue: openPipelineValue(deals.value), wonValue: wonValue(deals.value) });
  })();

  const contactFunnel: Overview['contactFunnel'] = contacts.status === 'unreadable' || deals.status === 'unreadable' ? unreadable : (() => {
    const ids = new Set(contacts.value.map(c => c.id));
    const withDeal = new Set(deals.value.filter(d => ids.has(d.contactId)).map(d => d.contactId)).size;
    const wonDeals = deals.value.filter(d => d.stage === 'won').length;
    return ok({
      contacts: contacts.value.length, withDeal, wonDeals,
      dealRatio: contacts.value.length > 0 ? withDeal / contacts.value.length : null,
      wonRatio: withDeal > 0 ? wonDeals / withDeal : null,
    });
  })();

  const leadMix: Overview['leadMix'] = contacts.status === 'unreadable' || isUnreadable(input.ruleset) ? unreadable : (() => {
    const saved = input.ruleset !== null;
    const scores = scoreAll(contacts.value, input.ruleset ?? blankRuleset(input.profileId));
    const mix = { hot: 0, warm: 0, cold: 0, rules: saved ? 'saved' as const : 'default' as const };
    for (const s of scores) mix[s.label] += 1;
    return ok(mix);
  })();

  const consentGaps: Overview['consentGaps'] = contacts.status === 'unreadable' ? unreadable : (() => {
    const gaps = contacts.value.filter(c => c.consentStatus !== 'opted_in').map(c => ({ id: c.id, name: c.name, consentStatus: c.consentStatus }));
    return ok({ count: gaps.length, contacts: gaps });
  })();

  const campaignsOut: Overview['campaigns'] = campaigns.status === 'unreadable' ? unreadable : (() => {
    const byStatus: Record<CampaignStatus, number> = { draft: 0, ready: 0, archived: 0 };
    for (const c of campaigns.value) byStatus[c.status] += 1;
    return ok({ total: campaigns.value.length, byStatus });
  })();

  const content: Overview['content'] = posts.status === 'unreadable' ? unreadable : (() => {
    const byStatus: Record<ContentStatus, number> = { idea: 0, drafted: 0, ready: 0, 'posted-manually': 0 };
    for (const p of posts.value) byStatus[p.status] += 1;
    return ok({ total: posts.value.length, byStatus, upcoming: upcomingPosts(posts.value, input.todayIso) });
  })();

  const booking: Overview['booking'] = isUnreadable(input.booking) ? unreadable
    : ok({ configured: input.booking !== null, appointmentTypes: input.booking?.appointmentTypes.length ?? 0 });
  const students: Overview['students'] = isUnreadable(input.students) ? unreadable : ok(input.students?.students.length ?? 0);
  const leadForm: Overview['leadForm'] = isUnreadable(input.leadForm) ? unreadable : ok(input.leadForm !== null);

  const overview: Omit<Overview, 'setupChecklist'> = {
    offers: offers.status === 'unreadable' ? unreadable : ok(offers.value.length),
    contacts: contacts.status === 'unreadable' ? unreadable : ok(contacts.value.length),
    deals: dealsOut, leadForm, campaigns: campaignsOut, content,
    funnels: funnels.status === 'unreadable' ? unreadable : ok(funnels.value.length),
    booking, students, contactFunnel, leadMix, consentGaps,
  };
  return { ...overview, setupChecklist: setupChecklist(overview) };
}

type Area = { id: string; label: string; empty: string; href: string; isEmpty: (o: Omit<Overview, 'setupChecklist'>) => boolean | 'unreadable' };
const check = (s: Section<unknown>, empty: (v: never) => boolean) => (s.status === 'unreadable' ? 'unreadable' as const : empty(s.value as never));
const areas: Area[] = [
  { id: 'offers', label: 'offers', empty: 'You have not saved an offer yet.', href: '/business?tab=offers', isEmpty: o => check(o.offers, (v: number) => v === 0) },
  { id: 'contacts', label: 'contacts', empty: 'You have not saved any contacts yet.', href: '/customers?tab=contacts', isEmpty: o => check(o.contacts, (v: number) => v === 0) },
  { id: 'deals', label: 'opportunities', empty: 'You have not saved any opportunities yet.', href: '/customers?tab=opportunities', isEmpty: o => check(o.deals, (v: { total: number }) => v.total === 0) },
  { id: 'lead-form', label: 'lead form', empty: 'You have not saved a lead form yet.', href: '/grow?tab=leads', isEmpty: o => check(o.leadForm, (v: boolean) => !v) },
  { id: 'campaigns', label: 'email campaigns', empty: 'You have not saved any email campaigns yet.', href: '/grow?tab=campaigns', isEmpty: o => check(o.campaigns, (v: { total: number }) => v.total === 0) },
  { id: 'content', label: 'content calendar', empty: 'You have not planned any content yet.', href: '/grow?tab=content', isEmpty: o => check(o.content, (v: { total: number }) => v.total === 0) },
  { id: 'funnels', label: 'funnels', empty: 'You have not saved any funnels yet.', href: '/grow?tab=funnels', isEmpty: o => check(o.funnels, (v: number) => v === 0) },
  { id: 'booking', label: 'booking page', empty: 'Your booking page has no appointment types yet.', href: '/sales?tab=appointments', isEmpty: o => check(o.booking, (v: { appointmentTypes: number }) => v.appointmentTypes === 0) },
  { id: 'students', label: 'student progress', empty: 'You are not tracking any students yet.', href: '/business?tab=delivery', isEmpty: o => check(o.students, (v: number) => v === 0) },
];

function setupChecklist(o: Omit<Overview, 'setupChecklist'>): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const a of areas) {
    const r = a.isEmpty(o);
    if (r === 'unreadable') out.push({ id: a.id, state: 'unreadable', text: `Your saved ${a.label} could not be read, so they are not counted. Nothing was changed.`, href: a.href });
    else if (r) out.push({ id: a.id, state: 'empty', text: a.empty, href: a.href });
  }
  return out;
}

const n = (c: number, word: string) => `${c} ${word}${c === 1 ? '' : 's'}`;
export const formatRatio = (r: number | null) => (r === null ? 'Not enough data' : `${Math.round(r * 100)}%`);

export function describeOverview(o: Overview): string[] {
  const out: string[] = [];
  const bad = (label: string) => `Your saved ${label} could not be read, so they are not counted here.`;
  if (o.offers.status === 'unreadable') out.push(bad('offers')); else out.push(`You have ${n(o.offers.value, 'saved offer')}.`);
  if (o.contacts.status === 'unreadable') out.push(bad('contacts')); else out.push(`You have ${n(o.contacts.value, 'saved contact')}.`);
  if (o.deals.status === 'unreadable') out.push(bad('deals'));
  else if (o.deals.value.total === 0) out.push('No deals are saved yet.');
  else {
    const d = o.deals.value;
    out.push(`You have ${n(d.total, 'saved deal')}, ${d.won} won.`);
    const open = Object.keys(d.openValue).length ? formatMoney(d.openValue) : null;
    const won = Object.keys(d.wonValue).length ? formatMoney(d.wonValue) : null;
    if (open) out.push(`Open pipeline: ${open}.`);
    if (won) out.push(`Won value: ${won}.`);
  }
  if (o.contactFunnel.status === 'ok') {
    const f = o.contactFunnel.value;
    out.push(f.contacts === 0 ? 'No contacts yet, so there is no contact-to-deal ratio.' : `${f.withDeal} of ${n(f.contacts, 'contact')} (${formatRatio(f.dealRatio)}) ${f.withDeal === 1 ? 'has' : 'have'} at least one deal.`);
  }
  if (o.leadMix.status === 'ok') {
    const m = o.leadMix.value;
    out.push(`Lead scores (${m.rules} rules): ${m.hot} hot, ${m.warm} warm, ${m.cold} cold.`);
  }
  if (o.consentGaps.status === 'ok') out.push(o.consentGaps.value.count === 0 ? 'Every saved contact has opted in.' : `${n(o.consentGaps.value.count, 'contact')} ${o.consentGaps.value.count === 1 ? 'has' : 'have'} not opted in. Do not message them.`);
  if (o.campaigns.status === 'unreadable') out.push(bad('email campaigns'));
  else { const c = o.campaigns.value; out.push(`${n(c.total, 'email campaign')} saved: ${c.byStatus.draft} draft, ${c.byStatus.ready} ready, ${c.byStatus.archived} archived.`); }
  if (o.content.status === 'unreadable') out.push(bad('content posts'));
  else { const c = o.content.value; out.push(`${n(c.total, 'content post')} saved, ${c.byStatus['posted-manually']} marked as posted manually.`); }
  if (o.funnels.status === 'unreadable') out.push(bad('funnels')); else out.push(`${n(o.funnels.value, 'funnel')} saved.`);
  if (o.booking.status === 'unreadable') out.push(bad('booking page'));
  else out.push(o.booking.value.configured ? `Your booking page is saved with ${n(o.booking.value.appointmentTypes, 'appointment type')}.` : 'No booking page is saved yet.');
  if (o.leadForm.status === 'unreadable') out.push(bad('lead form')); else out.push(o.leadForm.value ? 'A lead form is saved.' : 'No lead form is saved yet.');
  if (o.students.status === 'unreadable') out.push(bad('student progress')); else out.push(`${n(o.students.value, 'student')} tracked.`);
  return out;
}
