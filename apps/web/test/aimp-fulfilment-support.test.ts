import assert from 'node:assert/strict';
import test from 'node:test';
import { signPayload } from '../lib/aimp/checkout/signature.ts';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentWorld, WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { createBuyerLookupHandler, createRefundWebhookHandler, createSupportHandler } from '../lib/aimp/fulfilment/handlers.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import type { MoneyEventInput } from '../lib/aimp/fulfilment/refund-events.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const HOUR = 3_600_000;
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock };
}
const grantsOf = (w: FulfilmentWorld, key: 'a' | 'b', orderId: string) => w.files.listGrants({ workspaceId: w.stores[key].workspaceId, businessId: w.stores[key].businessId }, orderItemId(orderId));
const lastToken = (w: FulfilmentWorld) => { const t = w.tokenIn(w.email.outbox().at(-1)!); assert.ok(t); return t; };
const reasonOf = async (w: FulfilmentWorld, token: string) => { const r = await w.files.redeem(token); return r.ok ? 'ok' : r.reason; };
let evN = 0;
async function moneyEvent(w: FulfilmentWorld, key: 'a' | 'b', orderId: string, type: MoneyEventInput['type'], over: Partial<MoneyEventInput> = {}) {
  const order = await w.orders.get(w.stores[key].workspaceId, orderId);
  assert.ok(order);
  return signMoneyEvent(w.webhookSecret, { eventId: `evt_money_${++evN}`, type, order, ...over }, w.now());
}

test('support reissues access for the right order: new link emailed, old link revoked, audit has actor and reason', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const oldToken = lastToken(w);
  assert.equal(await reasonOf(w, oldToken), 'ok');
  const r = await w.fulfilment.reissueAccess({ ...a.scope, actorId: 'support-jo' }, { orderId, reason: 'Buyer deleted the email' });
  assert.ok(r.ok);
  assert.equal(r.revokedGrantIds.length, 1);
  assert.equal(w.email.outbox().length, 2);
  const mail = w.email.outbox()[1]!;
  assert.equal(mail.to, 'buyer-a@example.test');
  assert.match(mail.subject, /new download link/);
  const newToken = lastToken(w);
  assert.notEqual(newToken, oldToken);
  assert.equal(await reasonOf(w, oldToken), 'revoked');
  const got = await w.files.redeem(newToken);
  assert.ok(got.ok);
  assert.deepEqual(Buffer.from(got.file.bytes), Buffer.from(a.master.bytes));

  const grants = await grantsOf(w, 'a', orderId);
  assert.equal(grants.filter((g) => g.revokedAt === null).length, 1);
  const ent = (await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))!;
  assert.equal(ent.grantId, r.grantId);
  assert.equal(ent.status, 'active');
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1, 'still one fulfilment');
  assert.equal(r.fulfilment.reissues, 1);
  assert.equal(r.fulfilment.attempts, 1, 'a reissue is not a delivery retry');
  assert.equal(r.fulfilment.delivery.emailIdempotencyKey, `aimp:fulfilment:${r.fulfilment.id}:reissue:${r.grantId}`);

  const entry = (await w.fulfilment.audit(a.scope)).find((x) => x.event === 'access_reissued');
  assert.ok(entry);
  assert.equal(entry.actor, 'support-jo');
  assert.equal(entry.reason, 'Buyer deleted the email');
  assert.equal(entry.orderId, orderId);
  assert.ok(entry.at);
  assert.equal(JSON.stringify(entry).includes(newToken), false);
  // the files service logged the revoke + reissue too
  const fileEvents = w.files.audit({ workspaceId: a.workspaceId, businessId: a.businessId }).map((x) => x.event);
  assert.ok(fileEvents.includes('grant_revoked') && fileEvents.includes('grant_reissued'));
});

test('reissue is refused for another store, another workspace, an unpaid order, a refunded order and a missing reason', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const paid = await w.buy('a');
  const token = lastToken(w);
  const pending = await w.startOrder('a');
  const emails = () => w.email.outbox().length;
  const refused = async (p: ReturnType<typeof w.fulfilment.reissueAccess>, code: string) => { const r = await p; assert.equal(r.ok, false); assert.equal(r.ok === false && r.code, code); };

  // store B's owner, and an owner in A's workspace but of a different store
  await refused(w.fulfilment.reissueAccess(b.scope, { orderId: paid.orderId, reason: 'Trying another store' }), 'order_not_found');
  await refused(w.fulfilment.reissueAccess({ ...a.scope, businessId: 'biz-other-store' }, { orderId: paid.orderId, reason: 'Same workspace, other store' }), 'order_not_found');
  // a forged scope mixing B's workspace with A's business id
  await refused(w.fulfilment.reissueAccess({ ...b.scope, businessId: a.businessId }, { orderId: paid.orderId, reason: 'Forged scope' }), 'order_not_found');
  await refused(w.fulfilment.reissueAccess(a.scope, { orderId: pending.orderId, reason: 'Not paid yet' }), 'order_not_paid');
  await refused(w.fulfilment.reissueAccess(a.scope, { orderId: 'ord_unknown', reason: 'No such order' }), 'order_not_found');
  await refused(w.fulfilment.reissueAccess(a.scope, { orderId: paid.orderId, reason: '' }), 'invalid');
  await refused(w.fulfilment.reissueAccess(a.scope, { orderId: paid.orderId, reason: 'x'.repeat(301) }), 'invalid');
  await refused(w.fulfilment.reissueAccess({ ...a.scope, actorId: '' }, { orderId: paid.orderId, reason: 'No actor' }), 'invalid');
  assert.equal(emails(), 1, 'nothing was emailed by a refused reissue');
  assert.equal(await reasonOf(w, token), 'ok', 'the existing link was not touched');
  assert.equal((await grantsOf(w, 'a', paid.orderId)).length, 1);
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1, 'no fulfilment was created for the unpaid order');

  // refusals are audited under the caller's own store, with the actor; store A's log shows no entry from B
  const bLog = await w.fulfilment.audit(b.scope);
  assert.deepEqual(bLog.map((x) => [x.event, x.reason, x.actor]), [['reissue_refused', 'order_not_found', 'owner-b']]);
  const aLog = await w.fulfilment.audit(a.scope);
  assert.ok(aLog.some((x) => x.event === 'reissue_refused' && x.reason === 'order_not_paid' && x.actor === 'owner-a'));
  assert.ok(aLog.every((x) => x.actor !== 'owner-b'));

  // refunded
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', paid.orderId, 'charge.refunded'))).outcome, 'refunded');
  await refused(w.fulfilment.reissueAccess(a.scope, { orderId: paid.orderId, reason: 'Buyer asks again after refund' }), 'order_refunded');
  assert.equal(emails(), 1);
  assert.equal((await grantsOf(w, 'a', paid.orderId)).filter((g) => g.revokedAt === null).length, 0);
});

test('an old link expires per the files service; reissue gives a working one; email off leaves the old link alone', async () => {
  let off = false;
  const { w, clock } = await world({ emailLookup: (flaky) => (off ? null : flaky) });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const first = lastToken(w);
  off = true;
  const r0 = await w.fulfilment.reissueAccess(a.scope, { orderId, reason: 'Email is off' });
  assert.equal(r0.ok === false && r0.code, 'email_unavailable');
  assert.equal(await reasonOf(w, first), 'ok', 'not revoked for nothing');
  off = false;
  clock.t += 73 * HOUR;
  assert.equal(await reasonOf(w, first), 'expired');
  // a failing email provider: the refusal is recorded and the next try works
  w.email.failNext(1);
  const r1 = await w.fulfilment.reissueAccess(a.scope, { orderId, reason: 'Link expired' });
  assert.equal(r1.ok === false && r1.code, 'email_failed');
  const r2 = await w.fulfilment.reissueAccess(a.scope, { orderId, reason: 'Link expired' });
  assert.ok(r2.ok);
  assert.equal(await reasonOf(w, lastToken(w)), 'ok');
  assert.equal((await grantsOf(w, 'a', orderId)).filter((g) => g.revokedAt === null).length, 1);
});

test('order history is per store: statuses for the owner, and neither store can see the other', async () => {
  const { w, clock } = await world();
  const { a, b } = w.stores;
  const a1 = await w.buy('a'); clock.t += 1000;
  w.email.failNext(1);
  const a2 = await w.buy('a'); clock.t += 1000;
  const a3 = await w.startOrder('a'); clock.t += 1000;
  const b1 = await w.buy('b');

  const rowsA = await w.fulfilment.listStoreOrders(a.scope);
  assert.deepEqual(rowsA.map((r) => [r.orderId, r.orderStatus, r.fulfilmentStatus, r.attempts]), [
    [a3.orderId, 'pending', 'none', 0], [a2.orderId, 'paid', 'failed', 1], [a1.orderId, 'paid', 'delivered', 1],
  ]);
  assert.equal(rowsA[2]!.productVersion, a.productVersion);
  assert.ok(rowsA[2]!.deliveredAt);
  assert.equal(rowsA[1]!.lastError, 'email_failed');
  const rowsB = await w.fulfilment.listStoreOrders(b.scope);
  assert.deepEqual(rowsB.map((r) => r.orderId), [b1.orderId]);
  assert.equal(rowsB[0]!.productId, b.productId);

  // B asking for A's records gets nothing, by any route
  assert.equal(await w.fulfilment.getStoreOrder(b.scope, a1.orderId), null);
  assert.equal(await w.fulfilmentStore.get(b.workspaceId, a1.orderId), null);
  assert.equal(await w.fulfilmentStore.getEntitlement(b.workspaceId, a1.orderId), null);
  assert.equal((await w.fulfilment.retryDelivery(b.scope, a2.orderId)).outcome, 'order_not_found');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, a2.orderId))?.attempts, 1, 'B could not trigger a retry of A');
  assert.deepEqual(await w.fulfilment.listStoreOrders({ ...b.scope, businessId: a.businessId }), [], 'B workspace + A business id');
  assert.deepEqual(await w.fulfilment.listStoreOrders({ ...a.scope, businessId: 'biz-other-store' }), [], 'another store in A workspace');
  assert.deepEqual(await w.fulfilment.listStoreOrders({ workspaceId: '', businessId: '', actorId: '' }), []);
  const bText = JSON.stringify([rowsB, await w.fulfilment.audit(b.scope), await w.fulfilmentStore.list(b.workspaceId), await w.fulfilmentStore.listAudit(b.workspaceId), await w.fulfilment.listNeedsOwner(b.scope)]);
  for (const id of [a1.orderId, a2.orderId, a3.orderId, a.productId, 'buyer-a@example.test']) assert.equal(bText.includes(id), false);
  // and A's own detail view works
  const detail = await w.fulfilment.getStoreOrder(a.scope, a1.orderId);
  assert.ok(detail);
  assert.equal(detail.fulfilment?.status, 'delivered');
  assert.equal(detail.entitlement?.productVersion, a.productVersion);
  assert.equal(detail.grants.length, 1);
});

test('a buyer finds their own order by reference + email, and nothing else', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const { orderId } = await w.buy('a', { email: 'Sam.Buyer@example.test' });
  const view = await w.fulfilment.lookupBuyerOrder({ storeSlug: a.slug, reference: orderId, email: ' sam.buyer@EXAMPLE.test ' });
  assert.deepEqual(view, {
    reference: orderId, title: 'Wedding Planning Printable planner', amountMinor: 1400, currency: 'AUD', placedAt: new Date(START).toISOString(),
    orderStatus: 'paid', delivery: 'sent', deliveredAt: new Date(START).toISOString(), productVersion: a.productVersion,
  });
  const none = async (i: { storeSlug: string; reference: string; email: string }) => assert.equal(await w.fulfilment.lookupBuyerOrder(i), null);
  await none({ storeSlug: a.slug, reference: orderId, email: 'someone.else@example.test' });
  await none({ storeSlug: b.slug, reference: orderId, email: 'sam.buyer@example.test' });
  await none({ storeSlug: 'no-such-store', reference: orderId, email: 'sam.buyer@example.test' });
  await none({ storeSlug: a.slug, reference: 'ord_guess', email: 'sam.buyer@example.test' });
  await none({ storeSlug: a.slug, reference: orderId, email: 'not-an-email' });
  await none({ storeSlug: a.slug, reference: 'bad ref\n', email: 'sam.buyer@example.test' });
  await none(null as unknown as { storeSlug: string; reference: string; email: string });
  // a pending order shows as not sent; a refunded one as withdrawn
  const p = await w.startOrder('a', { email: 'sam.buyer@example.test' });
  assert.equal((await w.fulfilment.lookupBuyerOrder({ storeSlug: a.slug, reference: p.orderId, email: 'sam.buyer@example.test' }))?.delivery, 'not_sent');
  await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', orderId, 'charge.refunded'));
  const after = await w.fulfilment.lookupBuyerOrder({ storeSlug: a.slug, reference: orderId, email: 'sam.buyer@example.test' });
  assert.equal(after?.delivery, 'access_withdrawn');
  assert.equal(after?.orderStatus, 'refunded');
});

test('a verified refund marks the order refunded, revokes download access and is applied once', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const token = lastToken(w);
  const other = await w.buy('a');
  const otherToken = lastToken(w);
  const ev = await moneyEvent(w, 'a', orderId, 'charge.refunded');

  // unverified refund events change nothing
  const secs = Math.floor(START / 1000);
  assert.equal((await w.fulfilment.handleRefundEvent({ rawBody: ev.rawBody, signature: signPayload('whsec_wrong', ev.rawBody, secs) })).outcome, 'bad_signature');
  assert.equal((await w.fulfilment.handleRefundEvent({ rawBody: ev.rawBody, signature: null })).outcome, 'bad_signature');
  assert.equal((await w.fulfilment.handleRefundEvent({ rawBody: ev.rawBody.replace('"refunded":true', '"refunded":true '), signature: ev.signature })).outcome, 'bad_signature');
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'paid');
  assert.equal(await reasonOf(w, token), 'ok');

  // the real one, delivered four times at once and then replayed
  const rs = await Promise.all([1, 2, 3, 4].map(() => w.fulfilment.handleRefundEvent(ev)));
  assert.deepEqual(rs.map((r) => r.outcome).sort(), ['duplicate_event', 'duplicate_event', 'duplicate_event', 'refunded']);
  assert.equal((await w.fulfilment.handleRefundEvent(ev)).outcome, 'duplicate_event');
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'refunded');
  assert.equal(await reasonOf(w, token), 'revoked');
  assert.equal((await grantsOf(w, 'a', orderId)).filter((g) => g.revokedAt === null).length, 0);
  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'revoked');
  const ent = (await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))!;
  assert.equal(ent.status, 'revoked');
  assert.ok(ent.revokedAt);
  const events = await w.fulfilmentStore.listMoneyEvents(a.workspaceId);
  assert.deepEqual(events.map((e) => [e.eventId, e.kind, e.outcome, e.needsOwner, e.orderId]), [[ev.eventId, 'refund', 'refunded', false, orderId]]);
  const audit = await w.fulfilment.audit(a.scope);
  assert.equal(audit.filter((x) => x.event === 'order_refunded' && x.orderId === orderId).length, 1);
  assert.equal(audit.filter((x) => x.event === 'access_revoked' && x.orderId === orderId).length, 1);
  assert.equal(audit.find((x) => x.event === 'order_refunded')?.actor, 'system:refund-event');

  // a second, different refund event for the same order is recorded but refunds nothing twice
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', orderId, 'charge.refunded'))).outcome, 'already_refunded');
  assert.equal((await w.fulfilment.audit(a.scope)).filter((x) => x.event === 'order_refunded').length, 1);
  // nothing can deliver or retry a refunded order
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId })).outcome, 'revoked');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'revoked');
  assert.equal(w.email.outbox().length, 2);
  // the other order of the same store is untouched
  assert.equal((await w.orders.get(a.workspaceId, other.orderId))?.status, 'paid');
  assert.equal(await reasonOf(w, otherToken), 'ok');
  const row = (await w.fulfilment.listStoreOrders(a.scope)).find((r) => r.orderId === orderId)!;
  assert.deepEqual([row.orderStatus, row.fulfilmentStatus, row.needsOwner], ['refunded', 'revoked', false]);
});

test('a refund event from the wrong seller account, for an unknown order, or of an unsupported type is ignored', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const { orderId } = await w.buy('a');
  const token = lastToken(w);
  // store B's connected account names store A's order in its metadata
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', orderId, 'charge.refunded', { account: b.sellerAccountId }))).outcome, 'unknown_order');
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', orderId, 'charge.refunded', { account: null }))).outcome, 'unknown_order');
  const order = (await w.orders.get(a.workspaceId, orderId))!;
  const ghost = signMoneyEvent(w.webhookSecret, { eventId: 'evt_ghost', type: 'charge.refunded', order: { ...order, id: 'ord_ghost' } }, w.now());
  assert.equal((await w.fulfilment.handleRefundEvent(ghost)).outcome, 'unknown_order');
  const wrongWs = signMoneyEvent(w.webhookSecret, { eventId: 'evt_wrong_ws', type: 'charge.refunded', order: { ...order, workspaceId: b.workspaceId } }, w.now());
  assert.equal((await w.fulfilment.handleRefundEvent(wrongWs)).outcome, 'unknown_order');
  const secs = Math.floor(START / 1000);
  const sign = (body: string) => ({ rawBody: body, signature: signPayload(w.webhookSecret, body, secs) });
  assert.equal((await w.fulfilment.handleRefundEvent(sign(JSON.stringify({ id: 'evt_x', type: 'customer.created', data: { object: {} } })))).outcome, 'unsupported_type');
  assert.equal((await w.fulfilment.handleRefundEvent(sign('not json'))).outcome, 'invalid');
  assert.equal((await w.fulfilment.handleRefundEvent(sign(JSON.stringify({ id: 'evt_y', type: 'charge.refunded', data: { object: { amount_refunded: 1400, currency: 'aud', refunded: true } } })))).outcome, 'invalid');
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'paid');
  assert.equal(await reasonOf(w, token), 'ok');
  assert.equal((await w.fulfilmentStore.listMoneyEvents(a.workspaceId)).length, 0);
  assert.equal((await w.fulfilment.audit(a.scope)).filter((x) => x.event === 'refund_event_ignored' && x.reason === 'seller_mismatch').length, 2);
});

test('disputes, partial refunds and refunds of unpaid orders are recorded for the owner and nothing is decided automatically', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const token = lastToken(w);
  const dispute = await moneyEvent(w, 'a', orderId, 'charge.dispute.created');
  assert.equal((await w.fulfilment.handleRefundEvent(dispute)).outcome, 'needs_owner');
  assert.equal((await w.fulfilment.handleRefundEvent(dispute)).outcome, 'duplicate_event');
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', orderId, 'charge.refunded', { amountRefundedMinor: 500 }))).outcome, 'needs_owner');
  const pending = await w.startOrder('a');
  assert.equal((await w.fulfilment.handleRefundEvent(await moneyEvent(w, 'a', pending.orderId, 'charge.refunded'))).outcome, 'needs_owner');

  // access, order status and fulfilment are exactly as they were
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'paid');
  assert.equal((await w.orders.get(a.workspaceId, pending.orderId))?.status, 'pending');
  assert.equal(await reasonOf(w, token), 'ok');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.status, 'delivered');
  assert.equal((await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))?.status, 'active');

  const queue = await w.fulfilment.listNeedsOwner(a.scope);
  assert.deepEqual(queue.map((e) => [e.kind, e.orderId, e.needsOwner, e.outcome]), [
    ['dispute', orderId, true, 'needs_owner'], ['partial_refund', orderId, true, 'needs_owner'], ['refund_exception', pending.orderId, true, 'needs_owner'],
  ]);
  assert.equal(queue[1]!.amountMinor, 500);
  assert.deepEqual(await w.fulfilment.listNeedsOwner(w.stores.b.scope), []);
  const rows = await w.fulfilment.listStoreOrders(a.scope);
  assert.ok(rows.every((r) => r.needsOwner));
  const audit = await w.fulfilment.audit(a.scope);
  assert.deepEqual(audit.filter((x) => x.event === 'needs_owner').map((x) => x.reason), ['dispute', 'partial_refund', 'refund_of_unpaid_order']);
  assert.equal(audit.some((x) => x.event === 'order_refunded' || x.event === 'access_revoked'), false);
});

test('HTTP handlers fail closed: no service 503, wrong origin 403, signed out 401, other store 404, bad signature 400', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const { orderId } = await w.buy('a');
  const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://x.test/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
  const yes = () => true;

  // refund webhook
  const hook = createRefundWebhookHandler(() => w.fulfilment);
  const ev = await moneyEvent(w, 'a', orderId, 'charge.dispute.created');
  assert.equal((await createRefundWebhookHandler(() => null)(post(ev.rawBody, { 'stripe-signature': ev.signature }))).status, 503);
  assert.equal((await createRefundWebhookHandler(() => { throw new Error('config'); })(post(ev.rawBody))).status, 503);
  assert.equal((await hook(post(ev.rawBody))).status, 400);
  assert.equal((await hook(post(ev.rawBody, { 'stripe-signature': 't=1,v1=00' }))).status, 400);
  assert.equal((await hook(post('x'.repeat(70_000), { 'stripe-signature': ev.signature }))).status, 413);
  const okRes = await hook(post(ev.rawBody, { 'stripe-signature': ev.signature }));
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { received: true, outcome: 'needs_owner' });
  assert.equal(okRes.headers.get('cache-control'), 'no-store');

  // buyer lookup
  const lookup = { storeSlug: a.slug, reference: orderId, email: 'buyer-a@example.test' };
  assert.equal((await createBuyerLookupHandler(() => null, { originOk: yes })(post(lookup))).status, 503);
  assert.equal((await createBuyerLookupHandler(() => w.fulfilment, { originOk: () => false })(post(lookup))).status, 403);
  const buyer = createBuyerLookupHandler(() => w.fulfilment, { originOk: yes });
  const found = await buyer(post(lookup));
  assert.equal(found.status, 200);
  const view = (await found.json()) as { order: Record<string, unknown> };
  assert.equal(view.order.reference, orderId);
  assert.deepEqual(Object.keys(view.order).sort(), ['amountMinor', 'currency', 'deliveredAt', 'delivery', 'orderStatus', 'placedAt', 'productVersion', 'reference', 'title']);
  const miss = await buyer(post({ ...lookup, email: 'wrong@example.test' }));
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { error: 'No order matches that reference and email.' });
  assert.equal((await buyer(post({ ...lookup, storeSlug: b.slug }))).status, 404);
  assert.equal((await buyer(post('nope'))).status, 400);
  assert.equal((await buyer(post([lookup]))).status, 400);
  assert.equal((await buyer(post({ pad: 'x'.repeat(5000) }))).status, 413);

  // support actions: the store comes from the session, never from the body
  const asA = createSupportHandler(() => w.fulfilment, { originOk: yes, authorize: () => ({ ...a.scope, actorId: 'support-jo' }) });
  const asB = createSupportHandler(() => w.fulfilment, { originOk: yes, authorize: () => b.scope });
  const reissue = { action: 'reissue', orderId, reason: 'Buyer lost the link', workspaceId: a.workspaceId, businessId: a.businessId };
  assert.equal((await createSupportHandler(() => null, { originOk: yes, authorize: () => a.scope })(post(reissue))).status, 503);
  assert.equal((await createSupportHandler(() => w.fulfilment, { originOk: () => false, authorize: () => a.scope })(post(reissue))).status, 403);
  assert.equal((await createSupportHandler(() => w.fulfilment, { originOk: yes, authorize: () => null })(post(reissue))).status, 401);
  assert.equal((await createSupportHandler(() => w.fulfilment, { originOk: yes, authorize: () => { throw new Error('session store down'); } })(post(reissue))).status, 401);
  const crossed = await asB(post(reissue)); // B's session, with A's ids typed into the body
  assert.equal(crossed.status, 404);
  assert.equal(w.email.outbox().length, 1);
  const done = await asA(post(reissue));
  assert.equal(done.status, 200);
  const doneBody = await done.text();
  assert.deepEqual(JSON.parse(doneBody), { ok: true, status: 'delivered', reissues: 1 });
  assert.equal(doneBody.includes(lastToken(w)), false, 'the link is emailed to the buyer, not returned to the caller');
  assert.equal(w.email.outbox().length, 2);
  assert.equal((await asA(post({ action: 'reissue', orderId, reason: '' }))).status, 400);
  assert.equal((await asA(post({ action: 'retry', orderId }))).status, 200);
  assert.equal((await asB(post({ action: 'retry', orderId }))).status, 404);
  assert.equal((await asA(post({ action: 'delete-everything' }))).status, 400);
  const listB = (await (await asB(post({ action: 'orders' }))).json()) as { orders: unknown[] };
  assert.deepEqual(listB.orders, []);
  const listA = (await (await asA(post({ action: 'orders' }))).json()) as { orders: { orderId: string }[] };
  assert.deepEqual(listA.orders.map((o) => o.orderId), [orderId]);
  assert.equal((await w.fulfilment.audit(a.scope)).find((x) => x.event === 'access_reissued')?.actor, 'support-jo');
});
