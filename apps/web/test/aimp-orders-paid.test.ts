import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../lib/aimp/checkout/demo.ts';
import type { CheckoutRuntime } from '../lib/aimp/checkout/demo.ts';
import { buildSessionCompletedBody, paySessionWithFixture } from '../lib/aimp/checkout/fixture-events.ts';
import { createPaymentWebhookHandler } from '../lib/aimp/checkout/handlers.ts';
import { FIXTURE_WEBHOOK_SECRET, signPayload, verifySignature } from '../lib/aimp/checkout/signature.ts';
import { createFilesService } from '../lib/aimp/files/service.ts';
import { createMemoryFileStorage } from '../lib/aimp/files/storage.ts';
import { FilesError } from '../lib/aimp/files/types.ts';
import { isDeliverable, orderItemId } from '../lib/aimp/orders/index.ts';

const WS = 'demo-workspace';
const NOW = new Date('2026-11-14T10:00:00Z');

async function startOrder(rt: CheckoutRuntime, key = 'k1') {
  const l = rt.listings.find((x) => x.key === 'ready-approved');
  assert.ok(l);
  const r = await rt.checkout.startCheckout({ storeSlug: l.storeSlug, listingId: l.listingId, buyerEmail: 'buyer@example.test', idempotencyKey: key });
  assert.ok(r.ok);
  return r;
}
const pay = (rt: CheckoutRuntime, sessionId: string) => paySessionWithFixture(rt.registry.payments.adapter!, sessionId, rt.webhookSecret, new Date());

test('signatures: valid verifies; wrong secret, tampered body, stale time and junk headers do not', () => {
  const body = '{"a":1}';
  const t = Math.floor(NOW.getTime() / 1000);
  const good = signPayload('whsec_x', body, t);
  const ok = (header: string | null, rawBody = body, secret = 'whsec_x', nowSeconds = t) => verifySignature({ secret, rawBody, header, nowSeconds });
  assert.equal(ok(good), true);
  assert.equal(ok(good, '{"a":2}'), false);
  assert.equal(ok(good, body, 'whsec_y'), false);
  assert.equal(ok(good, body, 'whsec_x', t + 301), false);
  assert.equal(ok(null), false);
  assert.equal(ok(''), false);
  assert.equal(ok(`t=${t}`), false);
  assert.equal(ok(`t=${t},v1=zz`), false);
  assert.equal(ok(`v1=${good.split('v1=')[1]}`), false);
});

test('an order is paid only by a verified event; forged, tampered, stale and unsigned events change nothing', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const ev = await pay(rt, o.sessionId);
  const now = Math.floor(Date.now() / 1000);
  const forged = signPayload('whsec_wrong', ev.rawBody, now);
  assert.equal((await rt.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: forged })).outcome, 'bad_signature');
  assert.equal((await rt.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: null })).outcome, 'bad_signature');
  assert.equal((await rt.checkout.handlePaymentEvent({ rawBody: ev.rawBody.replace('"paid"', '"paid" '), signature: ev.signature })).outcome, 'bad_signature');
  const old = signPayload(FIXTURE_WEBHOOK_SECRET, ev.rawBody, now - 3600);
  assert.equal((await rt.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: old })).outcome, 'bad_signature');
  assert.equal((await rt.orders.get(WS, o.orderId))?.status, 'pending');
  assert.equal(rt.deliveryQueue.length, 0);

  const r = await rt.checkout.handlePaymentEvent({ rawBody: ev.rawBody, signature: ev.signature });
  assert.deepEqual(r, { outcome: 'paid', orderId: o.orderId });
  const paid = await rt.orders.get(WS, o.orderId);
  assert.equal(paid?.status, 'paid');
  assert.equal(paid?.paidEventId, ev.eventId);
  assert.ok(paid?.paidAt);
});

test('replaying an event, or a second event for the same session, never pays twice', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const ev = await pay(rt, o.sessionId);
  assert.equal((await rt.checkout.handlePaymentEvent(ev)).outcome, 'paid');
  const firstPaidAt = (await rt.orders.get(WS, o.orderId))?.paidAt;
  // same event id again
  assert.equal((await rt.checkout.handlePaymentEvent(ev)).outcome, 'duplicate_event');
  // a different event id for the same checkout session
  const second = await pay(rt, o.sessionId);
  assert.notEqual(second.eventId, ev.eventId);
  assert.equal((await rt.checkout.handlePaymentEvent(second)).outcome, 'already_paid');
  assert.equal((await rt.checkout.handlePaymentEvent(second)).outcome, 'duplicate_event');
  const orders = await rt.orders.list(WS);
  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.paidEventId, ev.eventId);
  assert.equal(orders[0]?.paidAt, firstPaidAt);
  assert.deepEqual(rt.deliveryQueue, [o.orderId]); // the paid hook fired exactly once
});

test('simultaneous deliveries of one event pay once', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const ev = await pay(rt, o.sessionId);
  const rs = await Promise.all([1, 2, 3, 4].map(() => rt.checkout.handlePaymentEvent(ev)));
  assert.equal(rs.filter((r) => r.outcome === 'paid').length, 1);
  assert.deepEqual(rt.deliveryQueue, [o.orderId]);
});

test('events that do not match a pending order do not pay it or create one', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const t = Math.floor(Date.now() / 1000);
  const send = (rawBody: string) => rt.checkout.handlePaymentEvent({ rawBody, signature: signPayload(rt.webhookSecret, rawBody, t) });
  const body = (over: Partial<Parameters<typeof buildSessionCompletedBody>[0]> = {}) => buildSessionCompletedBody({ eventId: 'evt_x1', sessionId: o.sessionId, amountMinor: o.amountMinor, createdSeconds: t, ...over });
  assert.equal((await send(body({ amountMinor: 1 }))).outcome, 'amount_mismatch');
  assert.equal((await send(body({ currency: 'usd', eventId: 'evt_x2' }))).outcome, 'amount_mismatch');
  assert.equal((await send(body({ paymentStatus: 'unpaid', eventId: 'evt_x3' }))).outcome, 'invalid');
  assert.equal((await send(body({ sessionId: 'cs_unknown', eventId: 'evt_x4' }))).outcome, 'unknown_session');
  assert.equal((await send('{"id":"evt_x5","type":"invoice.paid"}')).outcome, 'unsupported_type');
  assert.equal((await send('not json')).outcome, 'invalid');
  assert.equal((await send('{"id":"evt_x6","type":"checkout.session.completed","data":{}}')).outcome, 'invalid');
  assert.equal((await rt.orders.get(WS, o.orderId))?.status, 'pending');
  assert.equal((await rt.orders.list(WS)).length, 1);
  assert.equal(rt.deliveryQueue.length, 0);
  // the earlier mismatched event ids were not burned: the real event still pays
  assert.equal((await send(body({ eventId: 'evt_x1' }))).outcome, 'paid');
});

test('a failing paid-hook subscriber does not undo the paid order', async () => {
  const rt = await setup();
  rt.checkout.onOrderPaid(() => { throw new Error('delivery down'); });
  const o = await startOrder(rt);
  assert.equal((await rt.checkout.handlePaymentEvent(await pay(rt, o.sessionId))).outcome, 'paid');
  assert.equal((await rt.orders.get(WS, o.orderId))?.status, 'paid');
});

test('the webhook route: 400 for a bad signature, 200 for paid and for replays, 503 when unavailable', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const ev = await pay(rt, o.sessionId);
  const h = createPaymentWebhookHandler(() => rt.checkout);
  const post = (handler: typeof h, raw: string, sig: string | null) =>
    handler(new Request('http://x.test/api/aimp/webhooks/payments', { method: 'POST', body: raw, headers: sig ? { 'stripe-signature': sig } : {} }));
  assert.equal((await post(h, ev.rawBody, 'v1=abc')).status, 400);
  assert.equal((await post(h, ev.rawBody, null)).status, 400);
  assert.equal((await rt.orders.get(WS, o.orderId))?.status, 'pending');
  const ok = await post(h, ev.rawBody, ev.signature);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { outcome: string }).outcome, 'paid');
  const again = await post(h, ev.rawBody, ev.signature);
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { outcome: string }).outcome, 'duplicate_event');
  assert.equal((await post(createPaymentWebhookHandler(() => null), ev.rawBody, ev.signature)).status, 503);
  assert.equal((await post(h, 'x'.repeat(70_000), ev.signature)).status, 413);
});

test('delivery hook state: an unpaid order is not deliverable and the files service refuses it; paid becomes deliverable', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  const item = orderItemId(o.orderId);
  const pending = await rt.orderBook.getItem(item);
  assert.equal(pending?.orderStatus, 'pending');
  assert.equal(isDeliverable((await rt.orders.get(WS, o.orderId))!), false);
  // The real files service (AMP-024) reads the order book; it refuses a pending order before touching any product or file.
  const untouched = { getVersion: async () => { throw new Error('should not be reached'); }, listVersions: async () => { throw new Error('should not be reached'); } };
  const files = createFilesService({ storage: createMemoryFileStorage(), orders: rt.orderBook, products: untouched as never, secret: 'test-secret-test-secret-test-secret-1234' });
  await assert.rejects(files.issueGrant({ workspaceId: WS, businessId: pending!.businessId, actorId: 'system' }, item), (e: unknown) => e instanceof FilesError && e.code === 'order_not_paid');

  await rt.checkout.handlePaymentEvent(await pay(rt, o.sessionId));
  assert.equal((await rt.orderBook.getItem(item))?.orderStatus, 'paid');
  assert.equal(isDeliverable((await rt.orders.get(WS, o.orderId))!), true);
  const ref = await rt.orderBook.getItem(item);
  assert.equal(ref?.productVersion, (await rt.orders.get(WS, o.orderId))?.productVersion);
});

test('order lookup is tenant scoped and the order book ignores unknown or malformed line ids', async () => {
  const rt = await setup();
  const o = await startOrder(rt);
  assert.equal(await rt.orders.get('other-workspace', o.orderId), null);
  assert.equal((await rt.orders.list('other-workspace')).length, 0);
  assert.equal(await rt.orderBook.getItem('nope'), null);
  assert.equal(await rt.orderBook.getItem(`${o.orderId}:item-2`), null);
  assert.equal(await rt.orderBook.getItem(undefined as unknown as string), null);
});

const setup = () => build({});
