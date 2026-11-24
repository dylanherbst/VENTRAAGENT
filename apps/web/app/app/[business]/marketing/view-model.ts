// Display model for the Marketing overview (screen 25, AMP-129; F01 F11 H03). Pure: it only re-words the campaign record the campaign
// service (lib/aimp/campaigns, AMP-050) returns. No number is invented here: counts are counted from the saved plan.
// This release only drafts and exports a plan. Nothing here says, or may say, that anything was posted, scheduled or published.
import type { CampaignChannel, CampaignRecord } from '../../../../lib/aimp/campaigns/types.ts';

export const CHANNEL_LABELS: Readonly<Record<CampaignChannel, string>> = { pinterest: 'Pinterest', instagram: 'Instagram', tiktok: 'TikTok' };

export const NOTHING_POSTED = 'Nothing is posted, scheduled or sent from here. This release only writes the plan and lets you copy it out; you post by hand.';
export const NOT_IN_DEMO = 'Marketing plans are not available in the demo yet.';
/** More marketing tools. `path` (under `/app/[business]`) is set only for a page that exists; `null` is shown as plain "Soon" text, never a link. */
export const SOON: readonly { name: string; path: string | null }[] = [
  { name: 'Creative Studio', path: '/marketing/creative' },
  { name: 'Calendar', path: '/marketing/calendar' },
  { name: 'Ad angles', path: '/marketing/angles' },
];

export interface MarketingProduct { listingId: string; title: string; priceLabel: string; url: string; pieces: number }
export interface MarketingChannel { channel: CampaignChannel; label: string; role: string; pieces: number }
export interface MarketingPlan {
  version: number;
  status: 'draft' | 'approved';
  statusLabel: string;
  statusText: string;
  brandName: string;
  audience: { who: string; problem: string; whereTheyAre: string[] };
  channels: MarketingChannel[];
  summary: { windowLabel: string; windowDays: number; pieces: number; activeDays: number; wording: string };
  pillars: { id: string; title: string; summary: string }[];
  products: MarketingProduct[];
  updatedLabel: string;
  approvedLabel: string | null;
}
export type MarketingModel = { state: 'none' } | ({ state: 'draft' | 'approved' } & MarketingPlan);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-05" or an ISO time => "5 Nov 2026" (UTC). Anything else => "Unknown date". */
export function dayLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '');
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : 'Unknown date';
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function buildMarketingModel(c: CampaignRecord | undefined): MarketingModel {
  if (!c) return { state: 'none' };
  const p = c.plan;
  const count = (ch: CampaignChannel): number => p.items.filter((i) => i.channel === ch).length;
  const channels: MarketingChannel[] = [
    { channel: p.primaryChannel, label: CHANNEL_LABELS[p.primaryChannel], role: 'Main channel', pieces: count(p.primaryChannel) },
    ...p.secondaryChannels.map((s) => ({ channel: s.channel, label: CHANNEL_LABELS[s.channel], role: 'Copy out and post by hand', pieces: count(s.channel) })),
  ];
  const products = new Map<string, MarketingProduct>();
  for (const i of p.items) {
    const cur = products.get(i.listingId);
    if (cur) cur.pieces += 1;
    else products.set(i.listingId, { listingId: i.listingId, title: i.productTitle, priceLabel: i.priceLabel, url: i.targetUrl, pieces: 1 });
  }
  const approved = c.status === 'approved';
  return {
    state: c.status, version: c.version, status: c.status,
    statusLabel: approved ? 'Approved' : 'Draft',
    statusText: approved
      ? `You approved version ${c.version} of this plan. ${NOTHING_POSTED}`
      : `Version ${c.version} is a draft. Read it, then approve it or make a new draft. ${NOTHING_POSTED}`,
    brandName: p.brand.name,
    audience: { who: p.audience.who, problem: p.audience.problem, whereTheyAre: [...p.audience.whereTheyAre] },
    channels,
    summary: {
      windowLabel: `${dayLabel(p.schedule.startDate)} to ${dayLabel(p.schedule.endDate)}`,
      windowDays: p.schedule.windowDays,
      pieces: p.items.length,
      activeDays: p.schedule.days.filter((d) => d.itemIds.length > 0).length,
      wording: p.source === 'llm' ? 'Wording improved by AI, then checked against your listings' : 'Built-in plan (no AI call)',
    },
    pillars: p.pillars.map((x) => ({ id: x.id, title: x.title, summary: x.summary })),
    products: [...products.values()],
    updatedLabel: dayLabel(c.updatedAt),
    approvedLabel: approved && c.approvedAt ? dayLabel(c.approvedAt) : null,
  };
}

export const piecesLabel = (n: number): string => plural(n, 'piece of content', 'pieces of content');

export function approveConfirm(version: number): { title: string; text: string } {
  return { title: `Approve version ${version} of this plan?`, text: `This marks the plan as approved by you. ${NOTHING_POSTED}` };
}
export function redraftConfirm(m: { state: 'draft' | 'approved'; version: number }): { title: string; text: string } {
  return {
    title: 'Make a new draft?',
    text: m.state === 'approved'
      ? `This replaces approved version ${m.version} with a new draft made from your brand and listings as they are now. The new draft needs your approval again.`
      : `This replaces draft version ${m.version} with a new draft made from your brand and listings as they are now.`,
  };
}
