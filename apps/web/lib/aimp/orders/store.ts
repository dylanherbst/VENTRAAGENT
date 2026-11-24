// In-memory OrderStore (AMP-041). Every method runs synchronously inside one JS turn, so two calls started together cannot
// interleave (a database does the same with one conditional UPDATE and a unique index on the event id).
import type { NewOrder, Order, OrderStore, PaidOutcome } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export interface MemoryOrderStoreOptions {
  /**
   * Decides the stored TEST flag (AMP-162) for an order being created. Called once, at creation, from server code only; the buyer
   * never supplies it. The order is a test order when the caller marked it (`test: true`) or this says so. Default: a real order.
   */
  testOnCreate?: (n: NewOrder) => boolean;
}

export function createMemoryOrderStore(opts: MemoryOrderStoreOptions = {}): OrderStore {
  const orders = new Map<string, Order>();
  const byKey = new Map<string, string>();
  const bySession = new Map<string, string>();
  const events = new Set<string>();
  const keyOf = (ws: string, listingId: string, key: string) => `${ws}\u0000${listingId}\u0000${key}`;

  return {
    kind: 'memory',
    async createPending(n: NewOrder) {
      const k = keyOf(n.workspaceId, n.listingId, n.idempotencyKey);
      const existingId = byKey.get(k);
      const existing = existingId ? orders.get(existingId) : undefined;
      if (existing) return { order: clone(existing), created: false };
      // The flag is written here, once, and nothing later changes it. Every order this store makes carries an explicit true or false.
      let test = n.test === true;
      // A throwing callback propagates: no order is created (never fail open to a real-labelled order).
      if (!test && opts.testOnCreate) test = opts.testOnCreate(n) === true;
      const order: Order = { ...clone(n), test, status: 'pending', checkoutSessionId: null, checkoutUrl: null, paidEventId: null, failureReason: null, paidAt: null };
      orders.set(order.id, order);
      byKey.set(k, order.id);
      return { order: clone(order), created: true };
    },
    async attachSession(orderId, session) {
      const o = orders.get(orderId);
      if (!o) throw new Error('Unknown order.');
      if (o.checkoutSessionId && o.checkoutSessionId !== session.id) throw new Error('This order already has a checkout session.');
      const owner = bySession.get(session.id);
      if (owner !== undefined && owner !== orderId) throw new Error('That checkout session belongs to another order.');
      o.checkoutSessionId = session.id;
      o.checkoutUrl = session.url;
      bySession.set(session.id, orderId);
      return clone(o);
    },
    async markFailed(orderId, reason) {
      const o = orders.get(orderId);
      if (!o) throw new Error('Unknown order.');
      // A paid order is never un-paid here, and an order that already has a provider session stays payable.
      if (o.status === 'pending' && !o.checkoutSessionId) { o.status = 'failed'; o.failureReason = reason; }
      return clone(o);
    },
    async get(ws, id) { const o = orders.get(id); return o && o.workspaceId === ws ? clone(o) : null; },
    async list(ws) { return [...orders.values()].filter((o) => o.workspaceId === ws).map(clone); },
    async applyPaid(input): Promise<PaidOutcome> {
      const id = bySession.get(input.sessionId);
      const o = id === undefined ? undefined : orders.get(id);
      // Never create an order from an event, and do not record the id of an event we cannot place.
      if (!o) return { outcome: 'unknown_session' };
      if (events.has(input.eventId)) return { outcome: 'duplicate_event', order: clone(o) };
      if (o.status === 'paid') { events.add(input.eventId); return { outcome: 'already_paid', order: clone(o) }; }
      if (o.status !== 'pending') return { outcome: 'not_pending', order: clone(o) };
      if (input.amountMinor !== o.amountMinor || input.currency.toUpperCase() !== o.currency) return { outcome: 'amount_mismatch', order: clone(o) };
      events.add(input.eventId);
      o.status = 'paid';
      o.paidEventId = input.eventId;
      o.paidAt = input.at;
      return { outcome: 'paid', order: clone(o) };
    },
    async markRefunded(ws, id) {
      const o = orders.get(id);
      if (!o || o.workspaceId !== ws) return null;
      if (o.status !== 'paid') return { order: clone(o), changed: false };
      o.status = 'refunded';
      return { order: clone(o), changed: true };
    },
  };
}
