// H19 owner orders queue (screen 19): ordering, filters, every delivery state, attention reasons, paging, nothing secret returned.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import type { MoneyEventInput } from '../lib/aimp/fulfilment/refund-events.ts';
import { listOwnerOrders, OwnerOrdersError, STUCK_DELIVERY_MS } from '../lib/aimp/owner-orders/index.ts';
import { ownerOrdersDeps, seedOrder } from '../lib/aimp/owner-orders/demo.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const MIN = 60_000;
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock, deps: ownerOrdersDeps(w) };
}
let evN = 0;
async function money(w: Awaited<ReturnType<typeof world>>['w'], orderId: string, type: MoneyEventInput['type'], over: Partial<MoneyEventInput> = {}) {
  const order = await w.orders.get(w.stores.a.workspaceId, orderId);
  assert.ok(order);
  return w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: `evt_ol_${++evN}`, type, order, ...over }, w.now()));
}
const byId = <T extends { id: string }>(rows: T[], id: string) => { const r = rows.find((x) => x.id === id); assert.ok(r, `order ${id} is in the list`); return r; };

test('list: newest first, and each order shows money, payment state and a masked buyer', async () => {
  const { w, clock, deps } = await world();
  const first = await w.buy('a', { email: 'first.buyer@example.test' });
  clock.t += 5 * MIN;
  const second = await w.buy('a');
  clock.t += 5 * MIN;
  const pending = await w.startOrder('a');
  const page = await listOwnerOrders(deps, w.stores.a.scope);
  assert.deepEqual(page.orders.map((o) => o.id), [pending.orderId, second.orderId, first.orderId]);
  assert.equal(page.total, 3);
  assert.deepEqual(page.counts, { all: 3, needs_attention: 0, delivered: 2, refunded: 0 });
  const o = byId(page.orders, first.orderId);
  assert.equal(o.amountMinor, 1400);
  assert.equal(Number.isInteger(o.amountMinor), true);
  assert.equal(o.currency, 'AUD');
  assert.equal(o.paymentState, 'paid');
  assert.equal(o.deliveryState, 'delivered');
  assert.equal(o.buyerMasked, 'f***@example.test');
  assert.equal(o.needsAttention, false);
  assert.equal(o.attention, null);
  // payment pending and delivery not started are separate fields
  const p = byId(page.orders, pending.orderId);
  assert.equal(p.paymentState, 'pending');
  assert.equal(p.deliveryState, 'not_started');
  assert.equal(p.needsAttention, false, 'an unpaid checkout is not an owner problem');
});

test('list: every delivery state the fulfilment service can produce, with its attention reason', async () => {
  const { w, clock, deps } = await world({ maxAttempts: 2 });
  const delivered = await w.buy('a');
  clock.t += MIN;
  w.email.failNext(1);
  const failed = await w.buy('a');                       // 1 of 2 attempts failed -> failed (retryable)
  clock.t += MIN;
  w.email.failNext(2);
  const review = await w.buy('a');                       // first attempt failed ...
  await w.fulfilment.retryDelivery(w.stores.a.scope, review.orderId); // ... second failed -> attempts used up
  clock.t += MIN;
  const refunded = await w.buy('a');
  assert.equal((await money(w, refunded.orderId, 'charge.refunded')).outcome, 'refunded');
  clock.t += MIN;
  const unpaid = await w.startOrder('a');

  const { orders } = await listOwnerOrders(deps, w.stores.a.scope);
  assert.equal(byId(orders, delivered.orderId).deliveryState, 'delivered');
  const f = byId(orders, failed.orderId);
  assert.equal(f.deliveryState, 'failed');
  assert.equal(f.lastError, 'email_failed');
  assert.equal(f.needsAttention, true);
  assert.equal(f.attention?.code, 'delivery_failed');
  assert.match(f.attention?.reason ?? '', /Paid, but the delivery email failed/);
  const r = byId(orders, review.orderId);
  assert.equal(r.deliveryState, 'needs_review');
  assert.equal(r.attention?.code, 'delivery_needs_review');
  const x = byId(orders, refunded.orderId);
  assert.equal(x.paymentState, 'refunded');
  assert.equal(x.deliveryState, 'access_revoked');
  assert.equal(x.needsAttention, false, 'a clean full refund needs nothing');
  assert.equal(byId(orders, unpaid.orderId).deliveryState, 'not_started');
});

test('list: filters all / needs attention / delivered / refunded', async () => {
  const { w, clock, deps } = await world({ maxAttempts: 2 });
  const ok = await w.buy('a');
  clock.t += MIN;
  w.email.failNext(1);
  const bad = await w.buy('a');
  clock.t += MIN;
  const refunded = await w.buy('a');
  await money(w, refunded.orderId, 'charge.refunded');
  const s = w.stores.a.scope;
  const ids = async (filter: 'all' | 'needs_attention' | 'delivered' | 'refunded') => (await listOwnerOrders(deps, s, { filter })).orders.map((o) => o.id);
  assert.deepEqual(await ids('all'), [refunded.orderId, bad.orderId, ok.orderId]);
  assert.deepEqual(await ids('needs_attention'), [bad.orderId]);
  assert.deepEqual(await ids('delivered'), [ok.orderId]);
  assert.deepEqual(await ids('refunded'), [refunded.orderId]);
  const page = await listOwnerOrders(deps, s, { filter: 'refunded' });
  assert.equal(page.total, 1);
  assert.deepEqual(page.counts, { all: 3, needs_attention: 1, delivered: 1, refunded: 1 }, 'counts cover every filter, whichever is selected');
});

test('list: disputes and partial refunds need attention with their own reason; a paid order never delivered becomes stuck', async () => {
  const { w, clock, deps } = await world({ attach: false });
  const stuck = await w.buy('a');                        // paid, no delivery attempted (attach: false)
  const s = w.stores.a.scope;
  let page = await listOwnerOrders(deps, s);
  assert.equal(byId(page.orders, stuck.orderId).deliveryState, 'not_started');
  assert.equal(byId(page.orders, stuck.orderId).needsAttention, false, 'not stuck yet');
  clock.t += STUCK_DELIVERY_MS + 2 * MIN;
  page = await listOwnerOrders(deps, s);
  const st = byId(page.orders, stuck.orderId);
  assert.equal(st.attention?.code, 'delivery_stuck');
  assert.match(st.attention?.reason ?? '', /Paid 32 minutes ago/);

  const w2 = await world();
  const d = await w2.w.buy('a');
  const p = await w2.w.buy('a');
  assert.equal((await money(w2.w, d.orderId, 'charge.dispute.created')).outcome, 'needs_owner');
  assert.equal((await money(w2.w, p.orderId, 'charge.refunded', { amountRefundedMinor: 500 })).outcome, 'needs_owner');
  const rows = (await listOwnerOrders(w2.deps, w2.w.stores.a.scope)).orders;
  assert.equal(byId(rows, d.orderId).attention?.code, 'dispute');
  assert.equal(byId(rows, d.orderId).moneyFlag, 'dispute');
  assert.equal(byId(rows, p.orderId).attention?.code, 'partial_refund');
  assert.equal(byId(rows, p.orderId).paymentState, 'paid', 'a partial refund does not change the payment state or revoke access');
  assert.equal(byId(rows, p.orderId).deliveryState, 'delivered');
});

test('list: bounded pages with a cursor, stable through ties, and bad input is refused', async () => {
  const { w, deps } = await world();
  const s = w.stores.a.scope;
  // five orders created in the same second: the id breaks the tie
  for (let i = 1; i <= 5; i += 1) await seedOrder(w.orders, { id: `ord_tie_${i}`, workspaceId: s.workspaceId, businessId: s.businessId, createdAt: '2026-11-14T09:00:00.000Z' });
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await listOwnerOrders(deps, s, { limit: 2, cursor });
    assert.ok(page.orders.length <= 2);
    assert.equal(page.total, 5);
    seen.push(...page.orders.map((o) => o.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, ['ord_tie_5', 'ord_tie_4', 'ord_tie_3', 'ord_tie_2', 'ord_tie_1']);

  for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { filter: 'bogus' as never }, { cursor: 'not a cursor!' }, { cursor: Buffer.from('nope', 'utf8').toString('base64url') }]) {
    await assert.rejects(listOwnerOrders(deps, s, bad), (e: unknown) => e instanceof OwnerOrdersError && e.code === 'invalid_input');
  }
  await assert.rejects(listOwnerOrders(deps, { workspaceId: '', businessId: s.businessId }), (e: unknown) => e instanceof OwnerOrdersError && e.code === 'invalid_scope');
  assert.equal((await listOwnerOrders(deps, s, { limit: 100 })).orders.length, 5);
});

test('list: an empty business gives an empty page, not an error', async () => {
  const { w, deps } = await world();
  const page = await listOwnerOrders(deps, { workspaceId: w.stores.a.workspaceId, businessId: 'biz-brand-new' });
  assert.deepEqual(page.orders, []);
  assert.equal(page.total, 0);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(page.counts, { all: 0, needs_attention: 0, delivered: 0, refunded: 0 });
});

test('list: nothing secret in the page (no token, link, full email, storage path, message id)', async () => {
  const { w, deps } = await world();
  const b = await w.buy('a', { email: 'private.person@example.test' });
  const token = w.tokenIn(w.email.outbox().at(-1)!);
  assert.ok(token);
  const json = JSON.stringify(await listOwnerOrders(deps, w.stores.a.scope));
  assert.equal(json.includes(token), false);
  assert.equal(json.includes('/api/aimp/fulfilment/download'), false);
  assert.equal(json.includes('private.person'), false);
  assert.equal(json.includes('buyer-a@example.test'), false);
  assert.equal(json.includes('msg_'), false);
  assert.equal(json.includes('cs_'), false, 'no checkout session id');
  assert.ok(json.includes(b.orderId));
});
