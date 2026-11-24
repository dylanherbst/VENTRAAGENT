// buildBusinessOverview: a pure function from a plain snapshot to the Business Overview. Same snapshot + same `now` = same result.
// No model call, no I/O, no clock reads. Missing sources are reported as unknown, never as zero.
import { AREA_LABELS } from '../automation/types.ts';
import type { AutomationArea } from '../automation/types.ts';
import { isPlainId, OverviewError } from './errors.ts';
import { formatMoneyList, formatUtc, isMinorAmount, plural } from './format.ts';
import {
  MAX_BRIEF_LINES, MAX_NEEDS_YOU, MAX_RECENT_ACTIVITY, needsYouCategories, severities, STALE_AFTER_MS, STUCK_DELIVERY_MS,
} from './types.ts';
import type {
  BriefLine, BusinessOverview, LaunchProgress, LaunchStep, Money, NeedsYouCategory, NeedsYouItem, OverviewFlags, OverviewOrder, OverviewSnapshot,
  OverviewState, OverviewSummary, Severity,
} from './types.ts';

const ms = (iso: string | null): number => (iso === null ? NaN : Date.parse(iso));
const isPaid = (o: OverviewOrder) => o.status === 'paid' || o.status === 'refunded';

/** Destination pages. All under `/app/<businessId>/`. */
export const overviewHref = (businessId: string, page: '' | 'build' | 'launch' | 'brand' | 'products' | 'website' | 'payments' | 'orders' | 'marketing' | 'analytics' | 'settings', sub?: string): string =>
  `/app/${safeBusiness(businessId)}${page ? `/${page}` : ''}${sub ? `/${safeSegment(sub)}` : ''}`;

/** The business id goes into every href, so anything that is not a plain id is refused outright. */
function safeBusiness(id: string): string {
  if (!isPlainId(id)) throw new OverviewError('A plain business id is required.');
  return encodeURIComponent(id);
}
/** Record ids (orders) are encoded; `.` and `..` can never become path segments. */
function safeSegment(id: string): string {
  return id === '.' || id === '..' ? '_' : encodeURIComponent(id);
}

const AREA_PAGE: Readonly<Record<AutomationArea, 'marketing' | 'products' | 'website'>> = { marketing: 'marketing', 'product-generation': 'products', publishing: 'website' };

const DELIVERY_REASON: Readonly<Record<string, string>> = {
  email_failed: 'The delivery email could not be sent.',
  email_unavailable: 'Email is switched off, so the file could not be sent.',
  version_not_approved: 'The product version that was bought is not approved.',
  file_missing: 'The product file is missing.',
  file_changed: 'The product file changed after it was approved.',
};

function addTo(map: Map<string, number>, currency: string, minor: number) {
  map.set(currency, (map.get(currency) ?? 0) + minor);
}
const sortedMoney = (map: Map<string, number>): Money[] =>
  [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([currency, amountMinor]) => ({ currency, amountMinor }));
/** Only currencies that have sales are listed. With no sales at all it is one explicit zero in the business currency. */
function moneyList(map: Map<string, number>, emptyCurrencies: string[]): Money[] {
  if (map.size === 0) for (const c of emptyCurrencies) map.set(c, 0);
  return sortedMoney(map);
}

export function buildSummary(s: OverviewSnapshot): OverviewSummary {
  const gross = new Map<string, number>();
  const refunds = new Map<string, number>();
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  let orders = 0;
  let invalidAmounts = 0;
  for (const o of s.orders) {
    if (!isPaid(o)) continue;
    orders += 1;
    // An amount that is not a whole number of minor units is never added to a total; it is counted so the page can say so.
    if (!isMinorAmount(o.amountMinor) || o.amountMinor < 0) { invalidAmounts += 1; continue; }
    addTo(gross, o.currency, o.amountMinor);
    if (o.status === 'refunded') addTo(refunds, o.currency, o.amountMinor);
  }
  // A partial refund is counted once per provider event, only against an order in this snapshot that was paid, and never on top
  // of an order that is already fully refunded. Refunds for one order add up to at most the order amount (cumulative across events).
  const seen = new Set<string>();
  const refundedSoFar = new Map<string, number>();
  for (const e of s.moneyEvents) {
    if (e.kind !== 'partial_refund' || e.amountMinor === null || seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    if (!isMinorAmount(e.amountMinor) || e.amountMinor < 0) { invalidAmounts += 1; continue; }
    const o = orderById.get(e.orderId);
    if (!o || o.status !== 'paid' || !isMinorAmount(o.amountMinor) || o.amountMinor < 0) continue;
    const room = o.amountMinor - (refundedSoFar.get(o.id) ?? 0);
    const counted = Math.min(e.amountMinor, room);
    if (counted <= 0) continue;
    refundedSoFar.set(o.id, (refundedSoFar.get(o.id) ?? 0) + counted);
    addTo(refunds, o.currency, counted);
  }
  const grossList = moneyList(gross, [s.currency]);
  const delivery = { delivered: 0, pending: 0, failed: 0 };
  const delivered = new Set<string>();
  for (const d of s.deliveries) {
    delivered.add(d.orderId);
    // A refunded order's delivery is not something the owner is waiting on, whatever state it was left in (matches Needs you).
    if (orderById.get(d.orderId)?.status === 'refunded') continue;
    if (d.status === 'delivered') delivery.delivered += 1;
    else if (d.status === 'queued' || d.status === 'delivering') delivery.pending += 1;
    else if (d.status === 'failed' || d.status === 'needs_review') delivery.failed += 1;
    // 'revoked' (refunded) is not a delivery the owner is waiting on.
  }
  for (const o of s.orders) if (o.status === 'paid' && !delivered.has(o.id)) delivery.pending += 1;
  return {
    visits: s.analytics ? { known: true, value: s.analytics.visits } : { known: false },
    orders,
    grossSales: grossList,
    // Exactly one entry per currency in grossSales (zero where nothing was refunded).
    refunds: sortedMoney(new Map([...grossList.map((m): [string, number] => [m.currency, 0]), ...refunds])),
    invalidAmounts,
    delivery,
    storeUrl: s.store.url,
    lastUpdatedAt: s.collectedAt,
  };
}

export function buildLaunchProgress(s: OverviewSnapshot): LaunchProgress {
  const b = s.businessId;
  const paid = s.orders.some((o) => o.status === 'paid' || o.status === 'refunded');
  const steps: LaunchStep[] = [
    { id: 'idea', label: 'Choose your idea', done: s.steps.ideaChosen, href: overviewHref(b, 'build') },
    { id: 'brand', label: 'Save your brand', done: s.steps.brandSaved, href: overviewHref(b, 'brand') },
    { id: 'product', label: 'Approve a product', done: s.steps.productApproved, href: overviewHref(b, 'products') },
    { id: 'catalogue', label: 'Approve your prices', done: s.steps.catalogueApproved, href: overviewHref(b, 'products') },
    { id: 'store', label: 'Publish your store', done: s.store.published, href: overviewHref(b, 'website') },
    { id: 'payments', label: 'Connect payments', done: s.seller.canAcceptPayments, href: overviewHref(b, 'payments') },
    { id: 'first_order', label: 'Get your first order', done: paid, href: overviewHref(b, 'marketing') },
  ];
  return { steps, done: steps.filter((x) => x.done).length, total: steps.length, nextStep: steps.find((x) => !x.done) ?? null };
}

export function computeFlags(s: OverviewSnapshot, now: Date, staleAfterMs: number = STALE_AFTER_MS): OverviewFlags {
  const at = ms(s.collectedAt);
  return {
    stale: Number.isNaN(at) || now.getTime() - at > staleAfterMs,
    checkoutDegraded: s.store.published && !s.seller.canAcceptPayments,
    storePublished: s.store.published,
  };
}

export function computeState(s: OverviewSnapshot, flags: OverviewFlags): OverviewState {
  if (!flags.storePublished) return 'new_setup';
  if (flags.stale) return 'data_stale';
  if (flags.checkoutDegraded) return 'degraded_checkout';
  return s.orders.some(isPaid) ? 'live' : 'zero_orders';
}

type Draft = Omit<NeedsYouItem, 'rank'>;

export function buildNeedsYou(s: OverviewSnapshot, now: Date): NeedsYouItem[] {
  const b = s.businessId;
  const items: Draft[] = [];
  const orderById = new Map(s.orders.map((o) => [o.id, o]));
  const titleOf = (orderId: string) => { const t = orderById.get(orderId)?.title; return t ? `"${t}"` : 'an order'; };

  // 1. Seller and checkout readiness.
  const r = s.seller;
  if (!r.canAcceptPayments) {
    const live = s.store.published;
    const why: Record<string, { title: string; severity: Severity }> = {
      not_connected: { title: 'Payments are not connected', severity: 'high' },
      onboarding_incomplete: { title: 'Payments setup is not finished', severity: 'high' },
      under_review: { title: 'Stripe is checking your payment details', severity: 'medium' },
      restricted: { title: 'Payments are switched off', severity: 'critical' },
    };
    const w = why[r.state] ?? { title: 'Payments are not ready', severity: 'high' as Severity };
    const waiting = r.outstanding.length > 0 ? ` Stripe is waiting for ${r.outstanding.join(', ')}.` : '';
    const impact = (live ? 'Your store is live but buyers cannot pay yet.' : 'You will not be able to take payments when you publish.') + waiting;
    const unpublishedSeverity: Severity = w.severity === 'critical' ? 'high' : w.severity === 'high' ? 'medium' : 'low';
    items.push({
      id: `seller:${r.state}`, category: live ? 'checkout' : 'setup', severity: live ? w.severity : unpublishedSeverity,
      title: w.title, action: r.nextAction.label, impact, href: overviewHref(b, 'payments'), source: { kind: 'seller', id: r.state },
    });
  }
  if (s.store.lastPublishFailed) {
    items.push({
      id: 'store:publish_failed', category: 'blocker', severity: 'high', title: 'The last publish did not go through',
      action: 'Check the site and publish again',
      impact: s.store.published ? 'Your earlier version is still live, but your latest changes are not.' : 'Your store is not live yet.',
      href: overviewHref(b, 'website'), source: { kind: 'store', id: null },
    });
  }

  // 2. Delivery: one item per order, worst first (needs_review, failed, then stuck).
  const deliveryOf = new Map(s.deliveries.map((d) => [d.orderId, d]));
  const flagged = new Set<string>();
  const nowMs = now.getTime();
  for (const d of s.deliveries) {
    if (orderById.get(d.orderId)?.status === 'refunded') continue;
    if (d.status !== 'needs_review' && d.status !== 'failed') continue;
    flagged.add(d.orderId);
    const stuck = d.status === 'needs_review';
    items.push({
      id: `delivery:${d.orderId}`, category: 'delivery', severity: stuck ? 'critical' : 'high',
      title: `Delivery failed for ${titleOf(d.orderId)}`,
      action: stuck ? 'Open the order and fix the delivery' : 'Retry the delivery',
      impact: `The buyer has paid but has not received their file. ${(d.lastError && DELIVERY_REASON[d.lastError]) || 'The delivery email did not go through.'}`,
      href: overviewHref(b, 'orders', d.orderId), source: { kind: 'delivery', id: d.orderId },
    });
  }
  for (const o of s.orders) {
    if (o.status !== 'paid' || flagged.has(o.id)) continue;
    const d = deliveryOf.get(o.id);
    if (d && d.status !== 'queued' && d.status !== 'delivering') continue;
    const since = ms(d ? d.updatedAt : o.paidAt ?? o.createdAt);
    if (Number.isNaN(since) || nowMs - since <= STUCK_DELIVERY_MS) continue;
    items.push({
      id: `delivery:${o.id}`, category: 'delivery', severity: 'high', title: `Delivery is taking too long for "${o.title}"`,
      action: 'Open the order and retry the delivery', impact: 'The buyer has paid but has not received their file yet.',
      href: overviewHref(b, 'orders', o.id), source: { kind: 'delivery', id: o.id },
    });
  }

  // 3. Money events that wait for a person.
  const moneyTitle = { dispute: 'A buyer opened a payment dispute', partial_refund: 'A partial refund needs your decision', refund: 'A refund needs your decision', refund_exception: 'A refund could not be matched to a paid order' } as const;
  for (const e of s.moneyEvents) {
    if (!e.needsOwner) continue;
    items.push({
      id: `money:${e.eventId}`, category: 'money', severity: e.kind === 'dispute' ? 'critical' : 'high', title: moneyTitle[e.kind],
      action: 'Review the order', impact: 'Nothing is decided for you. Money stays as it is until you look at it.',
      href: overviewHref(b, 'orders', e.orderId), source: { kind: 'money_event', id: e.eventId },
    });
  }

  // 4. Approvals still open.
  for (const a of s.approvals) {
    if (a.status !== 'pending' || a.expiresAt <= nowMs) continue;
    const expiry = new Date(a.expiresAt);
    const until = Number.isNaN(expiry.getTime()) ? 'This request will run out if you wait.' : `This request runs out on ${formatUtc(expiry.toISOString())}.`;
    items.push({
      id: `approval:${a.id}`, category: 'approval', severity: 'medium', title: `Waiting for your OK: ${a.description}`, action: 'Approve or reject it',
      impact: `${AREA_LABELS[a.area]} will not run until you decide. ${until}`,
      href: overviewHref(b, AREA_PAGE[a.area]), source: { kind: 'approval', id: a.id },
    });
  }

  // 5. Job and limit blockers. Approvals are shown above, and area-less jobs (delivery) are shown as delivery items.
  for (const e of s.activity) {
    if (!e.needsOwner || e.source === 'approval' || (e.source === 'job' && e.area === null)) continue;
    items.push({
      id: `activity:${e.id}`, category: 'blocker', severity: e.status === 'failed' ? 'high' : 'medium', title: e.title,
      action: e.nextAction ?? 'Open the details', impact: e.detail ?? 'This is stopped until you act.',
      href: overviewHref(b, e.area ? AREA_PAGE[e.area] : 'settings'), source: { kind: 'activity', id: e.id },
    });
  }

  // 6. The next unfinished build step before the store goes live (payments have their own item above).
  const prog = buildLaunchProgress(s);
  const build = prog.steps.find((x) => !x.done && ['idea', 'brand', 'product', 'catalogue', 'store'].includes(x.id));
  if (build) {
    items.push({
      id: `setup:${build.id}`, category: 'setup', severity: 'medium', title: `Next setup step: ${build.label.toLowerCase()}`, action: build.label,
      impact: build.id === 'store' ? 'Nobody can buy until your store is published.' : 'Your store cannot go live until this is done.',
      href: build.href, source: { kind: 'build_step', id: build.id },
    });
  }

  const cat = (c: NeedsYouCategory) => needsYouCategories.indexOf(c);
  const sev = (v: Severity) => severities.indexOf(v);
  const seen = new Set<string>();
  return items
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, c) => cat(a.category) - cat(c.category) || sev(a.severity) - sev(c.severity) || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0))
    .map((i, n) => ({ ...i, rank: n + 1 }));
}

export function buildDailyBrief(s: OverviewSnapshot, now: Date, o: { state: OverviewState; summary: OverviewSummary; needsYou: NeedsYouItem[]; progress: LaunchProgress }): BriefLine[] {
  const b = s.businessId;
  const lines: BriefLine[] = [];
  const day = now.getTime() - 24 * 60 * 60_000;
  const recent = s.orders.filter((x) => isPaid(x) && ms(x.paidAt) >= day).length;

  if (o.state === 'new_setup') {
    lines.push({ text: `Your store is not live yet. ${o.progress.done} of ${o.progress.total} launch steps are done.`, links: [{ kind: 'build_step', id: o.progress.nextStep?.id ?? null, href: o.progress.nextStep?.href ?? overviewHref(b, 'launch') }] });
  } else if (o.state === 'data_stale') {
    lines.push({ text: `These numbers were last updated on ${formatUtc(s.collectedAt)} and may be out of date.`, links: [{ kind: 'store', id: null, href: overviewHref(b, '') }] });
  } else if (o.state === 'degraded_checkout') {
    lines.push({ text: 'Your store is live, but buyers cannot pay yet.', links: [{ kind: 'store', id: null, href: overviewHref(b, 'payments') }] });
  } else if (o.state === 'zero_orders') {
    lines.push({ text: 'Your store is live. No orders yet.', links: [{ kind: 'orders', id: null, href: overviewHref(b, 'orders') }] });
  } else {
    lines.push({ text: `${plural(o.summary.orders, 'paid order')} so far: ${formatMoneyList(o.summary.grossSales)} in gross sales.`, links: [{ kind: 'orders', id: null, href: overviewHref(b, 'orders') }] });
  }
  if (recent > 0) lines.push({ text: `${plural(recent, 'new order')} in the last 24 hours.`, links: [{ kind: 'orders', id: null, href: overviewHref(b, 'orders') }] });
  const v = o.summary.visits;
  lines.push(v.known
    ? { text: `${plural(v.value, 'visit')} recorded.`, links: [{ kind: 'analytics', id: null, href: overviewHref(b, 'analytics') }] }
    : { text: 'Visits are not tracked yet, so traffic is unknown.', links: [{ kind: 'analytics', id: null, href: overviewHref(b, 'analytics') }] });
  const d = o.summary.delivery;
  if (d.delivered + d.pending + d.failed > 0) {
    lines.push({ text: `Delivery: ${d.delivered} sent, ${d.pending} waiting, ${d.failed} failed.`, links: [{ kind: 'delivery', id: null, href: overviewHref(b, 'orders') }] });
  }
  const top = o.needsYou[0];
  lines.push(top
    ? { text: `First thing to do: ${top.title}. ${top.action}.`, links: [{ kind: 'needs_you', id: top.id, href: top.href }] }
    : { text: 'Nothing needs you right now.', links: [{ kind: 'needs_you', id: null, href: overviewHref(b, '') }] });
  return lines.slice(0, MAX_BRIEF_LINES);
}

export function buildBusinessOverview(snapshot: OverviewSnapshot, now: Date, opts: { staleAfterMs?: number } = {}): BusinessOverview {
  safeBusiness(snapshot.businessId); // refuse a hostile id before any href is built
  const flags = computeFlags(snapshot, now, opts.staleAfterMs ?? STALE_AFTER_MS);
  const state = computeState(snapshot, flags);
  const summary = buildSummary(snapshot);
  const all = buildNeedsYou(snapshot, now);
  const launchProgress = buildLaunchProgress(snapshot);
  const needsYou = all.slice(0, MAX_NEEDS_YOU);
  const recentActivity = [...snapshot.activity]
    .sort((a, c) => c.at - a.at || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0))
    .slice(0, MAX_RECENT_ACTIVITY)
    .map((e) => ({ id: e.id, at: e.at, title: e.title, label: e.label, needsOwner: e.needsOwner, source: e.source, jobId: e.jobId, approvalId: e.approvalId }));
  return {
    businessId: snapshot.businessId, workspaceId: snapshot.workspaceId, state, flags, summary, needsYou, needsYouTotal: all.length, recentActivity, launchProgress,
    dailyBrief: { lines: buildDailyBrief(snapshot, now, { state, summary, needsYou, progress: launchProgress }) },
    generatedAt: now.toISOString(),
  };
}
