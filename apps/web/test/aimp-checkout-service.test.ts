import assert from 'node:assert/strict';
import test from 'node:test';
import { build, DEMO_STORES } from '../lib/aimp/checkout/demo.ts';
import type { CheckoutRuntime } from '../lib/aimp/checkout/demo.ts';
import { createCheckoutHandler } from '../lib/aimp/checkout/handlers.ts';
import { createCheckoutService } from '../lib/aimp/checkout/service.ts';
import type { CheckoutRequest, CheckoutResult } from '../lib/aimp/checkout/service.ts';

const WS = 'demo-workspace';
const setup = async (env: Record<string, string | undefined> = {}) => build(env);
const row = (rt: CheckoutRuntime, key: string) => { const r = rt.listings.find((l) => l.key === key); assert.ok(r); return r; };
const req = (rt: CheckoutRuntime, key: string, over: Partial<CheckoutRequest> = {}): CheckoutRequest => ({
  storeSlug: row(rt, key).storeSlug, listingId: row(rt, key).listingId, buyerEmail: 'buyer@example.test', idempotencyKey: 'k1', ...over,
});
const refused = (r: CheckoutResult, code: string) => { assert.equal(r.ok, false); assert.equal(r.ok === false && r.code, code); };

test('checkout resolves price, product and seller from the server and ignores what the client sends', async () => {
  const rt = await setup();
  const stored = await rt.d.catalogue.getCheckoutPrice({ workspaceId: WS, actorUserId: 'x', idempotencyKey: 'x' }, row(rt, 'ready-approved').listingId);
  // Extra fields (price, seller, workspace) are smuggled in; the type does not even have them.
  const sneaky = { ...req(rt, 'ready-approved'), priceMinor: 1, amountMinor: 1, sellerAccountId: 'acct_attacker', workspaceId: 'other', productId: 'other' } as CheckoutRequest;
  const r = await rt.checkout.startCheckout(sneaky);
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.equal(r.amountMinor, stored.priceMinor);
  const o = await rt.orders.get(WS, r.orderId);
  assert.ok(o);
  assert.equal(o.amountMinor, stored.priceMinor);
  assert.equal(o.productId, stored.productId);
  assert.equal(o.productVersion, stored.productVersion);
  assert.equal(o.listingVersion, stored.listingVersion);
  assert.equal(o.sellerAccountId, 'acct_demo_ready');
  assert.equal(o.workspaceId, WS);
  assert.equal(o.storeSlug, DEMO_STORES.ready);
});

test('the HTTP handler ignores a client price and seller too', async () => {
  const rt = await setup();
  const handler = createCheckoutHandler(() => rt.checkout);
  const body = { ...req(rt, 'ready-approved'), priceMinor: 1, sellerAccountId: 'acct_attacker' };
  const res = await handler(new Request('http://x.test/api/aimp/checkout', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal(res.status, 201);
  const j = (await res.json()) as { orderId: string; amountMinor: number; checkoutUrl: string };
  assert.ok(j.amountMinor > 1);
  assert.match(j.checkoutUrl, /^https:\/\/checkout\.fixture\.invalid\//);
  const o = await rt.orders.get(WS, j.orderId);
  assert.equal(o?.sellerAccountId, 'acct_demo_ready');
});

test('a pending order exists before the buyer is redirected, and it is not paid or deliverable', async () => {
  const rt = await setup();
  const r = await rt.checkout.startCheckout(req(rt, 'ready-approved'));
  assert.ok(r.ok);
  const o = await rt.orders.get(WS, r.orderId);
  assert.equal(o?.status, 'pending');
  assert.equal(o?.checkoutSessionId, r.sessionId);
  assert.equal(o?.paidAt, null);
  assert.equal(o?.paidEventId, null);
});

test('checkout is refused when the listing is not approved, with no order written', async () => {
  const rt = await setup();
  refused(await rt.checkout.startCheckout(req(rt, 'ready-draft')), 'listing_not_available');
  assert.equal((await rt.orders.list(WS)).length, 0);
});

test('checkout is refused when the seller is not ready (sellers gate), with no order written', async () => {
  const rt = await setup();
  refused(await rt.checkout.startCheckout(req(rt, 'setup-approved')), 'seller_not_ready');
  assert.equal((await rt.orders.list(WS)).length, 0);
});

test('checkout is refused when payments are switched off', async () => {
  const rt = await setup({ AIMP_PAYMENTS_ENABLED: '0' });
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved')), 'provider_off');
  assert.equal((await rt.orders.list(WS)).length, 0);
});

test('checkout is refused for an unknown store, a listing from another store, and bad input', async () => {
  const rt = await setup();
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved', { storeSlug: 'nope' })), 'store_not_found');
  // The setup store's business does not own the ready store's listing.
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved', { storeSlug: DEMO_STORES.setup })), 'listing_not_available');
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved', { listingId: 'listing-does-not-exist' })), 'listing_not_available');
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved', { buyerEmail: 'not an email' })), 'invalid');
  refused(await rt.checkout.startCheckout(req(rt, 'ready-approved', { idempotencyKey: '' })), 'invalid');
  refused(await rt.checkout.startCheckout(null as unknown as CheckoutRequest), 'invalid');
  assert.equal((await rt.orders.list(WS)).length, 0);
});

test('retrying checkout with the same key returns the same order and session; a new key is a new order', async () => {
  const rt = await setup();
  const a = await rt.checkout.startCheckout(req(rt, 'ready-approved'));
  const b = await rt.checkout.startCheckout(req(rt, 'ready-approved'));
  assert.ok(a.ok && b.ok);
  assert.equal(b.orderId, a.orderId);
  assert.equal(b.sessionId, a.sessionId);
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal((await rt.orders.list(WS)).length, 1);
  const c = await rt.checkout.startCheckout(req(rt, 'ready-approved', { idempotencyKey: 'k2' }));
  assert.ok(c.ok);
  assert.notEqual(c.orderId, a.orderId);
});

test('concurrent checkouts with one key create one order', async () => {
  const rt = await setup();
  const rs = await Promise.all([1, 2, 3].map(() => rt.checkout.startCheckout(req(rt, 'ready-approved'))));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(new Set(rs.map((r) => r.ok && r.orderId)).size, 1);
  assert.equal((await rt.orders.list(WS)).length, 1);
});

test('if the provider cannot create a session the order is marked failed and the buyer is not redirected', async () => {
  const rt = await setup();
  const svc = createCheckoutService({
    stores: { resolve: async () => ({ workspaceId: WS, businessId: 'demo-business' }) }, catalogue: rt.d.catalogue, sellers: rt.sellers, orders: rt.orders,
    webhookSecret: rt.webhookSecret, returnUrls: () => ({ successUrl: 's', cancelUrl: 'c' }),
    payments: () => ({ status: rt.registry.payments.status, adapter: { ...rt.registry.payments.adapter!, createCheckoutSession: async () => { throw new Error('boom secret'); } } }),
  });
  const r = await svc.startCheckout(req(rt, 'ready-approved'));
  refused(r, 'session_failed');
  assert.ok(r.ok === false && !r.message.includes('boom'));
  const [o] = await rt.orders.list(WS);
  assert.equal(o?.status, 'failed');
});

test('handler returns 503 when checkout is not available and 400 on bad JSON; 404 and 409 for refusals', async () => {
  const rt = await setup();
  const post = (h: ReturnType<typeof createCheckoutHandler>, body: string) => h(new Request('http://x.test/api/aimp/checkout', { method: 'POST', body }));
  assert.equal((await post(createCheckoutHandler(() => null), '{}')).status, 503);
  assert.equal((await post(createCheckoutHandler(() => { throw new Error('config'); }), '{}')).status, 503);
  const h = createCheckoutHandler(() => rt.checkout);
  assert.equal((await post(h, 'not json')).status, 400);
  assert.equal((await post(h, JSON.stringify(req(rt, 'ready-draft')))).status, 404);
  assert.equal((await post(h, JSON.stringify(req(rt, 'setup-approved')))).status, 409);
  assert.equal((await post(h, JSON.stringify({ ...req(rt, 'ready-approved'), pad: 'x'.repeat(5000) }))).status, 413);
});
