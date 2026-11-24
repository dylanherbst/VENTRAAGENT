// AMP-150: the Test purchase on the public store page, through the same functions the server action and the page call
// (app/s/[store]/_server/test-purchase.ts) with the real checkout, order store, registry and published-store loader. runtime.ts and
// the Next action file are not loadable in node, so their dependencies are passed in exactly as wiring.ts passes them.
// Fixture payment and email only: no Stripe, no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOrders, ordersSource } from '../app/app/[business]/orders/_server/orders.ts';
import type { OrdersRuntime } from '../app/app/[business]/orders/_server/orders.ts';
import { MAX_TEST_ORDERS_PER_BUSINESS, isTestOrder } from '../app/start/_server/checkout-runtime.ts';
import { createSampleOrders, createStartOrders, runTestPurchase, testPurchaseKey } from '../app/start/_server/orders-runtime.ts';
import { createMemoryOrderStore } from '../lib/aimp/orders/store.ts';
import type { NewOrder } from '../lib/aimp/orders/types.ts';
import type { SampleSource, StartOrders } from '../app/start/_server/orders-runtime.ts';
import { offerTestPurchase, submitTestPurchase } from '../app/s/[store]/_server/test-purchase.ts';
import type { TestPurchaseDeps } from '../app/s/[store]/_server/test-purchase.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { registryFromSiteVersions, registryWithStartRuntime } from '../lib/aimp/hosts/registry.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createSiteVersionStore, seedDemoSites } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { TEST_PURCHASE_LABEL, loadPublishedStore } from '../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const START = Date.parse('2026-11-14T10:00:00Z');
const ACTOR = { workspaceId: WORKSPACE, userId: OWNER };
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });

async function world(published: string[], businesses: Array<[string, string, string]>, opts: { toolsOn?: boolean } = {}) {
  const llm = createProviderRegistry({ env: {} }).llm;
  const productStore = createMemoryProductStore();
  const products = createProductService({ store: productStore, now: () => new Date(START), generateSpec: async () => { throw new Error('not used'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products, brands, assets, now: () => new Date(START) });
  const slugs = new Map<string, string>();
  const orderDemo = createStartOrders({ workspaceId: WORKSPACE, actorId: OWNER, productStore, catalogue, now: () => new Date(START) });
  const blueprint = blueprintRegistry.find('printable-planner');
  assert.ok(blueprint);
  for (const [businessId, niche, slug] of businesses) {
    const spec = await generateProductSpec({ blueprint, provider: llm, inputs: { niche, audience: 'Busy people', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } });
    const pctx = { workspaceId: WORKSPACE, actorId: OWNER };
    const { product, version } = await products.createProduct(pctx, { businessId, spec });
    await products.approve(pctx, version.id);
    for (const role of ['cover', 'preview', 'master'] as const) assets.add({ id: `${product.id}-${role}`, workspaceId: WORKSPACE, businessId, productId: product.id, role });
    const bd = { store: brands, now: () => new Date(START) };
    assert.ok((await createBrandDraft(bd, { workspaceId: WORKSPACE }, businessId, { niche, audience: 'Busy people', productTitle: spec.title, productType: 'printable planner', formats: ['PDF'] })).ok);
    assert.ok((await approveBrand(bd, { workspaceId: WORKSPACE }, businessId, OWNER)).ok);
    const octx = { workspaceId: WORKSPACE, actorUserId: OWNER, idempotencyKey: `t:${businessId}` };
    const draft = await catalogue.createDraft(octx, { businessId, productId: product.id });
    await catalogue.approveListing(octx, draft.listingId);
    slugs.set(businessId, slug);
  }
  const sites = createSiteVersionStore();
  for (const slug of published) {
    assert.ok((await sites.createSite(ACTOR, storeFor(slug))).ok);
    assert.ok((await sites.publish(ACTOR, slug)).ok);
  }
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  const src: SampleSource = { catalogue, products, slugs };
  const deps: TestPurchaseDeps = {
    availability: () => (opts.toolsOn === false ? { available: false, reason: 'Demo storage is switched off.' } : { available: true, reason: '' }),
    load: (slug) => loadPublishedStore(slug, registryWithStartRuntime(primary, () => ({ sites, slugs }))),
    world: async () => ({ so: orderDemo, src, origin: { primary, sites } }),
  };
  const rt: OrdersRuntime & { orderDemo: StartOrders } = { businesses: new Set(businesses.map((b) => b[0])), seeds: new Map(), slugs, productIds: new Map(), orderDemo };
  return { deps, orderDemo, rt, src };
}

test('the form is offered only for a store published from guided setup', async () => {
  const { deps } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const store = await deps.load('wedding-shop');
  assert.ok(store);
  assert.deepEqual(await offerTestPurchase(deps, store), { label: TEST_PURCHASE_LABEL });
  // a real store is never offered it
  assert.equal(await offerTestPurchase(deps, { ...store, demo: false, merchant: { chargesEnabled: true } }), null);
  // an address the runtime does not own
  assert.equal(await offerTestPurchase(deps, storeFor('somewhere-else')), null);
  // demo storage switched off
  const off = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']], { toolsOn: false });
  assert.equal(await offerTestPurchase(off.deps, store), null);
});

test('a built-in demo store is never offered the form and is refused by the action; nothing is created', async () => {
  const { deps, orderDemo } = await world([demoStore.slug], [['biz-a', 'Wedding planning', demoStore.slug]]);
  const store = await deps.load(demoStore.slug);
  assert.ok(store, 'the built-in demo store loads');
  assert.equal(await offerTestPurchase(deps, store), null);
  const r = await submitTestPurchase(deps, demoStore.slug, 'buyer@example.com');
  assert.equal(r.ok, false);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  assert.equal(orderDemo.email.outbox().length, 0);
});

test('the action creates a labelled order for the business that published the store, visible only to that business', async () => {
  const { deps, orderDemo, rt } = await world(['wedding-shop', 'garden-shop'], [['biz-a', 'Wedding planning', 'wedding-shop'], ['biz-b', 'Garden planning', 'garden-shop']]);
  const r = await submitTestPurchase(deps, 'wedding-shop', 'buyer@example.com');
  assert.ok(r.ok);
  assert.equal(r.label, TEST_PURCHASE_LABEL);
  const order = await orderDemo.orders.get(WORKSPACE, r.orderId);
  assert.equal(order?.businessId, 'biz-a');
  assert.ok(order && isTestOrder(order));
  const a = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.ok(a.found && a.available);
  assert.deepEqual(a.page.orders.map((o) => o.id), [r.orderId]);
  const b = await loadOrders(rt, ordersSource(rt), 'biz-b', { filter: 'all', cursor: null });
  assert.ok(b.found && b.available);
  assert.equal(b.page.orders.length, 0);
  assert.equal(await orderDemo.orders.get('other-workspace', r.orderId), null);
});

test('the action refuses bad input and unknown stores with a plain message', async () => {
  const { deps, orderDemo } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  for (const bad of [undefined, null, 42, '', '../x', 'a b', 'x'.repeat(200), { slug: 'wedding-shop' }]) {
    const r = await submitTestPurchase(deps, bad, 'buyer@example.com');
    assert.equal(r.ok, false);
  }
  const unknown = await submitTestPurchase(deps, 'no-such-store', 'buyer@example.com');
  assert.equal(unknown.ok === false && unknown.message, 'We could not find that store.');
  assert.equal((await submitTestPurchase(deps, 'wedding-shop', 'not-an-email')).ok, false);
  assert.equal((await submitTestPurchase(deps, 'wedding-shop', undefined)).ok, false);
  const off = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']], { toolsOn: false });
  const r = await submitTestPurchase(off.deps, 'wedding-shop', 'buyer@example.com');
  assert.equal(r.ok === false && r.message, 'Demo storage is switched off.');
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  assert.equal((await off.orderDemo.orders.list(WORKSPACE)).length, 0);
});

test('cap: one business holds at most MAX_TEST_ORDERS_PER_BUSINESS test orders, even from parallel requests; another business is not affected', async () => {
  const { deps, orderDemo } = await world(['wedding-shop', 'garden-shop'], [['biz-a', 'Wedding planning', 'wedding-shop'], ['biz-b', 'Garden planning', 'garden-shop']]);
  const tries = MAX_TEST_ORDERS_PER_BUSINESS + 3;
  const results = await Promise.all(Array.from({ length: tries }, (_, i) => submitTestPurchase(deps, 'wedding-shop', `buyer${i}@example.com`)));
  assert.equal(results.filter((r) => r.ok).length, MAX_TEST_ORDERS_PER_BUSINESS);
  const refused = results.filter((r) => !r.ok);
  assert.equal(refused.length, 3);
  assert.match(refused[0].ok ? '' : refused[0].message, /most allowed/);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).filter((o) => o.businessId === 'biz-a').length, MAX_TEST_ORDERS_PER_BUSINESS);
  // the form is no longer offered for that store, and a later request is still refused
  const store = await deps.load('wedding-shop');
  assert.ok(store);
  assert.equal(await offerTestPurchase(deps, store), null);
  assert.equal((await submitTestPurchase(deps, 'wedding-shop', 'late@example.com')).ok, false);
  // the other business still can
  assert.ok((await submitTestPurchase(deps, 'garden-shop', 'buyer@example.com')).ok);
});

test('AMP-162 cap: at the cap the reply is identical for an email that already has a test order and for a new one, so it reveals nothing about which addresses exist', async () => {
  const { deps, orderDemo } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const first: string[] = [];
  for (let i = 0; i < MAX_TEST_ORDERS_PER_BUSINESS; i++) {
    const r = await submitTestPurchase(deps, 'wedding-shop', `buyer${i}@example.com`);
    assert.ok(r.ok);
    first.push(r.orderId);
  }
  const mailBefore = orderDemo.email.outbox().length;
  assert.equal(first.length, MAX_TEST_ORDERS_PER_BUSINESS);
  const again = await submitTestPurchase(deps, 'wedding-shop', ' Buyer3@Example.com ');
  const fresh = await submitTestPurchase(deps, 'wedding-shop', 'brand-new@example.com');
  assert.equal(again.ok, false, 'an existing email is refused like any other');
  assert.equal(fresh.ok, false);
  assert.match(fresh.ok ? '' : fresh.message, /most allowed/);
  assert.deepEqual(again, fresh, 'the two replies are identical');
  assert.equal(orderDemo.email.outbox().length, mailBefore, 'no extra email');
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, MAX_TEST_ORDERS_PER_BUSINESS, 'no extra order was made');
  // the form itself stays hidden at the cap (no email is known when the page decides)
  const store = await deps.load('wedding-shop');
  assert.ok(store);
  assert.equal(await offerTestPurchase(deps, store), null);
});

test('AMP-152 cap: after the approved listing is replaced, a repeat email at the cap is refused like a new one and no order is made', async () => {
  const { deps, orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  for (let i = 0; i < MAX_TEST_ORDERS_PER_BUSINESS; i++) assert.ok((await submitTestPurchase(deps, 'wedding-shop', `buyer${i}@example.com`)).ok);
  const count = async () => (await orderDemo.orders.list(WORKSPACE)).length;
  assert.equal(await count(), MAX_TEST_ORDERS_PER_BUSINESS);
  const mailBefore = orderDemo.email.outbox().length;
  // The world cannot approve a second listing for the same product, so the approved lookup (the one the purchase uses) now answers a NEW listing id.
  const real = src.catalogue;
  (src as { catalogue: SampleSource['catalogue'] }).catalogue = Object.create(real, {
    listApprovedForBusiness: { value: async (...a: Parameters<typeof real.listApprovedForBusiness>) => (await real.listApprovedForBusiness(...a)).map((l) => ({ ...l, listingId: `${l.listingId}-replaced` })) },
  });
  const r = await submitTestPurchase(deps, 'wedding-shop', 'buyer3@example.com');
  assert.equal(r.ok, false, 'the held order is for the old listing');
  assert.match(r.ok ? '' : r.message, /most allowed/);
  assert.equal(await count(), MAX_TEST_ORDERS_PER_BUSINESS, 'no order was made');
  assert.equal(orderDemo.email.outbox().length, mailBefore);
});

test('AMP-152 cap: at the cap a sample buyer address is refused like any new email and no order is made; repeats keep the order count', async () => {
  const { deps, orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const made = await createSampleOrders(orderDemo, src, 'biz-a', 2);
  assert.ok(made.ok);
  const samples = (await orderDemo.orders.list(WORKSPACE)).length;
  assert.equal(samples, 2);
  const first: string[] = [];
  for (let i = 0; i < MAX_TEST_ORDERS_PER_BUSINESS - samples; i++) {
    const r = await submitTestPurchase(deps, 'wedding-shop', `buyer${i}@example.com`);
    assert.ok(r.ok);
    first.push(r.orderId);
  }
  const count = async () => (await orderDemo.orders.list(WORKSPACE)).length;
  assert.equal(await count(), MAX_TEST_ORDERS_PER_BUSINESS);
  for (const sample of ['sample-buyer-1@example.test', ' Sample-Buyer-2@Example.test ']) {
    const r = await submitTestPurchase(deps, 'wedding-shop', sample);
    assert.equal(r.ok, false, 'a sample buyer address is not an existing form order');
    assert.match(r.ok ? '' : r.message, /most allowed/);
    assert.equal(await count(), MAX_TEST_ORDERS_PER_BUSINESS, 'no order was made');
  }
  const again = await submitTestPurchase(deps, 'wedding-shop', ' Buyer1@Example.com ');
  assert.equal(again.ok, false, 'a repeat is refused like any email at the cap (AMP-162)');
  assert.match(again.ok ? '' : again.message, /most allowed/);
  assert.equal(first.length, MAX_TEST_ORDERS_PER_BUSINESS - samples);
  assert.equal(await count(), MAX_TEST_ORDERS_PER_BUSINESS);
});

test('AMP-152: the test flag is stored when the order is created, and the Orders label reads it; the seller id does not decide', async () => {
  const { deps, orderDemo, rt } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const r = await submitTestPurchase(deps, 'wedding-shop', 'buyer@example.com');
  assert.ok(r.ok);
  assert.equal((await orderDemo.orders.get(WORKSPACE, r.orderId))?.test, true, 'the flag is on the order record');
  const list = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.ok(list.found && list.available);
  assert.deepEqual(list.testIds, [r.orderId]);
  // An order made by any other path carries test: false, even with the sample seller id, and is not labelled.
  const plain = await orderDemo.checkout.startCheckout({ storeSlug: 'wedding-shop', listingId: (await orderDemo.orders.get(WORKSPACE, r.orderId))!.listingId, buyerEmail: 'plain@example.test', idempotencyKey: 'plain-key' });
  assert.ok(plain.ok);
  const stored = await orderDemo.orders.get(WORKSPACE, plain.orderId);
  assert.equal(stored?.test, false);
  assert.ok(stored && isTestOrder(stored), 'it does carry the sample seller id');
  const after = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.ok(after.found && after.available);
  assert.deepEqual(after.testIds, [r.orderId], 'only the order marked at creation is labelled');
});

test('AMP-162: sample orders are flagged on the record too; other creation paths leave the flag false', async () => {
  const { orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const made = await createSampleOrders(orderDemo, src, 'biz-a', 2);
  assert.ok(made.ok);
  for (const id of made.orderIds) assert.equal((await orderDemo.orders.get(WORKSPACE, id))?.test, true);
});

async function approvedListingId(src: SampleSource, businessId: string): Promise<string> {
  const ctx = { workspaceId: WORKSPACE, actorUserId: OWNER, idempotencyKey: `sample:${businessId}` };
  return (await src.catalogue.listApprovedForBusiness(ctx, businessId))[0]!.listingId;
}

test('AMP-162: a test purchase whose checkout is refused or throws leaves no intent, so a later ordinary order with the same key is stored real', async () => {
  for (const mode of ['refused', 'throws'] as const) {
    const { orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
    const real = orderDemo.checkout.startCheckout.bind(orderDemo.checkout);
    orderDemo.checkout.startCheckout = (async () => {
      if (mode === 'throws') throw new Error('boom');
      return { ok: false, message: 'refused' };
    }) as unknown as typeof orderDemo.checkout.startCheckout;
    const r = await runTestPurchase(orderDemo, src, 'biz-a', 'buyer@example.com');
    assert.equal(r.ok, false);
    assert.equal(orderDemo.testIntents.size, 0, `no intent left (${mode})`);
    orderDemo.checkout.startCheckout = real;
    const listingId = await approvedListingId(src, 'biz-a');
    const plain = await orderDemo.checkout.startCheckout({ storeSlug: 'wedding-shop', listingId, buyerEmail: 'plain@example.test', idempotencyKey: testPurchaseKey('biz-a', 'buyer@example.com') });
    assert.ok(plain.ok);
    assert.equal((await orderDemo.orders.get(WORKSPACE, plain.orderId))?.test, false, `real order stays real (${mode})`);
  }
});

test('AMP-162: a refused or throwing sample order leaves no intent', async () => {
  for (const mode of ['refused', 'throws'] as const) {
    const { orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
    orderDemo.checkout.startCheckout = (async () => {
      if (mode === 'throws') throw new Error('boom');
      return { ok: false, message: 'refused' };
    }) as unknown as typeof orderDemo.checkout.startCheckout;
    try { await createSampleOrders(orderDemo, src, 'biz-a', 1); } catch { /* a throw is allowed to surface */ }
    assert.equal(orderDemo.testIntents.size, 0, `no intent left (${mode})`);
  }
});

test('AMP-162: after a successful test purchase no intent is left, and an idempotent retry keeps test: true', async () => {
  const { orderDemo, src } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const first = await runTestPurchase(orderDemo, src, 'biz-a', 'buyer@example.com');
  assert.ok(first.ok);
  assert.equal(orderDemo.testIntents.size, 0);
  const again = await runTestPurchase(orderDemo, src, 'biz-a', 'buyer@example.com');
  assert.ok(again.ok);
  assert.equal(again.summary.orderId, first.summary.orderId);
  assert.equal(orderDemo.testIntents.size, 0);
  assert.equal((await orderDemo.orders.get(WORKSPACE, first.summary.orderId))?.test, true);
});

test('AMP-162: a throwing testOnCreate creates no order (it does not fail open to a real one)', async () => {
  const store = createMemoryOrderStore({ testOnCreate: () => { throw new Error('boom'); } });
  const n = { id: 'o1', workspaceId: WORKSPACE, listingId: 'l1', idempotencyKey: 'k1', test: false, amountMinor: 100, currency: 'USD' } as unknown as NewOrder;
  await assert.rejects(() => store.createPending(n));
  assert.equal((await store.list(WORKSPACE)).length, 0);
});

test('AMP-152: the reply to the visitor after a test purchase has no download link and no email address', async () => {
  const { deps, orderDemo } = await world(['wedding-shop'], [['biz-a', 'Wedding planning', 'wedding-shop']]);
  const email = 'visitor.person@example.com';
  const r = await submitTestPurchase(deps, 'wedding-shop', email);
  assert.ok(r.ok);
  // The delivery email did go to the fixture outbox with a signed link, so the reply being clean is a real check.
  assert.ok(orderDemo.email.outbox().some((m) => m.to === email && /\/api\/aimp\/fulfilment\/download/.test(m.text)));
  assert.deepEqual(Object.keys(r).sort(), ['label', 'ok', 'orderId']);
  const raw = JSON.stringify(r);
  assert.doesNotMatch(raw, /download|token|https?:|\/api\//i);
  assert.doesNotMatch(raw, /@|example\.com|visitor/i);
});
