// View model for the merchant dashboard (AMP-062): everything the page says, as plain data, so the figures and every label are checked
// in the node tests without a browser. The TSX view only draws this.
//
// Rules: a figure is shown only when its source is really wired. A missing source reads "Not available in the demo yet" (or "Not
// measured yet" / "No cost data yet"), never 0. Money is one figure PER CURRENCY and two currencies are never added together. Anything
// that is an estimate carries `estimate: true` and the word "Estimate" in its label and value. No income claims.
import { formatMoney, formatUtc, isMinorAmount, plural } from '../../../../lib/aimp/overview/index.ts';
import type { BusinessOverview, Money, NeedsYouItem, Severity } from '../../../../lib/aimp/overview/index.ts';
import { agoWords } from '../view-model.ts';
import { workspaceNavItems } from '../workspace-nav-items.ts';

export const NOT_IN_DEMO = 'Not available in the demo yet';
export const NOT_MEASURED = 'Not measured yet';
export const NO_COST_DATA = 'No cost data yet';
export const APPROVALS_NOT_READ = 'We could not read your approvals list just now, so this count is unknown. This is not zero.';
export const ESTIMATE = 'Estimate';
export const COMING_SOON = 'Page coming soon';
export const NOTHING_NEEDS_YOU = 'Nothing needs your attention right now.';
export const ATTENTION_APPROVALS_NOT_READ = 'Nothing else needs your attention, but we could not read your approvals list just now, so something may be waiting for your OK.';
export const DEMO_NOTE = 'DEMO: this data is held in memory on the server and is lost when it restarts.';
export const NOT_SUMMED_NOTE = 'You sell in more than one currency. Each currency is shown on its own and they are never added together.';

export const dashboardHref = (businessId: string): string => `/app/${businessId}/dashboard`;

/** Which sources are wired (from `dashboardSources`). `false` = no source, so the figure is unknown, not zero. */
export interface DashboardSourcesInput { orders: boolean; fulfilment: boolean; approvals: boolean }

/**
 * A cost estimate for one business. NOTHING produces this today (no cost ledger exists), so the page always passes null and shows
 * "No cost data yet". The shape is here so the labelling rule is fixed and tested before a source exists: every amount is drawn as an
 * estimate, with the basis it was worked out from.
 */
export interface DashboardCostEstimate { amounts: Money[]; basis: string }

export interface DashboardInput {
  overview: BusinessOverview;
  businessName?: string | null;
  sources: DashboardSourcesInput;
  /** Posts waiting for the owner's OK, or null when there is no approvals source. */
  postApprovals: number | null;
  /** True when the approvals list exists but could not be read this time; only changes the words beside "not available". */
  postApprovalsFailed?: boolean;
  costs?: DashboardCostEstimate | null;
  freshness?: { refreshedAt: string; ageMs: number; stale: boolean; refreshFailed: boolean } | null;
}

export type SectionId = 'sales' | 'refunds' | 'deliveries' | 'visits' | 'posts' | 'costs';
export interface StatVM {
  id: string; label: string; value: string; note: string | null;
  /** `unavailable` = there is no source for this figure; the value is words, never a number. */
  kind: 'figure' | 'unavailable';
  estimate: boolean;
}
export interface SectionVM {
  id: SectionId; title: string; stats: StatVM[]; notes: string[];
  /** True when at least one figure in the section has no source. */
  unavailable: boolean;
  link: { href: string; label: string } | null;
}
export interface AttentionVM {
  id: string; rank: number; title: string; impact: string; action: string; severity: Severity; severityLabel: string;
  /** The workspace page that fixes it, or null while that page is not built (then plain text and "Page coming soon"). */
  href: string | null; linkLabel: string;
}
export interface BannerVM { id: 'stale' | 'refresh_failed' | 'invalid_amounts'; title: string; text: string }

/** The raw figures behind the page, for reconciling with the orders. Null = no source (unknown), never 0. */
export interface DashboardTotals {
  paidOrders: number | null;
  sales: Money[] | null;
  refunds: Money[] | null;
  afterRefunds: Money[] | null;
  deliveries: { delivered: number; waiting: number; failed: number } | null;
  visits: number | null;
  postApprovals: number | null;
  scheduledPosts: null;
  costs: Money[] | null;
}

export interface DashboardVM {
  businessId: string;
  title: string;
  businessName: string;
  lede: string;
  updatedWords: string;
  demoText: string;
  overviewHref: string;
  banners: BannerVM[];
  sections: SectionVM[];
  attention: { title: string; items: AttentionVM[]; hidden: number; empty: string };
  totals: DashboardTotals;
}

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Urgent', high: 'Important', medium: 'Soon', low: 'When you can' };

const figure = (id: string, label: string, value: string, note: string | null = null): StatVM => ({ id, label, value, note, kind: 'figure', estimate: false });
const missing = (id: string, label: string, value: string, note: string): StatVM => ({ id, label, value, note, kind: 'unavailable', estimate: false });
const section = (id: SectionId, title: string, stats: StatVM[], notes: string[], link: SectionVM['link']): SectionVM => ({
  id, title, stats, notes, link, unavailable: stats.some((s) => s.kind === 'unavailable'),
});

/** The workspace page behind a read-model href (`/app/<business>/<segment>/...`): a link only when that page is built and in the bar. */
export function attentionLink(href: string, businessId: string): { href: string | null; linkLabel: string } {
  const base = `/app/${businessId}`;
  const none = { href: null, linkLabel: COMING_SOON };
  if (href !== base && !href.startsWith(`${base}/`)) return none;
  const segment = href.slice(base.length).replace(/^\//, '').split(/[/?#]/)[0] ?? '';
  if (segment === '') return { href: base, linkLabel: 'Open Overview' }; // the overview page still exists; it just left the bar
  const page = workspaceNavItems.find((i) => i.ready && i.segment === segment);
  if (!page) return none;
  return { href: page.segment ? `${base}/${page.segment}` : base, linkLabel: `Open ${page.label}` };
}

const attentionOf = (i: NeedsYouItem, businessId: string): AttentionVM => ({
  id: i.id, rank: i.rank, title: i.title, impact: i.impact, action: i.action, severity: i.severity, severityLabel: SEVERITY_LABEL[i.severity],
  ...attentionLink(i.href, businessId),
});

export function buildDashboard({ overview: o, businessName, sources, postApprovals, postApprovalsFailed, costs, freshness }: DashboardInput): DashboardVM {
  const b = o.businessId;
  const s = o.summary;
  const page = (seg: string, label: string) => ({ href: `/app/${b}/${seg}`, label });

  // ---- sales and refunds: one figure per currency, never summed across currencies ----
  const sales = sources.orders ? s.grossSales : null;
  const refunds = sources.orders ? s.refunds : null;
  const refundOf = (currency: string) => refunds?.find((m) => m.currency === currency)?.amountMinor ?? 0;
  const afterRefunds = sales ? sales.map((m): Money => ({ currency: m.currency, amountMinor: m.amountMinor - refundOf(m.currency) })) : null;
  const many = (sales?.length ?? 0) > 1;
  const noOrders = 'There is no order source for this business in the demo, so no sale can be recorded here. This is not zero.';

  const salesSection = sales && afterRefunds
    ? section('sales', 'Sales', [
      figure('paid-orders', 'Paid orders', String(s.orders), s.orders === 0 ? 'No paid orders yet.' : 'Includes orders that were later refunded.'),
      ...sales.map((m) => figure(`sales-${m.currency}`, `Sales (${m.currency})`, formatMoney(m), s.orders === 0 ? 'Nothing sold yet.' : 'Before refunds and payment fees.')),
      ...(s.orders === 0 ? [] : afterRefunds.map((m) => figure(`after-refunds-${m.currency}`, `Sales after refunds (${m.currency})`, formatMoney(m), 'Sales minus refunds. Payment fees are not taken off.'))),
    ], many ? [NOT_SUMMED_NOTE] : [], page('orders', 'Open Orders'))
    : section('sales', 'Sales', [
      missing('paid-orders', 'Paid orders', NOT_IN_DEMO, noOrders),
      missing('sales', 'Sales', NOT_IN_DEMO, 'No amount is shown because there is nothing to add up.'),
    ], [], page('orders', 'Open Orders'));

  const refundsSection = refunds
    ? section('refunds', 'Refunds', refunds.map((m) => figure(`refunds-${m.currency}`, `Refunded (${m.currency})`, formatMoney(m), m.amountMinor === 0 ? 'No refunds.' : 'Money sent back to buyers.')), [
      ...(sources.fulfilment ? [] : ['Only full refunds are counted here. Partial refunds and disputes are not available in the demo yet.']),
      ...(many ? [NOT_SUMMED_NOTE] : []),
    ], page('orders', 'Open Orders'))
    : section('refunds', 'Refunds', [missing('refunds', 'Refunded', NOT_IN_DEMO, 'There is no order source for this business in the demo, so no refund can be recorded here. This is not zero.')], [], page('orders', 'Open Orders'));

  // ---- deliveries ----
  const d = s.delivery;
  const deliveries = sources.fulfilment ? { delivered: d.delivered, waiting: d.pending, failed: d.failed } : null;
  const deliveriesSection = deliveries
    ? section('deliveries', 'Deliveries', [
      figure('delivered', 'Delivered', String(deliveries.delivered), 'The email with the file link was sent.'),
      figure('waiting', 'Waiting', String(deliveries.waiting), 'Paid, and the file has not been sent yet.'),
      figure('failed', 'Failed', String(deliveries.failed), deliveries.failed > 0 ? 'These buyers have paid but have not received their file.' : 'No failed deliveries.'),
    ], ['Refunded orders are not counted.'], page('orders', 'Open Orders'))
    : section('deliveries', 'Deliveries', [
      missing('deliveries', 'Delivered, waiting and failed', NOT_IN_DEMO, 'There is no delivery record for this business in the demo, so we cannot say what was sent. This is not zero.'),
    ], [], page('orders', 'Open Orders'));

  // ---- visits ----
  const visits = s.visits.known ? s.visits.value : null;
  const visitsSection = section('visits', 'Store visits', [
    visits === null
      ? missing('visits', 'Visits', NOT_MEASURED, 'Visit tracking is not connected, so traffic is unknown. This is not zero.')
      : figure('visits', 'Visits', String(visits), `${plural(visits, 'visit')} recorded.`),
  ], [], page('website', 'Open Website'));

  // ---- scheduled posts: no reader exists; the only real number is the approvals waiting for the owner ----
  const postsSection = section('posts', 'Scheduled posts', [
    missing('scheduled-posts', 'Scheduled posts', NOT_IN_DEMO, 'Nothing lists scheduled posts yet, so we cannot count them. This is not zero.'),
    postApprovals === null
      ? missing('post-approvals', 'Posts waiting for your OK', NOT_IN_DEMO, postApprovalsFailed ? APPROVALS_NOT_READ : 'There is no approvals list for this business here.')
      : figure('post-approvals', 'Posts waiting for your OK', String(postApprovals), postApprovals === 0 ? 'No post is waiting for you.' : 'Counted from your approvals list. A post does not go out until you approve it.'),
  ], [], null);

  // ---- costs: always an estimate when present; "No cost data yet" when absent ----
  const costList = costs && costs.amounts.length > 0 && costs.amounts.every((m) => isMinorAmount(m.amountMinor)) ? costs : null;
  const costsSection = costList
    ? section('costs', 'Estimated costs', costList.amounts.map((m): StatVM => ({
      id: `costs-${m.currency}`, label: `Estimated costs (${m.currency})`, value: `About ${formatMoney(m)}`, kind: 'figure', estimate: true,
      note: `${ESTIMATE}, not a bill. ${costList.basis}`,
    })), ['These are estimates. The real amounts are on your provider bills.', ...(costList.amounts.length > 1 ? [NOT_SUMMED_NOTE] : [])], null)
    : section('costs', 'Estimated costs', [
      missing('costs', 'Estimated costs', NO_COST_DATA, 'We do not record what this business costs to run yet (AI, email, payment fees). This is not zero.'),
    ], [], null);

  // ---- banners ----
  const stale = o.flags.stale || Boolean(freshness?.stale);
  const ago = freshness ? agoWords(freshness.ageMs) : null;
  const updatedAt = formatUtc(freshness?.refreshedAt ?? s.lastUpdatedAt);
  const banners: BannerVM[] = [];
  if (freshness?.refreshFailed) {
    banners.push({ id: 'refresh_failed', title: 'We could not refresh your numbers', text: `You are seeing the last numbers we have, from ${updatedAt}. Open this page again in a minute to try again.` });
  } else if (stale) {
    banners.push({ id: 'stale', title: 'These numbers may be out of date', text: `Last updated ${updatedAt}. Check again before you act on them.` });
  }
  if (sources.orders && s.invalidAmounts > 0) {
    banners.push({
      id: 'invalid_amounts', title: 'Your totals may be too low',
      text: `We could not read ${plural(s.invalidAmounts, 'amount')}, so we left ${s.invalidAmounts === 1 ? 'it' : 'them'} out. Sales or refunds may be lower than the real figure.`,
    });
  }

  const total = Math.max(o.needsYouTotal, o.needsYou.length);
  return {
    businessId: b,
    title: 'Dashboard',
    businessName: businessName?.trim() || 'Your business',
    lede: 'Your numbers in one place: sales, refunds, deliveries, visits, posts and costs. A figure is shown only when we really have it.',
    updatedWords: ago ? `${ago.charAt(0).toUpperCase()}${ago.slice(1)} · ${updatedAt}` : updatedAt,
    demoText: DEMO_NOTE,
    overviewHref: `/app/${b}`,
    banners,
    sections: [salesSection, refundsSection, deliveriesSection, visitsSection, postsSection, costsSection],
    attention: {
      title: `Needs your attention${total ? ` (${total})` : ''}`,
      items: o.needsYou.map((i) => attentionOf(i, b)),
      hidden: Math.max(0, o.needsYouTotal - o.needsYou.length),
      // An unread approvals list is unknown, not empty: never say "nothing" over it.
      empty: postApprovalsFailed ? ATTENTION_APPROVALS_NOT_READ : NOTHING_NEEDS_YOU,
    },
    totals: {
      paidOrders: sources.orders ? s.orders : null, sales, refunds, afterRefunds, deliveries, visits, postApprovals, scheduledPosts: null,
      costs: costList ? costList.amounts : null,
    },
  };
}

/** The headings the view draws, in reading order: one h1, an h2 per section, an h3 per attention item. */
export const headingOutline = (vm: DashboardVM): { level: 1 | 2 | 3; text: string }[] => [
  { level: 1, text: vm.title },
  { level: 2, text: vm.attention.title },
  ...vm.attention.items.map((i) => ({ level: 3 as const, text: i.title })),
  ...vm.sections.map((x) => ({ level: 2 as const, text: x.title })),
];
