// H20 owner order detail (screen 20): line items, timeline, access grants, refund status, allowed actions, nothing secret.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import type { MoneyEventInput } from '../lib/aimp/fulfilment/refund-events.ts';
import { getOwnerOrder, listOwnerOrders } from '../lib/aimp/owner-orders/index.ts';
import { ownerOrdersDeps } from '../lib/aimp/owner-orders/demo.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock, deps: ownerOrdersDeps(w), s: w.stores.a.scope };
}
let evN = 0;
async function money(w: Awaited<ReturnType<typeof world>>['w'], orderId: string, type: MoneyEventInput['type'], over: Partial<MoneyEventInput> = {}) {
  const order = await w.orders.get(w.stores.a.workspaceId, orderId);
  assert.ok(order);
  return w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: `evt_od_${++evN}`, type, order, ...over }, w.now()));
}
const detail = async (x: Awaited<ReturnType<typeof world>>, id: string) => { const d = await getOwnerOrder(x.deps, x.s, id); assert.ok(d); return d; };

test('detail of a delivered order: line item, timeline of recorded events, one working grant, actions', async () => {
  const x = await world();
  const { orderId } = await x.w.buy('a');
  const d = await detail(x, orderId);
  assert.equal(d.id, orderId);
  assert.equal(d.businessId, 'biz-store-a');
  assert.equal(d.paymentState, 'paid');
  assert.equal(d.deliveryState, 'delivered');
  assert.equal(d.lineItems.length, 1);
  assert.deepEqual([d.lineItems[0]!.quantity, d.lineItems[0]!.amountMinor, d.lineItems[0]!.currency, d.lineItems[0]!.productVersion], [1, 1400, 'AUD', x.w.stores.a.productVersion]);
  assert.equal(d.lineItems[0]!.productId, x.w.stores.a.productId);
  assert.deepEqual(d.timeline.map((t) => t.kind), ['order_created', 'paid', 'delivery_started', 'delivery_email_sent']);
  assert.ok(d.timeline.every((t) => t.actor === 'system'));
  assert.equal(d.delivery.attempts, 1);
  assert.equal(d.delivery.maxAttempts, 5);
  assert.equal(d.access.state, 'active');
  assert.equal(d.access.activeCount, 1);
  assert.equal(d.access.grants[0]!.state, 'active');
  assert.equal(d.access.grants[0]!.downloads, 0);
  assert.equal(d.refund.state, 'none');
  assert.equal(d.allowedActions.resendDelivery.allowed, false);
  assert.match(d.allowedActions.resendDelivery.reason ?? '', /already sent/);
  assert.equal(d.allowedActions.reissueAccess.allowed, true);
  assert.equal(d.allowedActions.refundStatus.allowed, true);
  assert.match(d.refund.note, /not issued|Refunds are decided/);
});

test('detail: no token, signed link, storage path, full email, message id or note text anywhere in the object', async () => {
  const x = await world();
  const { orderId } = await x.w.buy('a', { email: 'secret.person@example.test' });
  await x.w.fulfilment.reissueAccess({ ...x.s, actorId: 'owner-a' }, { orderId, reason: 'PRIVATE-REASON-TEXT', requestKey: 'k1' });
  const tokens = x.w.email.outbox().map((m) => x.w.tokenIn(m)).filter((t): t is string => !!t);
  assert.equal(tokens.length, 2);
  const json = JSON.stringify(await detail(x, orderId));
  for (const t of tokens) assert.equal(json.includes(t), false);
  for (const bad of ['/api/aimp/fulfilment/download', 'secret.person', 'buyer-a@example.test', 'msg_', 'cs_', 'PRIVATE-REASON-TEXT', 'aimp:fulfilment:', 'token']) {
    assert.equal(json.toLowerCase().includes(bad.toLowerCase()), false, `contains ${bad}`);
  }
  const d = await detail(x, orderId);
  assert.deepEqual(Object.keys(d.access.grants[0]!).sort(), ['downloads', 'expiresAt', 'id', 'issuedAt', 'maxDownloads', 'replacesGrantId', 'revokedAt', 'state']);
});

test('detail: reissue shows in the timeline with the actor, the old grant revoked and the new one active', async () => {
  const x = await world();
  const { orderId } = await x.w.buy('a');
  x.clock.t += HOUR;
  const r = await x.w.fulfilment.reissueAccess({ ...x.s, actorId: 'owner-a' }, { orderId, reason: 'Lost the email', requestKey: 'k-reissue' });
  assert.ok(r.ok);
  const d = await detail(x, orderId);
  const kinds = d.timeline.map((t) => t.kind);
  assert.deepEqual(kinds.slice(-1), ['link_reissued']);
  assert.equal(d.timeline.at(-1)!.actor, 'owner-a');
  assert.deepEqual(d.access.grants.map((g) => g.state).sort(), ['active', 'revoked']);
  assert.equal(d.access.activeCount, 1);
  assert.equal(d.access.reissues, 1);
});

test('detail: an expired grant is shown as expired, not active', async () => {
  const x = await world();
  const { orderId } = await x.w.buy('a');
  x.clock.t += 73 * HOUR;
  const d = await detail(x, orderId);
  assert.equal(d.access.grants[0]!.state, 'expired');
  assert.equal(d.access.state, 'inactive');
  assert.equal(d.access.activeCount, 0);
  assert.equal(d.allowedActions.reissueAccess.allowed, true, 'a fresh link is exactly what an expired one needs');
});

test('allowedActions: pending, failed payment, failed delivery, needs review, refunded, queued, in-flight', async () => {
  const x = await world({ maxAttempts: 2 });
  const pending = await x.w.startOrder('a');
  const p = await detail(x, pending.orderId);
  assert.equal(p.paymentState, 'pending');
  assert.equal(p.allowedActions.resendDelivery.allowed, false);
  assert.match(p.allowedActions.resendDelivery.reason ?? '', /payment has not completed/);
  assert.equal(p.allowedActions.reissueAccess.allowed, false);
  assert.equal(p.allowedActions.refundStatus.allowed, true);
  assert.deepEqual(p.timeline.map((t) => t.kind), ['order_created']);
  assert.equal(p.access.state, 'none');

  x.w.email.failNext(1);
  const failed = await x.w.buy('a');
  const f = await detail(x, failed.orderId);
  assert.equal(f.deliveryState, 'failed');
  assert.equal(f.allowedActions.resendDelivery.allowed, true);
  assert.match(f.allowedActions.resendDelivery.reason ?? '', /Attempt 1 of 2 failed/);
  assert.equal(f.allowedActions.reissueAccess.allowed, true);
  assert.equal(f.delivery.lastError, 'email_failed');
  assert.match(f.delivery.lastErrorText ?? '', /email provider/);
  assert.deepEqual(f.timeline.map((t) => t.kind), ['order_created', 'paid', 'delivery_started', 'delivery_failed']);

  x.w.email.failNext(2);
  const review = await x.w.buy('a');
  await x.w.fulfilment.retryDelivery(x.s, review.orderId);
  const r = await detail(x, review.orderId);
  assert.equal(r.deliveryState, 'needs_review');
  assert.equal(r.allowedActions.resendDelivery.allowed, false);
  assert.match(r.allowedActions.resendDelivery.reason ?? '', /Send a new link instead/);
  assert.equal(r.allowedActions.reissueAccess.allowed, true);
  assert.ok(r.timeline.some((t) => t.kind === 'delivery_needs_review'));
  assert.ok(r.timeline.some((t) => t.kind === 'retry_requested'));

  const refunded = await x.w.buy('a');
  assert.equal((await money(x.w, refunded.orderId, 'charge.refunded')).outcome, 'refunded');
  const rf = await detail(x, refunded.orderId);
  assert.equal(rf.paymentState, 'refunded');
  assert.equal(rf.deliveryState, 'access_revoked');
  assert.equal(rf.allowedActions.resendDelivery.allowed, false);
  assert.match(rf.allowedActions.reissueAccess.reason ?? '', /refunded/);
  assert.equal(rf.allowedActions.refundStatus.allowed, true);
  assert.equal(rf.refund.state, 'refunded');
  assert.equal(rf.access.state, 'revoked');
  assert.equal(rf.access.activeCount, 0);
  assert.ok(rf.timeline.some((t) => t.kind === 'refunded'));
  assert.ok(rf.timeline.some((t) => t.kind === 'access_revoked'));
});

test('allowedActions: paid with no fulfilment yet can be started; a delivery in flight cannot be doubled', async () => {
  const x = await world({ attach: false });
  const { orderId } = await x.w.buy('a');
  const d = await detail(x, orderId);
  assert.equal(d.deliveryState, 'not_started');
  assert.equal(d.allowedActions.resendDelivery.allowed, true);
  assert.match(d.allowedActions.resendDelivery.reason ?? '', /has not started/);
  // queued record (durable job step 1) -> in_progress, allowed
  await x.w.fulfilment.recordPaidOrder({ workspaceId: x.w.stores.a.workspaceId, orderId });
  const q = await detail(x, orderId);
  assert.equal(q.deliveryState, 'in_progress');
  assert.equal(q.allowedActions.resendDelivery.allowed, true);
  // a live lease: claim an attempt directly and leave it open
  const claimed = await x.w.fulfilmentStore.claimAttempt(x.w.stores.a.workspaceId, orderId, { at: x.w.now().toISOString(), leaseUntil: new Date(x.clock.t + MIN).toISOString(), trigger: 'job' });
  assert.ok(claimed);
  const live = await detail(x, orderId);
  assert.equal(live.allowedActions.resendDelivery.allowed, false);
  assert.match(live.allowedActions.resendDelivery.reason ?? '', /being sent right now/);
  x.clock.t += 2 * MIN;
  assert.equal((await detail(x, orderId)).allowedActions.resendDelivery.allowed, true, 'a lease that ran out can be taken over');
});

test('detail: dispute and partial refund show as owner decisions; this build issues no refund', async () => {
  const x = await world();
  const d1 = await x.w.buy('a');
  const d2 = await x.w.buy('a');
  await money(x.w, d1.orderId, 'charge.dispute.created');
  await money(x.w, d2.orderId, 'charge.refunded', { amountRefundedMinor: 400 });
  const a = await detail(x, d1.orderId);
  assert.equal(a.refund.state, 'dispute');
  assert.equal(a.refund.needsOwner, true);
  assert.equal(a.attention?.code, 'dispute');
  assert.ok(a.timeline.some((t) => t.kind === 'needs_owner'));
  assert.equal(a.paymentState, 'paid');
  assert.equal(a.deliveryState, 'delivered', 'a dispute leaves access as it was');
  const b = await detail(x, d2.orderId);
  assert.equal(b.refund.state, 'partial_refund');
  assert.deepEqual(b.refund.events.map((e) => [e.kind, e.amountMinor, e.needsOwner]), [['partial_refund', 400, true]]);
  // the read model exposes no refund action at all
  assert.deepEqual(Object.keys(a.allowedActions).sort(), ['refundStatus', 'reissueAccess', 'resendDelivery']);
});

test('detail: the clock decides stuck and expiry; timeline stays in time order', async () => {
  const x = await world({ attach: false });
  const { orderId } = await x.w.buy('a');
  x.clock.t += 40 * MIN;
  const d = await detail(x, orderId);
  assert.equal(d.attention?.code, 'delivery_stuck');
  const times = d.timeline.map((t) => t.at);
  assert.deepEqual(times, [...times].sort());
});

test('refund crash in between: order refunded but a grant is still active shows "revoking", never "revoked", and needs attention', async () => {
  const x = await world();
  const { orderId } = await x.w.buy('a');
  // The refund handler marks the order refunded first and revokes grants after; stop between the two steps.
  const marked = await x.w.orders.markRefunded(x.w.stores.a.workspaceId, orderId);
  assert.ok(marked);
  const d = await detail(x, orderId);
  assert.equal(d.paymentState, 'refunded');
  assert.equal(d.deliveryState, 'revoking');
  assert.equal(d.delivery.status, 'revoking');
  assert.equal(d.access.state, 'revoking');
  assert.equal(d.access.activeCount, 1);
  assert.equal(d.needsAttention, true);
  assert.equal(d.attention?.code, 'access_revoking');
  assert.match(d.attention?.reason ?? '', /still being removed/);
  assert.equal(d.allowedActions.resendDelivery.allowed, false);
  assert.equal(d.allowedActions.reissueAccess.allowed, false);
  // The list cannot see grants: it trusts the fulfilment record, which is not `revoked` yet.
  const page = await listOwnerOrders(x.deps, x.s, { filter: 'needs_attention' });
  assert.deepEqual(page.orders.map((o) => [o.id, o.deliveryState]), [[orderId, 'revoking']]);
  // The provider retries the same refund: the revoke step finishes and the state becomes honestly "revoked".
  assert.equal((await money(x.w, orderId, 'charge.refunded')).outcome, 'already_refunded');
  const after = await detail(x, orderId);
  assert.equal(after.deliveryState, 'access_revoked');
  assert.equal(after.access.state, 'revoked');
  assert.equal(after.access.activeCount, 0);
  assert.equal(after.needsAttention, false);
});

test('allowedActions: a paid order without a payment event id cannot be resent, with a plain reason', async () => {
  const x = await world({ attach: false });
  const { orderId } = await x.w.buy('a');
  const noEvent: typeof x.deps = { ...x.deps, orders: { get: async (ws, id) => { const o = await x.w.orders.get(ws, id); return o ? { ...o, paidEventId: null } : o; } } };
  const d = await getOwnerOrder(noEvent, x.s, orderId);
  assert.ok(d);
  assert.equal(d.paymentState, 'paid');
  assert.equal(d.allowedActions.resendDelivery.allowed, false);
  assert.match(d.allowedActions.resendDelivery.reason ?? '', /without a payment confirmation/);
  assert.equal(d.allowedActions.reissueAccess.allowed, false);
  const normal = await detail(x, orderId);
  assert.equal(normal.allowedActions.resendDelivery.allowed, true);
});
