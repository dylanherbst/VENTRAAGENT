// Orders queue (screen 19) and order detail (screen 20), AMP-086. Pure helpers: no React, no Next, no storage, so node:test loads them.
// Nothing here is an order, delivery or refund rule. States and allowed actions come from the owner-orders service; this file only
// decides how they are worded and grouped for the screen. Amounts go through the existing money helper (lib/aimp/overview/format.ts).
import { formatMoney, formatUtc, plural } from '../../../../lib/aimp/overview/format.ts';
import { orderFilters } from '../../../../lib/aimp/owner-orders/types.ts';
import type {
  DeliveryState, GrantState, OrderFilter, OwnerOrderDetail, OwnerOrdersPage, OwnerOrderSummary, PaymentState, TimelineKind,
} from '../../../../lib/aimp/owner-orders/types.ts';

export type Tone = 'neutral' | 'success' | 'warn' | 'danger';

export const filterNames: Record<OrderFilter, string> = { all: 'All', needs_attention: 'Needs attention', delivered: 'Delivered', refunded: 'Refunded' };

/** Reads `?filter=` safely: a missing, repeated or unknown value is "all". */
export function parseFilter(raw: string | string[] | undefined): OrderFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (orderFilters as readonly string[]).includes(v ?? '') ? (v as OrderFilter) : 'all';
}
/** Reads `?cursor=` as one plain string, or null. The service decides whether it is a real cursor. */
export function parseCursor(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length > 0 && v.length <= 300 ? v : null;
}

export const ordersHref = (businessId: string, filter: OrderFilter = 'all', cursor: string | null = null): string => {
  const q = [filter === 'all' ? '' : `filter=${filter}`, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&');
  return `/app/${businessId}/orders${q ? `?${q}` : ''}`;
};
export const orderHref = (businessId: string, orderId: string): string => `/app/${businessId}/orders/${encodeURIComponent(orderId)}`;

export const DEMO_NOTE = 'Demo storage on the server: this page reads from the same in-memory demo as guided set-up, and it is lost when the server restarts.';
/** Shown only when this server session has no order store connected (for example an old session kept alive while the code changed). */
export const NO_STORE_TITLE = 'Orders cannot be read right now';
export const NO_STORE_TEXT =
  'This server session has no order store connected, so no orders can be listed. This is not a count of zero sales: the list is simply not available. Reload the demo session and try again.';
/** One wording, used on the list row and on the order page. Text, so it never relies on colour alone. */
export const TEST_ORDER_LABEL = 'Test order: no real payment';
export const TEST_ORDER_COUNT_NOTE = `Order counts include test orders, marked "${TEST_ORDER_LABEL}". They are not real sales.`;
export const REFUND_NOTE = 'This screen only shows the refund state. No refunds are issued from here.';

const PAYMENT: Record<PaymentState, { label: string; tone: Tone }> = {
  pending: { label: 'Not paid yet', tone: 'neutral' }, paid: { label: 'Paid', tone: 'success' }, refunded: { label: 'Refunded', tone: 'warn' }, failed: { label: 'Payment failed', tone: 'danger' },
};
const DELIVERY: Record<DeliveryState, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'neutral' }, in_progress: { label: 'Sending', tone: 'neutral' }, delivered: { label: 'Delivered', tone: 'success' },
  failed: { label: 'Delivery failed', tone: 'danger' }, needs_review: { label: 'Needs review', tone: 'danger' }, revoking: { label: 'Removing access', tone: 'warn' },
  access_revoked: { label: 'Access removed', tone: 'neutral' },
};
export const paymentLabel = (s: PaymentState): string => PAYMENT[s]?.label ?? 'Unknown';
export const deliveryLabel = (s: DeliveryState): string => DELIVERY[s]?.label ?? 'Unknown';

/** Plain text for a time the service gave us; never throws on a bad value. */
export const whenText = (iso: string | null): string => (iso ? formatUtc(iso) : 'Not yet');

export interface OrderRowVM {
  id: string;
  href: string;
  title: string;
  /** The service's masked address (`b***@example.test`): enough to recognise the buyer, never the full address. */
  buyer: string;
  amount: string;
  payment: { label: string; tone: Tone };
  delivery: { label: string; tone: Tone };
  created: string;
  /** Plain-English reason when the order needs the owner; otherwise null. */
  attention: string | null;
  /** True when the server found the order was paid through the sample seller account. Never taken from the request. */
  test: boolean;
}

export function buildRow(businessId: string, o: OwnerOrderSummary, isTest = false): OrderRowVM {
  return {
    test: isTest, id: o.id, href: orderHref(businessId, o.id), title: o.title.trim() || 'Untitled product', buyer: o.buyerMasked,
    amount: formatMoney({ amountMinor: o.amountMinor, currency: o.currency }),
    payment: PAYMENT[o.paymentState] ?? { label: 'Unknown', tone: 'neutral' }, delivery: DELIVERY[o.deliveryState] ?? { label: 'Unknown', tone: 'neutral' },
    created: formatUtc(o.createdAt), attention: o.attention ? o.attention.reason : null,
  };
}

export interface FilterTabVM { filter: OrderFilter; name: string; count: number; href: string; current: boolean }
export interface EmptyCopy { title: string; text: string }
export interface ListVM {
  rows: OrderRowVM[];
  tabs: FilterTabVM[];
  total: number;
  /** "Showing 3 of 12 orders", for people using a screen reader and everyone else. */
  summary: string;
  nextHref: string | null;
  firstPageHref: string | null;
  empty: EmptyCopy | null;
  /** Set when a listed order is a test order: the counts above include it. Null otherwise. */
  testNote: string | null;
}

/** Plain-English empty state. `all` is the number of orders the business has at all. */
export function emptyCopy(filter: OrderFilter, all: number): EmptyCopy {
  if (all === 0) return { title: 'No orders yet', text: 'When someone buys from your store, the order appears here with its payment and delivery state. You can make a test purchase from your store page to see how an order looks. It is marked as a test and no real payment is taken.' };
  switch (filter) {
    case 'needs_attention': return { title: 'Nothing needs your attention', text: 'Every order is paid and delivered, or waiting normally.' };
    case 'delivered': return { title: 'No delivered orders', text: 'Paid orders show here once their download email has been sent.' };
    case 'refunded': return { title: 'No refunded orders', text: 'Orders that were refunded show here.' };
    default: return { title: 'No orders yet', text: 'When someone buys from your store, the order appears here.' };
  }
}

/** `cursor` is the cursor the page was really read with (`loadOrders` gives it): null on page 1, also after a bad cursor fell back to page 1. */
export function buildList(businessId: string, page: OwnerOrdersPage, cursor: string | null = null, testIds: readonly string[] = []): ListVM {
  const rows = page.orders.map((o) => buildRow(businessId, o, testIds.includes(o.id)));
  return {
    rows, total: page.total, testNote: rows.some((r) => r.test) ? TEST_ORDER_COUNT_NOTE : null,
    tabs: orderFilters.map((f) => ({ filter: f, name: filterNames[f], count: page.counts[f], href: ordersHref(businessId, f), current: f === page.filter })),
    summary: page.total === 0 ? 'No orders to show' : `Showing ${rows.length} of ${plural(page.total, 'order')}`,
    nextHref: page.nextCursor ? ordersHref(businessId, page.filter, page.nextCursor) : null,
    firstPageHref: cursor ? ordersHref(businessId, page.filter) : null,
    empty: rows.length === 0 ? emptyCopy(page.filter, page.counts.all) : null,
  };
}

// ---- order detail ----
export interface FactVM { label: string; value: string }
export interface GrantVM { id: string; state: string; tone: Tone; line: string }
export interface TimelineVM { key: string; when: string; label: string; actor: string; kind: TimelineKind }
export interface ActionVM { kind: 'resend' | 'reissue'; label: string; allowed: boolean; reason: string; confirm: string; pending: string }
export interface DetailVM {
  id: string;
  title: string;
  backHref: string;
  payment: { label: string; tone: Tone };
  delivery: { label: string; tone: Tone };
  attention: string | null;
  facts: FactVM[];
  lineItems: { title: string; version: string; amount: string }[];
  deliveryFacts: FactVM[];
  deliveryError: string | null;
  access: { stateLabel: string; summary: string; grants: GrantVM[] };
  refund: { stateLabel: string; needsOwner: boolean; events: FactVM[]; note: string };
  timeline: TimelineVM[];
  actions: ActionVM[];
  updated: string;
  test: boolean;
}

const GRANT: Record<GrantState, { label: string; tone: Tone }> = {
  active: { label: 'Working', tone: 'success' }, expired: { label: 'Expired', tone: 'neutral' }, used_up: { label: 'Used up', tone: 'neutral' }, revoked: { label: 'Stopped', tone: 'neutral' },
};
const ACCESS_LABEL: Record<OwnerOrderDetail['access']['state'], string> = {
  none: 'No link sent yet', active: 'A download link works', inactive: 'No link works now', revoking: 'Access is being removed', revoked: 'Access removed',
};
const REFUND_LABEL: Record<OwnerOrderDetail['refund']['state'], string> = {
  none: 'No refund', refunded: 'Refunded', partial_refund: 'Partly refunded', dispute: 'Dispute open', refund_exception: 'Refund to check',
};
const MONEY_EVENT: Record<OwnerOrderDetail['refund']['events'][number]['kind'], string> = {
  refund: 'Refund', partial_refund: 'Partial refund', dispute: 'Dispute', refund_exception: 'Refund to check',
};

export const ACTOR_AUTOMATIC = 'Automatic';
export const ACTOR_YOU = 'You';
export const ACTOR_PERSON = 'Someone with access to this business';
export const ACTOR_UNKNOWN = 'Not recorded';
/**
 * Who a timeline event names. The service records only `system` (an automatic step) or the id of the signed-in person who acted;
 * it records no role and never the buyer. So: "You" only when that id is the person looking at the page, a neutral phrase for any
 * other person, and "Not recorded" when there is nothing usable. The raw id is never shown.
 */
export function actorLabel(actor: unknown, viewerId: string | null = null): string {
  if (typeof actor !== 'string' || actor.trim() === '') return ACTOR_UNKNOWN;
  if (actor === 'system' || actor.startsWith('system:')) return ACTOR_AUTOMATIC;
  return viewerId !== null && viewerId !== '' && actor === viewerId ? ACTOR_YOU : ACTOR_PERSON;
}

/** `viewerId` is the server-side id of the person looking at the page (the orders source's actor), or null when it is not known. */
export function buildDetail(businessId: string, d: OwnerOrderDetail, viewerId: string | null = null, isTest = false): DetailVM {
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: d.currency });
  const a = d.allowedActions;
  return {
    test: isTest,
    id: d.id, title: d.title.trim() || 'Untitled product', backHref: ordersHref(businessId),
    payment: PAYMENT[d.paymentState] ?? { label: 'Unknown', tone: 'neutral' }, delivery: DELIVERY[d.deliveryState] ?? { label: 'Unknown', tone: 'neutral' },
    attention: d.attention ? d.attention.reason : null,
    facts: [
      { label: 'Order', value: d.id }, { label: 'Buyer', value: d.buyerMasked }, { label: 'Amount', value: money(d.amountMinor) },
      { label: 'Placed', value: whenText(d.createdAt) }, { label: 'Paid', value: whenText(d.paidAt) },
    ],
    lineItems: d.lineItems.map((l) => ({ title: l.title.trim() || 'Untitled product', version: `Version ${l.productVersion}`, amount: formatMoney({ amountMinor: l.amountMinor, currency: l.currency }) })),
    deliveryFacts: [
      { label: 'State', value: DELIVERY[d.delivery.status]?.label ?? 'Unknown' },
      { label: 'Attempts', value: d.delivery.maxAttempts === null ? String(d.delivery.attempts) : `${d.delivery.attempts} of ${d.delivery.maxAttempts}` },
      { label: 'Delivered', value: whenText(d.delivery.deliveredAt) },
    ],
    deliveryError: d.delivery.lastErrorText,
    access: {
      stateLabel: ACCESS_LABEL[d.access.state],
      summary: `${plural(d.access.activeCount, 'working link')}, ${plural(d.access.reissues, 'new link')} sent.`,
      grants: d.access.grants.map((g) => ({
        id: g.id, state: GRANT[g.state]?.label ?? 'Unknown', tone: GRANT[g.state]?.tone ?? 'neutral',
        line: `Sent ${whenText(g.issuedAt)}, ${g.state === 'active' ? 'expires' : 'expiry'} ${whenText(g.expiresAt)}. Downloads used: ${g.downloads} of ${g.maxDownloads}.`,
      })),
    },
    refund: {
      stateLabel: REFUND_LABEL[d.refund.state], needsOwner: d.refund.needsOwner, note: REFUND_NOTE,
      events: d.refund.events.map((e) => ({ label: `${MONEY_EVENT[e.kind]} on ${whenText(e.at)}`, value: `${e.amountMinor === null ? 'Amount not given' : money(e.amountMinor)}${e.needsOwner ? ', waiting for you' : ''}` })),
    },
    timeline: d.timeline.map((t, i) => ({ key: `${i}-${t.at}-${t.kind}`, when: whenText(t.at), label: t.label, actor: actorLabel(t.actor, viewerId), kind: t.kind })),
    actions: [
      { kind: 'resend', label: 'Resend the delivery email', allowed: a.resendDelivery.allowed, reason: a.resendDelivery.reason ?? '',
        confirm: 'Sends the delivery email again for this order.', pending: 'Sending…' },
      { kind: 'reissue', label: 'Send a new download link', allowed: a.reissueAccess.allowed, reason: a.reissueAccess.reason ?? '',
        confirm: 'Emails a new link. Earlier links for this order stop working.', pending: 'Sending a new link…' },
    ],
    updated: `Updated ${whenText(d.generatedAt)}`,
  };
}

/** A fresh key for one click of an action button; the service answers a repeat of the same key without doing anything twice. */
export const newRequestKey = (rand: () => string): string => `own-${rand().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 60)}`;
