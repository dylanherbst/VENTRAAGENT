// H19/H20 owner orders: the tenant-scoped read model and the two owner actions.
//  - Every call is for ONE business. An order of another business or workspace is answered exactly like an unknown order, and the
//    ownership check runs BEFORE any read of fulfilment or files and BEFORE any action, so a foreign id causes no side effect.
//  - Reads go through the fulfilment service (which reads orders, fulfilment records and, with the business id, the files grants).
//  - Actions delegate to `retryDelivery` and `reissueAccess`; delivery, email and grant logic are not repeated here.
//  - Nothing returned carries a token, a signed link, a storage path, a full email address or an email message id.
import type { StoreScope } from '../fulfilment/index.ts';
import { allowedActionsOf, ERROR_TEXT, grantView, moneyFlagOf, summaryOf, timelineOf } from './derive.ts';
import type {
  OwnerAccessView, OwnerActionResult, OwnerOrderCounts, OwnerOrderDetail, OwnerOrdersDeps, OwnerOrdersFilter, OwnerOrdersPage, OwnerOrdersScope,
  OwnerOrderSummary, RefundStatusView,
} from './types.ts';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, orderFilters } from './types.ts';

export class OwnerOrdersError extends Error {
  readonly code: 'invalid_scope' | 'invalid_input';
  constructor(code: 'invalid_scope' | 'invalid_input', message: string) { super(message); this.name = 'OwnerOrdersError'; this.code = code; }
}

const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && v !== '.' && v !== '..';
const MAX_KEY = 80;
const READ_ACTOR = 'system:owner-orders-read';
/** Fixed text written to the audit log for owner-initiated sends (no free text from the browser). */
export const OWNER_REISSUE_REASON = 'Owner sent a new link from the orders page';

function readScope(scope: OwnerOrdersScope): StoreScope {
  if (!scope || !isId(scope.workspaceId) || !isId(scope.businessId)) throw new OwnerOrdersError('invalid_scope', 'A workspace and a business are required.');
  return { workspaceId: scope.workspaceId, businessId: scope.businessId, actorId: isId(scope.actorId) ? scope.actorId : READ_ACTOR };
}

// ---- cursor: opaque, keyset on (createdAt desc, id desc) ----
const encodeCursor = (o: { createdAt: string; id: string }): string => Buffer.from(`${o.createdAt}|${o.id}`, 'utf8').toString('base64url');
function decodeCursor(c: string): { createdAt: string; id: string } {
  const bad = () => new OwnerOrdersError('invalid_input', 'That page cursor is not valid.');
  if (typeof c !== 'string' || c.length > 300 || !/^[A-Za-z0-9_-]+$/.test(c)) throw bad();
  const text = Buffer.from(c, 'base64url').toString('utf8');
  const i = text.lastIndexOf('|');
  const createdAt = text.slice(0, i);
  const id = text.slice(i + 1);
  if (i < 1 || Number.isNaN(Date.parse(createdAt)) || !isId(id)) throw bad();
  return { createdAt, id };
}
const newerFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

const matches = (o: OwnerOrderSummary, filter: (typeof orderFilters)[number]): boolean =>
  filter === 'all' ? true : filter === 'needs_attention' ? o.needsAttention : filter === 'delivered' ? o.deliveryState === 'delivered' && o.paymentState === 'paid' : o.paymentState === 'refunded';

export async function listOwnerOrders(deps: OwnerOrdersDeps, scope: OwnerOrdersScope, options: OwnerOrdersFilter = {}): Promise<OwnerOrdersPage> {
  const s = readScope(scope);
  const filter = options.filter ?? 'all';
  if (!orderFilters.includes(filter)) throw new OwnerOrdersError('invalid_input', 'That filter is not known.');
  const limit = options.limit === undefined ? DEFAULT_PAGE_SIZE : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new OwnerOrdersError('invalid_input', `The page size must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const now = deps.now();
  const [rows, owner] = await Promise.all([deps.fulfilment.listStoreOrders(s), deps.fulfilment.listNeedsOwner(s)]);
  const events = owner.filter((e) => e.workspaceId === s.workspaceId && e.businessId === s.businessId);
  const all = rows.map((r) => summaryOf(r, moneyFlagOf(events.filter((e) => e.orderId === r.orderId)), now)).sort(newerFirst);

  const counts: OwnerOrderCounts = {
    all: all.length,
    needs_attention: all.filter((o) => matches(o, 'needs_attention')).length,
    delivered: all.filter((o) => matches(o, 'delivered')).length,
    refunded: all.filter((o) => matches(o, 'refunded')).length,
  };
  const selected = all.filter((o) => matches(o, filter));
  const after = cursor ? selected.filter((o) => newerFirst(cursor, o) < 0) : selected;
  const orders = after.slice(0, limit);
  return {
    workspaceId: s.workspaceId, businessId: s.businessId, filter, orders, total: selected.length, counts,
    nextCursor: after.length > orders.length && orders.length > 0 ? encodeCursor(orders[orders.length - 1] as OwnerOrderSummary) : null,
    generatedAt: now.toISOString(),
  };
}

/** The order, only when it belongs to this workspace AND business. Unknown, foreign and malformed ids all give null. */
async function ownOrder(deps: OwnerOrdersDeps, s: StoreScope, orderId: unknown) {
  if (!isId(orderId)) return null;
  const o = await deps.orders.get(s.workspaceId, orderId);
  return o && o.workspaceId === s.workspaceId && o.businessId === s.businessId ? o : null;
}

export async function getOwnerOrder(deps: OwnerOrdersDeps, scope: OwnerOrdersScope, orderId: string): Promise<OwnerOrderDetail | null> {
  const s = readScope(scope);
  const order = await ownOrder(deps, s, orderId);
  if (!order) return null;
  const now = deps.now();
  const [detail, audit] = await Promise.all([deps.fulfilment.getStoreOrder(s, order.id), deps.fulfilment.audit(s)]);
  if (!detail) return null;
  const { fulfilment, moneyEvents } = detail;
  const grants = detail.grants.map((g) => grantView(g, now));
  const activeCount = grants.filter((g) => g.state === 'active').length;
  // Active grants are passed in so a refunded order with a working link reads "revoking", never "revoked".
  const summary = summaryOf(detail.row, moneyFlagOf(moneyEvents), now, activeCount);
  const access: OwnerAccessView = {
    state: grants.length === 0 ? 'none'
      : summary.deliveryState === 'revoking' ? 'revoking'
      : detail.entitlement?.status === 'revoked' || summary.deliveryState === 'access_revoked' ? 'revoked' : activeCount > 0 ? 'active' : 'inactive',
    grants, activeCount, reissues: fulfilment?.reissues ?? 0,
  };

  const flag = summary.moneyFlag;
  const refund: RefundStatusView = {
    state: flag ?? (order.status === 'refunded' ? 'refunded' : 'none'),
    needsOwner: moneyEvents.some((e) => e.needsOwner),
    events: moneyEvents.map((e) => ({ kind: e.kind, amountMinor: e.amountMinor, at: e.at, needsOwner: e.needsOwner })),
    note: 'This screen only shows the refund state. Refunds are decided and issued with your payment provider.',
  };

  return {
    ...summary,
    workspaceId: order.workspaceId, businessId: order.businessId,
    lineItems: [{ title: order.title, productId: order.productId, productVersion: order.productVersion, quantity: 1, amountMinor: order.amountMinor, currency: order.currency }],
    delivery: {
      status: summary.deliveryState, attempts: fulfilment?.attempts ?? 0, maxAttempts: fulfilment?.maxAttempts ?? null, deliveredAt: summary.deliveredAt,
      lastError: summary.lastError, lastErrorText: summary.lastError ? ERROR_TEXT[summary.lastError] : null,
    },
    access, refund,
    timeline: timelineOf(order, audit.filter((e) => e.orderId === order.id)),
    allowedActions: allowedActionsOf({ paymentState: summary.paymentState, deliveryState: summary.deliveryState, fulfilment, paidEventId: order.paidEventId }, now),
    generatedAt: now.toISOString(),
  };
}

// ---- actions ----
const NOT_FOUND: OwnerActionResult = { ok: false, code: 'order_not_found', message: 'That order was not found in this business.' };
const INVALID: OwnerActionResult = { ok: false, code: 'invalid', message: 'Give the order and a request key.' };
const MAX_REMEMBERED = 500;
// A repeat of the same (business, order, action, request key) while this process runs answers with the first answer and does nothing.
// The fulfilment service has its own durable guards (delivery lease, reissue slot); this only stops a double click from reaching it.
const remembered = new WeakMap<object, Map<string, Promise<OwnerActionResult>>>();

async function once(deps: OwnerOrdersDeps, key: string, run: () => Promise<OwnerActionResult>): Promise<OwnerActionResult> {
  let m = remembered.get(deps.fulfilment);
  if (!m) { m = new Map(); remembered.set(deps.fulfilment, m); }
  const hit = m.get(key);
  if (hit) {
    const first = await hit;
    return first.ok ? { ...first, outcome: 'duplicate', message: 'That request was already handled a moment ago, so nothing new was sent.', revokedLinks: 0 } : first;
  }
  const p = run();
  m.set(key, p);
  if (m.size > MAX_REMEMBERED) m.delete(m.keys().next().value as string);
  // Only a final successful (or duplicate) answer is kept. A failure is forgotten so a retry with the same key reaches fulfilment
  // again; fulfilment's own guards (delivery lease, attempt cap, sticky reissue slot, provider email key) still stop a double send.
  try {
    const r = await p;
    if (!r.ok && m.get(key) === p) m.delete(key);
    return r;
  } catch (e) { if (m.get(key) === p) m.delete(key); throw e; }
}

async function guarded(deps: OwnerOrdersDeps, scope: OwnerOrdersScope, orderId: unknown, requestKey: unknown, action: 'resend' | 'reissue',
  run: (s: StoreScope, orderId: string) => Promise<OwnerActionResult>): Promise<OwnerActionResult> {
  if (!scope || !isId(scope.workspaceId) || !isId(scope.businessId) || !isId(scope.actorId) || !isId(orderId) || !isId(requestKey) || requestKey.length > MAX_KEY) return INVALID;
  const s: StoreScope = { workspaceId: scope.workspaceId, businessId: scope.businessId, actorId: scope.actorId };
  // Ownership first: a foreign order id never reaches fulfilment (so no audit row, no email, no grant change).
  const order = await ownOrder(deps, s, orderId);
  if (!order) return NOT_FOUND;
  return once(deps, `${s.workspaceId}|${s.businessId}|${order.id}|${action}|${requestKey}`, () => run(s, order.id));
}

export function resendDelivery(deps: OwnerOrdersDeps, scope: OwnerOrdersScope, orderId: string, requestKey: string): Promise<OwnerActionResult> {
  return guarded(deps, scope, orderId, requestKey, 'resend', async (s, id) => {
    const r = await deps.fulfilment.retryDelivery(s, id);
    switch (r.outcome) {
      case 'delivered': return { ok: true, outcome: 'sent', message: 'The delivery email was sent.', revokedLinks: 0 };
      case 'already_delivered': return { ok: true, outcome: 'already_delivered', message: 'This order was already delivered, so nothing new was sent.', revokedLinks: 0 };
      case 'in_progress': return { ok: false, code: 'in_progress', message: 'Delivery is already being sent. Check the order in a moment.' };
      case 'failed': return { ok: false, code: 'failed', message: `The delivery email failed again${r.error ? `: ${ERROR_TEXT[r.error]}` : '.'} You can try again.` };
      case 'needs_review': case 'retries_exhausted': return { ok: false, code: 'needs_review', message: 'Delivery cannot be retried any more. Send a new link instead, once the product file is fine.' };
      case 'order_not_found': return NOT_FOUND;
      default: return { ok: false, code: 'not_allowed', message: 'This order cannot be delivered right now (it is not paid, or it was refunded).' };
    }
  });
}

export function reissueAccess(deps: OwnerOrdersDeps, scope: OwnerOrdersScope, orderId: string, requestKey: string): Promise<OwnerActionResult> {
  return guarded(deps, scope, orderId, requestKey, 'reissue', async (s, id) => {
    const r = await deps.fulfilment.reissueAccess(s, { orderId: id, reason: OWNER_REISSUE_REASON, requestKey });
    if (r.ok) {
      return r.duplicate
        ? { ok: true, outcome: 'duplicate', message: 'That request was already sent, so nothing new was emailed.', revokedLinks: 0 }
        : { ok: true, outcome: 'sent', message: 'A new download link was emailed and earlier links stopped working.', revokedLinks: r.revokedGrantIds.length };
    }
    switch (r.code) {
      case 'order_not_found': return NOT_FOUND;
      case 'in_progress': return { ok: false, code: 'in_progress', message: r.message };
      case 'email_unavailable': return { ok: false, code: 'email_unavailable', message: r.message };
      case 'invalid': return INVALID;
      case 'email_failed': case 'not_deliverable': return { ok: false, code: 'failed', message: r.message };
      default: return { ok: false, code: 'not_allowed', message: r.message };
    }
  });
}
