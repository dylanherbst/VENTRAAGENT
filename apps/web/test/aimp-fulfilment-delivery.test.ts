import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionCompletedBody } from '../lib/aimp/checkout/fixture-events.ts';
import { FIXTURE_WEBHOOK_SECRET, signPayload } from '../lib/aimp/checkout/signature.ts';
import { fileKeyPath } from '../lib/aimp/files/storage.ts';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentWorld, WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';
import type { EmailAdapter } from '../lib/aimp/providers/types.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock };
}
const grantsOf = (w: FulfilmentWorld, key: 'a' | 'b', orderId: string) => w.files.listGrants({ workspaceId: w.stores[key].workspaceId, businessId: w.stores[key].businessId }, orderItemId(orderId));
const counts = async (w: FulfilmentWorld, key: 'a' | 'b', orderId: string) => {
  const ws = w.stores[key].workspaceId;
  const grants = await grantsOf(w, key, orderId);
  return { fulfilments: (await w.fulfilmentStore.list(ws)).filter((f) => f.orderId === orderId).length, grants: grants.length, activeGrants: grants.filter((g) => g.revokedAt === null).length, emails: w.email.outbox().length };
};

test('a verified paid order produces exactly one fulfilment and one entitlement with order, store, product, version, grant and delivery result', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId, event } = await w.buy('a');
  const all = await w.fulfilmentStore.list(a.workspaceId);
  assert.equal(all.length, 1);
  const f = all[0]!;
  assert.equal(f.orderId, orderId);
  assert.equal(f.workspaceId, a.workspaceId);
  assert.equal(f.businessId, a.businessId);
  assert.equal(f.storeSlug, a.slug);
  assert.equal(f.productId, a.productId);
  assert.equal(f.productVersion, a.productVersion);
  assert.equal(f.paidEventId, event.eventId);
  assert.equal(f.status, 'delivered');
  assert.equal(f.attempts, 1);
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.trigger, x.outcome, x.error]), [[1, 'paid_event', 'delivered', null]]);

  const e = await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId);
  assert.ok(e);
  const grants = await grantsOf(w, 'a', orderId);
  assert.equal(grants.length, 1);
  assert.deepEqual(
    { orderId: e.orderId, ws: e.workspaceId, biz: e.businessId, store: e.storeSlug, product: e.productId, version: e.productVersion, buyer: e.buyerEmail, status: e.status, grant: e.grantId, fulfilment: e.fulfilmentId },
    { orderId, ws: a.workspaceId, biz: a.businessId, store: a.slug, product: a.productId, version: a.productVersion, buyer: 'buyer-a@example.test', status: 'active', grant: grants[0]!.id, fulfilment: f.id },
  );
  assert.equal(e.grantExpiresAt, grants[0]!.expiresAt);

  // the delivery result names the one email that went out
  const box = w.email.outbox();
  assert.equal(box.length, 1);
  assert.equal(f.delivery.emailMessageId, box[0]!.id);
  assert.equal(f.delivery.deliveredAt, new Date(START).toISOString());
  assert.equal(f.delivery.lastError, null);
  assert.equal(f.attemptLog[0]!.grantId, grants[0]!.id);
  assert.equal(box[0]!.to, 'buyer-a@example.test');
});

test('an unpaid, failed or unverified order produces no fulfilment, entitlement, grant or email', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const nothing = async (orderId: string) => {
    assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 0);
    assert.equal(await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId), null);
    assert.equal((await grantsOf(w, 'a', orderId)).length, 0);
    assert.equal(w.email.outbox().length, 0);
    assert.equal(w.email.attempts(), 0);
  };

  // pending (unpaid): asking directly is refused
  const o = await w.startOrder('a');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId: o.orderId })).outcome, 'order_not_paid');
  assert.equal((await w.fulfilment.recordPaidOrder({ workspaceId: a.workspaceId, orderId: o.orderId })).outcome, 'order_not_paid');
  await nothing(o.orderId);

  // unverified: wrong signature, unsigned, "completed but not paid", and a wrong amount
  const ev = await w.payEvent(o.sessionId);
  const secs = Math.floor(START / 1000);
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: signPayload('whsec_wrong', ev.rawBody, secs) })).outcome, 'bad_signature');
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: null })).outcome, 'bad_signature');
  const unpaid = buildSessionCompletedBody({ eventId: 'evt_unpaid', sessionId: o.sessionId, amountMinor: 1400, paymentStatus: 'unpaid', createdSeconds: secs });
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: unpaid, signature: signPayload(FIXTURE_WEBHOOK_SECRET, unpaid, secs) })).outcome, 'invalid');
  const cheap = buildSessionCompletedBody({ eventId: 'evt_cheap', sessionId: o.sessionId, amountMinor: 1, createdSeconds: secs });
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: cheap, signature: signPayload(FIXTURE_WEBHOOK_SECRET, cheap, secs) })).outcome, 'amount_mismatch');
  await nothing(o.orderId);

  // failed order
  const { order: failed } = await w.orders.createPending({ ...(await w.orders.get(a.workspaceId, o.orderId))!, id: 'ord_failed_1', idempotencyKey: 'failed-1', createdAt: new Date(START).toISOString() });
  await w.orders.markFailed(failed.id, 'session_failed');
  assert.equal((await w.orders.get(a.workspaceId, failed.id))?.status, 'failed');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId: failed.id })).outcome, 'order_not_paid');
  await nothing(failed.id);

  // "paid" without the id of a verified provider event is not treated as paid
  const realGet = w.orders.get;
  w.orders.get = async (ws, id) => { const x = await realGet(ws, id); return x ? { ...x, status: 'paid', paidEventId: null } : x; };
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId: o.orderId })).outcome, 'order_not_paid');
  w.orders.get = realGet;
  await nothing(o.orderId);

  // unknown order, another workspace's view of the order, and junk input
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId: 'ord_nope' })).outcome, 'order_not_found');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: w.stores.b.workspaceId, orderId: o.orderId })).outcome, 'order_not_found');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: '', orderId: 'x y' })).outcome, 'invalid');
  await nothing(o.orderId);

  // and the genuine event still works afterwards, once
  assert.equal((await w.checkout.handlePaymentEvent(ev)).outcome, 'paid');
  assert.deepEqual(await counts(w, 'a', o.orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 1 });
});

test('replaying the paid event, a second event for the same session, or asking again never makes a second fulfilment, grant or email', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId, sessionId, event } = await w.buy('a');
  const first = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  for (let i = 0; i < 3; i++) assert.equal((await w.checkout.handlePaymentEvent(event)).outcome, 'duplicate_event');
  const second = await w.payEvent(sessionId);
  assert.notEqual(second.eventId, event.eventId);
  assert.equal((await w.checkout.handlePaymentEvent(second)).outcome, 'already_paid');
  const again = await Promise.all([1, 2, 3, 4, 5].map(() => w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId })));
  assert.deepEqual(again.map((r) => r.outcome), Array(5).fill('already_delivered'));
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId }, { trigger: 'job' })).outcome, 'already_delivered');

  assert.deepEqual(await counts(w, 'a', orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 1 });
  assert.equal(w.email.attempts(), 1, 'the email provider was called once');
  const after = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(after.id, first.id);
  assert.equal(after.attempts, 1);
  assert.equal(after.paidEventId, event.eventId);
  assert.equal((await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))?.id, `ent_${first.id}`);
});

test('the same event delivered concurrently, with an early out-of-order call and a duplicate, delivers once', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const o = await w.startOrder('a');
  const ev = await w.payEvent(o.sessionId);
  const ref = { workspaceId: a.workspaceId, orderId: o.orderId };
  // a delivery request that arrives BEFORE the payment event is refused
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref)).outcome, 'order_not_paid');
  const rs = await Promise.all([
    w.checkout.handlePaymentEvent(ev), w.fulfilment.fulfilPaidOrder(ref), w.checkout.handlePaymentEvent(ev), w.fulfilment.fulfilPaidOrder(ref, { trigger: 'job' }),
    w.checkout.handlePaymentEvent(ev), w.fulfilment.fulfilPaidOrder(ref), w.checkout.handlePaymentEvent(ev),
  ]);
  assert.equal(rs.filter((r) => r.outcome === 'paid').length, 1);
  assert.deepEqual(await counts(w, 'a', o.orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 1 });
  assert.equal(w.email.attempts(), 1);
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, o.orderId))?.attempts, 1);
});

test('many concurrent deliveries of one paid order: only the caller that wins the lease sends', async () => {
  const { w } = await world({ attach: false });
  const a = w.stores.a;
  const { orderId } = await w.buy('a'); // paid, but nothing is subscribed to the hook in this world
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 0);
  const rs = await Promise.all(Array.from({ length: 8 }, () => w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId })));
  assert.equal(rs.filter((r) => r.outcome === 'delivered').length, 1);
  assert.ok(rs.every((r) => r.outcome === 'delivered' || r.outcome === 'in_progress' || r.outcome === 'already_delivered'));
  assert.deepEqual(await counts(w, 'a', orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 1 });
  assert.equal(w.email.attempts(), 1);
});

test('the delivery email goes through the email adapter with an idempotency key and carries a files-service link, never the master path', async () => {
  const sent: Parameters<EmailAdapter['send']>[0][] = [];
  const { w } = await world({ emailLookup: (flaky) => ({ outbox: () => flaky.outbox(), send: async (input) => { sent.push(input); return flaky.send(input); } }) });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  const grant = (await grantsOf(w, 'a', orderId))[0]!;
  assert.equal(sent.length, 1);
  const key = sent[0]!.idempotencyKey;
  assert.equal(key, `aimp:fulfilment:${f.id}:delivery:${grant.id}`);
  assert.equal(f.delivery.emailIdempotencyKey, key);
  // the provider honours the key: the same call again sends nothing new
  await w.email.send(sent[0]!);
  assert.equal(w.email.outbox().length, 1);

  const mail = w.email.outbox()[0]!;
  assert.match(mail.subject, /Slow Morning Studio/);
  assert.ok(mail.text.includes(orderId), 'order reference for the buyer');
  assert.ok(mail.text.includes('A$14.00'));
  const token = w.tokenIn(mail);
  assert.ok(token);
  assert.ok(mail.text.includes(`/api/aimp/fulfilment/download/${token}`));
  // the link is the files service's own grant token and it returns exactly store A's approved file
  const r = await w.files.redeem(token);
  assert.ok(r.ok);
  assert.equal(r.grantId, grant.id);
  assert.deepEqual(Buffer.from(r.file.bytes), Buffer.from(a.master.bytes));
  // nothing about where the master is stored
  const path = fileKeyPath({ workspaceId: a.workspaceId, businessId: a.businessId, productId: a.productId, version: a.productVersion });
  for (const secret of [path, a.workspaceId, a.businessId, a.productId, a.master.fileName, a.sellerAccountId]) {
    assert.equal(mail.text.includes(secret), false, `email must not contain ${secret}`);
    assert.equal(mail.subject.includes(secret), false);
  }
  // and the audit log holds ids only, never the link
  const audit = await w.fulfilment.audit(a.scope);
  assert.deepEqual(audit.map((x) => x.event), ['fulfilment_created', 'delivery_started', 'delivered']);
  assert.ok(audit.every((x) => !JSON.stringify(x).includes(token) && !JSON.stringify(x).includes('buyer-a@example.test')));
  assert.equal(JSON.stringify(f).includes(token), false, 'the token is not stored on the fulfilment');
  assert.equal(JSON.stringify(await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId)).includes(token), false);
});

test('a failed delivery leaves the fulfilment failed and retryable; the retry delivers without a second entitlement', async () => {
  const { w, clock } = await world();
  const a = w.stores.a;
  w.email.failNext(1);
  const { orderId, event } = await w.buy('a');
  let f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'failed');
  assert.equal(f.attempts, 1);
  assert.equal(f.delivery.lastError, 'email_failed');
  assert.equal(f.delivery.deliveredAt, null);
  assert.equal(w.email.outbox().length, 0);
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'paid', 'the order stays paid');
  const ent1 = (await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))!;
  assert.equal((await w.fulfilment.listStoreOrders(a.scope))[0]?.fulfilmentStatus, 'failed');
  // the provider replaying the paid event does not retry by itself and creates nothing
  assert.equal((await w.checkout.handlePaymentEvent(event)).outcome, 'duplicate_event');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.attempts, 1);

  clock.t += 60_000;
  const r = await w.fulfilment.retryDelivery(a.scope, orderId);
  assert.equal(r.outcome, 'delivered');
  f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'delivered');
  assert.equal(f.attempts, 2);
  assert.equal(f.delivery.lastError, null);
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.trigger, x.outcome, x.error]), [[1, 'paid_event', 'failed', 'email_failed'], [2, 'retry', 'delivered', null]]);
  const ent2 = (await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))!;
  assert.equal(ent2.id, ent1.id, 'same entitlement');
  // the retry reuses the grant of the failed attempt (same link, same email key) instead of replacing it
  assert.deepEqual(await counts(w, 'a', orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 1 });
  assert.deepEqual(f.attemptLog.map((x) => x.grantId), [ent1.grantId, ent1.grantId]);
  const active = (await grantsOf(w, 'a', orderId)).find((g) => g.revokedAt === null)!;
  assert.equal(ent2.grantId, active.id, 'the entitlement points at the one working link');
  const token = w.tokenIn(w.email.outbox()[0]!);
  assert.ok((await w.files.redeem(token)).ok);

  // a further retry sends nothing
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'already_delivered');
  assert.equal(w.email.outbox().length, 1);
  assert.equal(w.email.attempts(), 2);
  const events = (await w.fulfilment.audit(a.scope)).map((x) => `${x.event}:${x.actor}:${x.reason ?? ''}`);
  assert.ok(events.includes('delivery_failed:system:payment-event:email_failed'));
  assert.ok(events.includes('retry_requested:owner-a:'));
  assert.ok(events.includes('delivered:owner-a:'));
});

test('retries are bounded and recorded; after the cap the order is parked for the owner and nothing more is sent', async () => {
  const { w } = await world({ maxAttempts: 3 });
  const a = w.stores.a;
  w.email.failNext(50);
  const { orderId } = await w.buy('a');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'failed');
  const third = await w.fulfilment.retryDelivery(a.scope, orderId);
  assert.equal(third.outcome, 'needs_review');
  assert.equal(third.error, 'email_failed');
  for (let i = 0; i < 3; i++) assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'retries_exhausted');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId }, { trigger: 'job' })).outcome, 'retries_exhausted');
  assert.equal(w.email.attempts(), 3, 'no fourth send');
  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'needs_review');
  assert.equal(f.attempts, 3);
  assert.equal(f.maxAttempts, 3);
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.outcome, x.error]), [[1, 'failed', 'email_failed'], [2, 'failed', 'email_failed'], [3, 'failed', 'email_failed']]);
  assert.ok(f.attemptLog.every((x) => x.startedAt && x.finishedAt));
  const row = (await w.fulfilment.listStoreOrders(a.scope))[0]!;
  assert.equal(row.needsOwner, true);
  assert.equal(row.fulfilmentStatus, 'needs_review');
  const audit = await w.fulfilment.audit(a.scope);
  assert.equal(audit.filter((x) => x.event === 'delivery_failed').length, 2);
  assert.equal(audit.filter((x) => x.event === 'delivery_needs_review').length, 1);
  assert.equal(audit.filter((x) => x.event === 'retry_refused' && x.reason === 'retries_exhausted' && x.actor === 'owner-a').length, 3);
  // every attempt used the one grant: retries no longer mint a new link each time
  assert.deepEqual(await counts(w, 'a', orderId), { fulfilments: 1, grants: 1, activeGrants: 1, emails: 0 });
  // the cap can never be configured above 5
  const big = await createFulfilmentWorld({ maxAttempts: 99 });
  big.email.failNext(50);
  const o = await big.buy('a');
  assert.equal((await big.fulfilmentStore.get(big.stores.a.workspaceId, o.orderId))?.maxAttempts, 5);
});

test('email switched off fails retryably; a missing or changed master file is parked for the owner at once', async () => {
  let off = true;
  const { w } = await world({ emailLookup: (flaky) => (off ? null : flaky) });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  let f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'failed');
  assert.equal(f.delivery.lastError, 'email_unavailable');
  off = false;
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'delivered');

  const realGet = w.storage.getMaster;
  w.storage.getMaster = async () => null;
  const second = await w.buy('a');
  f = (await w.fulfilmentStore.get(a.workspaceId, second.orderId))!;
  assert.equal(f.status, 'needs_review');
  assert.equal(f.attempts, 1);
  assert.equal(f.delivery.lastError, 'file_missing');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, second.orderId)).outcome, 'retries_exhausted');
  w.storage.getMaster = realGet;
  assert.equal(w.email.outbox().length, 1, 'only the first order was emailed');
});

test('a delivery attempt that died mid-way is taken over after its lease, not before', async () => {
  const { w, clock } = await world({ attach: false, leaseMs: 30_000 });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const ref = { workspaceId: a.workspaceId, orderId };
  await w.fulfilment.recordPaidOrder(ref);
  // a worker takes the lease and dies before sending anything
  const dead = await w.fulfilmentStore.claimAttempt(a.workspaceId, orderId, { at: new Date(clock.t).toISOString(), leaseUntil: new Date(clock.t + 30_000).toISOString(), trigger: 'job' });
  assert.equal(dead?.status, 'delivering');
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref)).outcome, 'in_progress');
  assert.equal(w.email.attempts(), 0);
  clock.t += 30_000;
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref)).outcome, 'delivered');
  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.outcome]), [[1, 'abandoned'], [2, 'delivered']]);
  assert.equal(w.email.outbox().length, 1);
});
