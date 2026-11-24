// View model for the Business Overview page (AMP-081): everything the page says, as plain data, so each state is checked in the
// node tests without a browser. The TSX view only draws this. No income claims, no jargon, "unknown" is never shown as 0.
import { formatMoneyList, formatUtc, plural } from '../../../lib/aimp/overview/index.ts';
import type { BusinessOverview, NeedsYouItem, OverviewState, Severity } from '../../../lib/aimp/overview/index.ts';

/** The one allow-list of owner pages that exist. Paths are relative to `/app/<business>`; `''` is the overview itself. */
export const BUILT_APP_PAGES: readonly string[] = ['', '/brand', '/products', '/orders'];

export const isBuiltHref = (href: string, businessId: string): boolean => {
  const base = `/app/${businessId}`;
  if (href !== base && !href.startsWith(`${base}/`) && !href.startsWith(`${base}?`)) return false;
  return BUILT_APP_PAGES.includes(href.slice(base.length).split('?')[0]);
};

/**
 * Setup steps that the guided journey already covers. Each step id maps to the real /start page that does the same job, so an
 * unfinished setup has a way forward today. These /start pages take no business id (one journey per session), so they are used only for
 * the setup steps, never for approvals, orders or other destinations. A step with a row here always goes to its guided /start page, even
 * when its /app destination is built; delete the row only when the /app page can do the whole step. Steps with no row (payments, first order) stay "Coming soon" and are not clickable.
 */
export const START_STEP_ROUTES: Readonly<Record<string, string>> = {
  idea: '/start/ideas',
  catalogue: '/start/catalogue',
  store: '/start/store',
};
/** The read model's own source kinds/ids that stand for a setup step (a failed publish is the store step). */
const stepIdOf = (src: { kind: string; id: string | null }): string | undefined =>
  src.kind === 'build_step' && src.id ? src.id : src.kind === 'store' ? 'store' : undefined;

export const COMING_SOON = 'Coming soon';
export const NOT_MEASURED = 'Not measured yet';
export const FIX_NEXT_ISSUE = 'Fix next issue';
export const NOTHING_NEEDS_YOU = 'Nothing needs you right now';
/** The button words when the only way forward is a /start page. Never "Fix next issue": that page is not tied to this business. */
export const OPEN_GUIDED_SETUP = 'Open guided setup';
/** Drawn next to EVERY link that goes to a /start page. /start takes no business id: it works on the one setup journey in this session. */
export const GUIDED_SETUP_NOTE = 'Opens the guided setup, which may be for a different business';
export const GUIDED_SETUP_EXPLANATION =
  'This opens the guided setup. It works on the one business in your current setup session, which may not be this business.';
/** The id that ties the primary control to its explanation (`aria-describedby`). */
export const PRIMARY_DESCRIPTION_ID = 'ao-primary-action';

/**
 * `href` is the link target, or null while the destination page is not built: the view then draws plain text with a "Coming soon" tag,
 * never a link. `guided` is true when `href` is a /start page: the view must then show GUIDED_SETUP_NOTE beside it.
 */
export interface LinkVM { href: string | null; destination: string; built: boolean; guided: boolean }
export interface BannerVM { id: 'stale' | 'refresh_failed' | 'approvals_not_read' | 'invalid_amounts' | 'degraded_checkout' | 'payments_not_ready'; tone: 'warn' | 'error'; title: string; text: string; link: (LinkVM & { label: string }) | null }
export interface TileVM { id: 'visits' | 'orders' | 'gross' | 'refunds' | 'delivery'; label: string; value: string; note: string; unknown: boolean }
export interface NeedsYouVM extends LinkVM {
  id: string; rank: number; title: string; action: string; impact: string; severity: Severity; severityLabel: string; categoryLabel: string;
}
/** The next item the owner CAN act on today, offered only when the top item has no page yet. Never a replacement for the top item. */
export interface SecondaryVM extends LinkVM { lead: string; title: string; action: string }
/**
 * The primary card is always about the TRUE top needs-you item. `control` is what the view draws: a link, or a focusable button with
 * `aria-disabled` (never a native `disabled`, which cannot be focused and so cannot announce `explanation`).
 */
export type PrimaryVM =
  | ({
    kind: 'fix'; label: string; title: string; action: string; impact: string;
    control: 'link' | 'disabled'; explanation: string; describedBy: string; secondary: SecondaryVM | null;
  } & LinkVM)
  | { kind: 'calm'; label: string; text: string };
export interface HeadingVM { level: 1 | 2 | 3; text: string }
export interface ProgressStepVM extends LinkVM { id: string; label: string; done: boolean; isNext: boolean }
export interface ActivityVM { id: string; title: string; label: string; when: string; needsOwner: boolean }

export interface OverviewViewModel {
  businessId: string;
  state: OverviewState;
  stateLabel: string;
  title: string;
  lede: string;
  storeLine: { text: string; url: string | null };
  updatedText: string;
  /** The words drawn next to "Last updated": how long ago in plain words, then the exact time. */
  updatedWords: string;
  demoText: string;
  banners: BannerVM[];
  primary: PrimaryVM;
  /** The section titles the view draws, so the heading outline is checked without a browser (see `headingOutline`). */
  headings: { primary: string; glance: string; needsYou: string; progress: string; brief: string; activity: string };
  tiles: TileVM[];
  needsYou: NeedsYouVM[];
  needsYouHidden: number;
  progress: { done: number; total: number; label: string; steps: ProgressStepVM[]; nextLabel: string | null };
  brief: (LinkVM & { text: string })[];
  activity: ActivityVM[];
}

/** `restricted` is the only seller state that means payments WERE working and have stopped. Every other state is setup that is not finished. */
export const OUTAGE_SELLER_STATE = 'restricted';
export const CONNECT_PAYMENTS = 'Connect payments';

const STATE_LABEL: Record<OverviewState, string> = {
  new_setup: 'Setting up', live: 'Live', zero_orders: 'Live, no orders yet', data_stale: 'Numbers may be out of date', degraded_checkout: 'Live, payments need attention',
};
const STATE_LEDE: Record<OverviewState, string> = {
  new_setup: 'Your store is not live yet. Finish the steps below and it can start selling.',
  live: 'Your store is live and taking orders. This is what needs you next.',
  zero_orders: 'Your store is live and ready to buy from. No one has bought yet.',
  data_stale: 'We could not refresh these numbers recently, so treat them as out of date.',
  degraded_checkout: 'Your store is live, but payments are not ready yet, so buyers cannot check out.',
};
const OUTAGE_LEDE = 'Your store is live, but payments have stopped working, so buyers cannot check out. Fix this first.';
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Urgent', high: 'Important', medium: 'Soon', low: 'When you can' };
const CATEGORY_LABEL: Record<NeedsYouItem['category'], string> = {
  checkout: 'Payments', delivery: 'Delivery', money: 'Money', approval: 'Approval', blocker: 'Blocked', setup: 'Setup',
};

export interface ViewModelInput {
  overview: BusinessOverview;
  businessName?: string | null;
  /** Set when the page shows a labelled fixture instead of real data. */
  fixtureLabel?: string | null;
  storeStatus?: 'no_site' | 'draft' | 'live' | 'paused';
  /** From the overview cache (AMP-093): when the numbers were read, their real age, and whether the latest re-read failed. */
  freshness?: { refreshedAt: string; ageMs: number; stale: boolean; refreshFailed: boolean; approvalsFailed?: boolean } | null;
  /** The approvals list could not be read (AMP-109): approvals are unknown, not none. Also read from `freshness.approvalsFailed`. */
  approvalsFailed?: boolean;
}

export const APPROVALS_NOT_READ_TITLE = 'We could not read your approvals list';
export const APPROVALS_NOT_READ_TEXT = 'Something may be waiting for your OK that is not shown here. This is not the same as nothing waiting. Open this page again in a minute to try again.';
export const CALM_APPROVALS_NOT_READ = 'Nothing else needs you, but we could not check your approvals list just now.';

/** How long ago, in plain words. An age that is not a real number is never shown as "just now". */
export const agoWords = (ageMs: number): string => {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'at an unknown time';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `about ${plural(hours, 'hour')} ago`;
  return `about ${plural(Math.floor(hours / 24), 'day')} ago`;
};
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const link = (destination: string, businessId: string, stepId?: string): LinkVM => {
  const start = stepId && Object.hasOwn(START_STEP_ROUTES, stepId) ? START_STEP_ROUTES[stepId] : undefined;
  if (start) return { href: start, destination, built: true, guided: true };
  if (isBuiltHref(destination, businessId)) return { href: destination, destination, built: true, guided: false };
  return { href: null, destination, built: false, guided: false };
};

/** The page's first decision: demo storage off => say so and read nothing; a malformed id => unknown business; otherwise load. */
export type OverviewGate =
  | { kind: 'off'; title: string; noticeTitle: string; reason: string }
  | { kind: 'unknown' }
  | { kind: 'ok' };
export const overviewGate = (a: { available: boolean; reason: string }, businessIdValid: boolean): OverviewGate =>
  !a.available
    ? { kind: 'off', title: 'This page is not switched on here', noticeTitle: 'Demo storage is off on this site', reason: a.reason }
    : businessIdValid ? { kind: 'ok' } : { kind: 'unknown' };

/** The headings the view draws, in reading order: one h1, h2 per section, h3 inside "At a glance" and "Needs you". */
export const headingOutline = (vm: OverviewViewModel): HeadingVM[] => [
  { level: 1, text: vm.title },
  { level: 2, text: vm.headings.primary },
  { level: 2, text: vm.headings.glance },
  ...vm.tiles.map((t): HeadingVM => ({ level: 3, text: t.label })),
  { level: 2, text: vm.headings.needsYou },
  ...vm.needsYou.map((i): HeadingVM => ({ level: 3, text: i.title })),
  { level: 2, text: vm.headings.progress },
  { level: 2, text: vm.headings.brief },
  { level: 2, text: vm.headings.activity },
];

/** An activity time that is not a real date is shown as "Time not recorded" instead of throwing. */
export const TIME_NOT_RECORDED = 'Time not recorded';
const formatActivityTime = (at: unknown): string => {
  const d = new Date(at as number | string);
  return Number.isNaN(d.getTime()) ? TIME_NOT_RECORDED : formatUtc(d.toISOString());
};

/** Only an https: address is ever drawn as a link. */
const httpsUrl = (u: string | null): string | null => {
  if (!u) return null;
  try { return new URL(u).protocol === 'https:' ? u : null; } catch { return null; }
};

export function buildOverviewViewModel({ overview: o, businessName, fixtureLabel, storeStatus, freshness, approvalsFailed: approvalsFlag }: ViewModelInput): OverviewViewModel {
  const approvalsFailed = Boolean(approvalsFlag || freshness?.approvalsFailed);
  const b = o.businessId;
  const s = o.summary;
  // Stale comes from the real age of the saved copy when the cache gives one, as well as from the data's own time.
  const stale = o.flags.stale || Boolean(freshness?.stale);
  const refreshFailed = Boolean(freshness?.refreshFailed);
  const staleNote = stale ? ' May be out of date.' : '';
  const ago = freshness ? agoWords(freshness.ageMs) : null;
  const updatedAt = formatUtc(freshness?.refreshedAt ?? s.lastUpdatedAt);
  const lastUpdated = ago ? `Last updated ${ago} (${updatedAt}).` : `Last updated ${updatedAt}.`;

  const banners: BannerVM[] = [];
  if (refreshFailed) {
    // Shown even when the numbers are not old yet: the owner should know the latest read did not work.
    banners.push({
      id: 'refresh_failed', tone: 'warn', title: 'We could not refresh your numbers',
      text: `We tried to get the latest numbers and it did not work, so you are seeing the last ones we have. ${lastUpdated} ${stale ? 'They may be out of date. ' : ''}Open this page again in a minute to try again.`,
      link: null,
    });
  } else if (stale) {
    banners.push({
      id: 'stale', tone: 'warn', title: 'These numbers may be out of date',
      text: `${lastUpdated} Check again before you act on them.`, link: null,
    });
  }
  if (approvalsFailed) banners.push({ id: 'approvals_not_read', tone: 'warn', title: APPROVALS_NOT_READ_TITLE, text: APPROVALS_NOT_READ_TEXT, link: null });
  if (s.invalidAmounts > 0) {
    const one = s.invalidAmounts === 1;
    banners.push({
      id: 'invalid_amounts', tone: 'warn', title: 'Your totals may be too low',
      text: `We could not read ${plural(s.invalidAmounts, 'amount')}, so we left ${one ? 'it' : 'them'} out. Gross sales or refunds may be lower than the real figure.`,
      link: null,
    });
  }
  const sellerItem = o.needsYou.find((i) => i.source.kind === 'seller');
  const sellerState = sellerItem?.source.id ?? null;
  const notConnected = sellerState === 'not_connected';
  const outage = o.flags.checkoutDegraded && sellerState === OUTAGE_SELLER_STATE;
  /** The button words: "Connect payments" for a seller that never connected; otherwise the read model's own wording. */
  const actionOf = (i: NeedsYouItem) => (i.source.kind === 'seller' && i.source.id === 'not_connected' ? CONNECT_PAYMENTS : i.action);
  if (o.flags.checkoutDegraded && sellerItem) {
    const to = { label: actionOf(sellerItem), ...link(sellerItem.href, b) };
    banners.push(outage
      ? {
        id: 'degraded_checkout', tone: 'error', title: 'Buyers cannot pay right now',
        text: 'Your store is live, but payments have stopped working, so every visitor who tries to buy will be stopped.', link: to,
      }
      : {
        id: 'payments_not_ready', tone: 'warn', title: notConnected ? 'Payments are not connected yet' : sellerItem.title,
        text: notConnected ? 'Your store is published, but buyers cannot check out until you connect payments.' : sellerItem.impact, link: to,
      });
  }

  // The primary card is ALWAYS the true top needs-you item, never a substitute. When its page is not built the control is an honest
  // "Coming soon" (aria-disabled) that names the item, and the next item that can be acted on today is offered as a separate,
  // clearly labelled secondary link, so the owner is not stuck.
  const linkOf = (i: NeedsYouItem) => link(i.href, b, stepIdOf(i.source));
  const top = o.needsYou[0];
  const primaryVm = (): PrimaryVM => {
    const to = linkOf(top);
    const action = actionOf(top);
    const next = to.href === null ? o.needsYou.slice(1).find((i) => linkOf(i).href !== null) : undefined;
    const explanation = to.href === null
      ? `Next step: ${action}. ${COMING_SOON}: the page for "${top.title}" is not built yet, so this button does nothing for now.`
      : to.guided ? `Next step: ${action}. ${GUIDED_SETUP_EXPLANATION}` : `Next step: ${action}.`;
    return {
      kind: 'fix', label: to.guided ? OPEN_GUIDED_SETUP : FIX_NEXT_ISSUE, title: top.title, action, impact: top.impact,
      control: to.href === null ? 'disabled' : 'link', explanation, describedBy: PRIMARY_DESCRIPTION_ID,
      secondary: next ? { lead: 'While that page is coming, the next thing you can do now:', title: next.title, action: actionOf(next), ...linkOf(next) } : null,
      ...to,
    };
  };
  const primary: PrimaryVM = top ? primaryVm() : { kind: 'calm', label: NOTHING_NEEDS_YOU, text: approvalsFailed ? CALM_APPROVALS_NOT_READ : 'We will show the next thing here as soon as there is one.' };

  const v = s.visits;
  const d = s.delivery;
  const dTotal = d.delivered + d.pending + d.failed;
  const tiles: TileVM[] = [
    v.known
      ? { id: 'visits', label: 'Visits', value: String(v.value), note: `${plural(v.value, 'visit')} recorded.${staleNote}`, unknown: false }
      : { id: 'visits', label: 'Visits', value: NOT_MEASURED, note: 'Visit tracking is not connected, so traffic is unknown. This is not zero.', unknown: true },
    { id: 'orders', label: 'Orders', value: String(s.orders), note: (s.orders === 0 ? 'No paid orders yet.' : 'Paid orders, including ones later refunded.') + staleNote, unknown: false },
    { id: 'gross', label: 'Gross sales', value: formatMoneyList(s.grossSales), note: (s.orders === 0 ? 'Nothing sold yet.' : 'Before refunds and fees.') + staleNote, unknown: false },
    { id: 'refunds', label: 'Refunds', value: formatMoneyList(s.refunds), note: (s.refunds.every((m) => m.amountMinor === 0) ? 'No refunds.' : 'Money sent back to buyers.') + staleNote, unknown: false },
    {
      id: 'delivery', label: 'Delivery', unknown: false,
      value: dTotal === 0 ? 'Nothing to deliver yet' : `${d.delivered} delivered · ${d.pending} pending · ${d.failed} failed`,
      note: (d.failed > 0 ? 'Some buyers have paid but not received their file.' : 'Files are sent by email after each paid order.') + staleNote,
    },
  ];

  const nextId = o.launchProgress.nextStep?.id ?? null;
  const steps: ProgressStepVM[] = o.launchProgress.steps.map((x) => ({ id: x.id, label: x.label, done: x.done, isNext: x.id === nextId, ...link(x.href, b, x.id) }));

  const published = o.flags.storePublished;
  const storeLine = s.storeUrl
    ? { text: s.storeUrl, url: httpsUrl(s.storeUrl) }
    : published
      ? { text: 'Published in this demo. It has no public address yet.', url: null }
      : { text: storeStatus === 'paused' ? 'Paused. Not published right now.' : 'Not published yet', url: null };

  return {
    businessId: b,
    state: o.state,
    stateLabel: STATE_LABEL[o.state],
    title: businessName?.trim() || 'Your business',
    lede: outage && o.state === 'degraded_checkout' ? OUTAGE_LEDE : STATE_LEDE[o.state],
    storeLine,
    updatedText: ago ? `Updated ${ago}` : `Updated ${updatedAt}`,
    updatedWords: ago ? `${capital(ago)} · ${updatedAt}` : updatedAt,
    demoText: fixtureLabel
      ? `Example data for the "${fixtureLabel}" state. It is not your business.`
      : 'DEMO: this data is held in memory on the server and is lost when it restarts.',
    banners,
    primary,
    headings: {
      primary: primary.kind === 'fix' ? primary.title : NOTHING_NEEDS_YOU,
      glance: 'At a glance',
      needsYou: `Needs you${o.needsYou.length ? ` (${Math.max(o.needsYouTotal, o.needsYou.length)})` : ''}`,
      progress: `${o.launchProgress.done} of ${o.launchProgress.total} steps done`,
      brief: 'Summary',
      activity: 'Recent activity',
    },
    tiles,
    needsYou: o.needsYou.map((i) => ({
      id: i.id, rank: i.rank, title: i.title, action: actionOf(i), impact: i.impact, severity: i.severity, severityLabel: SEVERITY_LABEL[i.severity],
      categoryLabel: CATEGORY_LABEL[i.category], ...linkOf(i),
    })),
    needsYouHidden: Math.max(0, o.needsYouTotal - o.needsYou.length),
    progress: {
      done: o.launchProgress.done, total: o.launchProgress.total, label: `${o.launchProgress.done} of ${o.launchProgress.total} steps done`,
      steps, nextLabel: o.launchProgress.nextStep?.label ?? null,
    },
    brief: o.dailyBrief.lines.map((l) => ({ text: l.text, ...link(l.links[0]?.href ?? `/app/${b}`, b, l.links[0]?.kind === 'build_step' ? stepIdOf(l.links[0]) : undefined) })),
    activity: o.recentActivity.map((a) => ({ id: a.id, title: a.title, label: a.label, when: formatActivityTime(a.at), needsOwner: a.needsOwner })),
  };
}
