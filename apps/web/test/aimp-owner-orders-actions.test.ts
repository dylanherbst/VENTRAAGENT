// H20 owner actions: resend delivery and reissue access delegate to fulfilment, keep its idempotency, and answer by requestKey.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import { getOwnerOrder, reissueAccess, resendDelivery } from '../lib/aimp/owner-orders/index.ts';
import type { OwnerOrdersDeps } from '../lib/aimp/owner-orders/index.ts';
import { ownerOrdersDeps } from '../lib/aimp/owner-orders/demo.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock, deps: ownerOrdersDeps(w), s: w.stores.a.scope };
}
/** A new fulfilment wrapper object has an empty in-process memory, so a repeat must be stopped by the fulfilment service itself. */
const fresh = (deps: OwnerOrdersDeps): OwnerOrdersDeps => ({ ...deps, fulfilment: { ...deps.fulfilment } });

test('resend: a failed delivery is retried once, then the same requestKey does nothing more', async () => {
  const { w, deps, s } = await world();
  w.email.failNext(1);
  const { orderId } = await w.buy('a');
  assert.equal(w.email.outbox().length, 0);
  const r1 = await resendDelivery(deps, s, orderId, 'req-1');
  assert.deepEqual([r1.ok, r1.ok && r1.outcome], [true, 'sent']);
  assert.equal(w.email.outbox().length, 1);
  const r2 = await resendDelivery(deps, s, orderId, 'req-1');
  assert.deepEqual([r2.ok, r2.ok && r2.outcome], [true, 'duplicate']);
  const r3 = await resendDelivery(deps, s, orderId, 'req-2');
  assert.deepEqual([r3.ok, r3.ok && r3.outcome], [true, 'already_delivered'], 'a new key on a delivered order sends nothing');
  const r4 = await resendDelivery(fresh(deps), s, orderId, 'req-1');
  assert.equal(r4.ok && r4.outcome, 'already_delivered');
  assert.equal(w.email.outbox().length, 1, 'one email in total');
  assert.equal((await w.fulfilmentStore.get(s.workspaceId, orderId))!.attempts, 2);
  assert.equal((await getOwnerOrder(deps, s, orderId))!.deliveryState, 'delivered');
});

test('resend: concurrent double click with one key sends one email and makes one attempt', async () => {
  const { w, deps, s } = await world();
  w.email.failNext(1);
  const { orderId } = await w.buy('a');
  const both = await Promise.all([resendDelivery(deps, s, orderId, 'dbl'), resendDelivery(deps, s, orderId, 'dbl')]);
  assert.deepEqual(both.map((r) => r.ok && r.outcome).sort(), ['duplicate', 'sent']);
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.get(s.workspaceId, orderId))!.attempts, 2);
});

test('resend: still failing says so in plain words; needs_review, unpaid and refunded are refused with nothing sent', async () => {
  const { w, deps, s } = await world({ maxAttempts: 2 });
  w.email.failNext(2);
  const a = await w.buy('a');
  const again = await resendDelivery(deps, s, a.orderId, 'k1');
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.code, 'needs_review', 'the second failure used the last attempt');
  const parked = await resendDelivery(deps, s, a.orderId, 'k2');
  assert.equal(!parked.ok && parked.code, 'needs_review');
  assert.match(!parked.ok ? parked.message : '', /Send a new link instead/);

  w.email.failNext(1);
  const retryable = await w.buy('a');
  w.email.failNext(1);
  const still = await resendDelivery(deps, s, retryable.orderId, 'k3');
  assert.equal(!still.ok && still.code, 'needs_review');

  const unpaid = await w.startOrder('a');
  const u = await resendDelivery(deps, s, unpaid.orderId, 'k4');
  assert.equal(!u.ok && u.code, 'not_allowed');
  assert.equal(await w.fulfilmentStore.get(s.workspaceId, unpaid.orderId), null, 'no fulfilment was made for an unpaid order');

  const paid = await w.buy('a');
  const order = (await w.orders.get(s.workspaceId, paid.orderId))!;
  await w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: 'evt_act_refund', type: 'charge.refunded', order }, w.now()));
  const sent = w.email.outbox().length;
  const rf = await resendDelivery(deps, s, paid.orderId, 'k5');
  assert.equal(!rf.ok && rf.code, 'not_allowed');
  assert.equal(w.email.outbox().length, sent);
});

test('resend: a retry that fails again while attempts remain answers failed, with the reason in plain words', async () => {
  const { w, deps, s } = await world();
  w.email.failNext(1);
  const { orderId } = await w.buy('a');
  w.email.failNext(1);
  const r = await resendDelivery(deps, s, orderId, 'again-1');
  assert.equal(!r.ok && r.code, 'failed');
  assert.match(!r.ok ? r.message : '', /email provider could not send/);
  assert.equal(w.email.outbox().length, 0);
  const d = (await getOwnerOrder(deps, s, orderId))!;
  assert.equal(d.deliveryState, 'failed');
  assert.equal(d.allowedActions.resendDelivery.allowed, true);
  const ok = await resendDelivery(deps, s, orderId, 'again-2');
  assert.equal(ok.ok && ok.outcome, 'sent');
});

test('resend: starts delivery for a paid order that never started', async () => {
  const { w, deps, s } = await world({ attach: false });
  const { orderId } = await w.buy('a');
  assert.equal(w.email.outbox().length, 0);
  const r = await resendDelivery(deps, s, orderId, 'start-1');
  assert.equal(r.ok && r.outcome, 'sent');
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await getOwnerOrder(deps, s, orderId))!.deliveryState, 'delivered');
});

test('reissue: a new link is emailed, the old one is revoked, and the same requestKey sends it once', async () => {
  const { w, deps, s } = await world();
  const { orderId } = await w.buy('a');
  const oldToken = w.tokenIn(w.email.outbox().at(-1)!)!;
  const actor = { ...s, actorId: 'owner-a' };
  const r1 = await reissueAccess(deps, actor, orderId, 'ri-1');
  assert.equal(r1.ok && r1.outcome, 'sent');
  assert.equal(r1.ok && r1.revokedLinks, 1);
  assert.equal(w.email.outbox().length, 2);
  assert.equal((await w.files.redeem(oldToken)).ok, false, 'old link no longer works');
  const r2 = await reissueAccess(deps, actor, orderId, 'ri-1');
  assert.equal(r2.ok && r2.outcome, 'duplicate');
  // the fulfilment service guards it too, even when this layer's memory is empty (e.g. another server instance)
  const r3 = await reissueAccess(fresh(deps), actor, orderId, 'ri-1');
  assert.equal(r3.ok && r3.outcome, 'duplicate');
  assert.equal(w.email.outbox().length, 2, 'two emails in total, never three');
  const r4 = await reissueAccess(deps, actor, orderId, 'ri-2');
  assert.equal(r4.ok && r4.outcome, 'sent', 'a different key is a new request');
  assert.equal(w.email.outbox().length, 3);
  const d = (await getOwnerOrder(deps, s, orderId))!;
  assert.equal(d.access.activeCount, 1);
  assert.equal(d.timeline.filter((t) => t.kind === 'link_reissued').length, 2);
  const audit = (await w.fulfilment.audit(s)).filter((e) => e.event === 'access_reissued');
  assert.deepEqual(audit.map((e) => [e.actor, e.reason]), [['owner-a', 'Owner sent a new link from the orders page'], ['owner-a', 'Owner sent a new link from the orders page']]);
});

test('reissue: refused when email is off (old link left alone), unpaid or refunded', async () => {
  let off = false;
  const { w, deps, s } = await world({ emailLookup: (flaky) => (off ? null : flaky) });
  const { orderId } = await w.buy('a');
  const token = w.tokenIn(w.email.outbox().at(-1)!)!;
  off = true;
  const r = await reissueAccess(deps, { ...s, actorId: 'owner-a' }, orderId, 'off-1');
  assert.equal(!r.ok && r.code, 'email_unavailable');
  assert.equal((await w.files.redeem(token)).ok, true, 'the old link was not revoked for nothing');
  off = false;
  const unpaid = await w.startOrder('a');
  const u = await reissueAccess(deps, { ...s, actorId: 'owner-a' }, unpaid.orderId, 'un-1');
  assert.equal(!u.ok && u.code, 'not_allowed');
  assert.equal(w.email.outbox().length, 1);
  const order = (await w.orders.get(s.workspaceId, orderId))!;
  await w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: 'evt_act_refund2', type: 'charge.refunded', order }, w.now()));
  const rf = await reissueAccess(deps, { ...s, actorId: 'owner-a' }, orderId, 'rf-1');
  assert.equal(!rf.ok && rf.code, 'not_allowed');
  assert.equal(w.email.outbox().length, 1);
});

test('actions: bad input is refused as invalid before anything happens', async () => {
  const { w, deps, s } = await world();
  const { orderId } = await w.buy('a');
  const actor = { ...s, actorId: 'owner-a' };
  const bad: [unknown, unknown, unknown][] = [[actor, orderId, ''], [actor, orderId, 'x'.repeat(81)], [actor, orderId, 'has space'], [actor, '', 'k'], [{ workspaceId: s.workspaceId, businessId: s.businessId }, orderId, 'k'], [{ ...actor, workspaceId: '' }, orderId, 'k'], [null, orderId, 'k']];
  for (const [sc, id, key] of bad) {
    for (const fn of [resendDelivery, reissueAccess]) {
      const r = await fn(deps, sc as never, id as string, key as string);
      assert.equal(!r.ok && r.code, 'invalid');
    }
  }
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.get(s.workspaceId, orderId))!.reissues, 0);
});

test('resend: a failure is not remembered; the same requestKey after a failure reaches fulfilment again and can succeed', async () => {
  const { w, deps, s } = await world();
  w.email.failNext(1);
  const { orderId } = await w.buy('a');
  w.email.failNext(1);
  const r1 = await resendDelivery(deps, s, orderId, 'same-key');
  assert.deepEqual([r1.ok, !r1.ok && r1.code], [false, 'failed']);
  assert.equal(w.email.outbox().length, 0);
  const r2 = await resendDelivery(deps, s, orderId, 'same-key');
  assert.deepEqual([r2.ok, r2.ok && r2.outcome], [true, 'sent'], 'not the stale failure');
  assert.equal(w.email.outbox().length, 1);
  const r3 = await resendDelivery(deps, s, orderId, 'same-key');
  assert.deepEqual([r3.ok, r3.ok && r3.outcome], [true, 'duplicate'], 'a success is still remembered');
  assert.equal(w.email.outbox().length, 1, 'one email in total: no double send');
});
