// AMP-147: a labelled TEST purchase on the public store of a /start-published store creates an order the Orders page shows.
// Same setup as aimp-start-runtime-orders.test.ts (runtime.ts is not loadable in node). No Stripe, no network: fixture payment and email.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOrders, ordersSource } from '../app/app/[business]/orders/_server/orders.ts';
import type { OrdersRuntime } from '../app/app/[business]/orders/_server/orders.ts';
import { businessForStoreSlug, isTestOrder, runStorefrontTestPurchase } from '../app/start/_server/checkout-runtime.ts';
import type { StoreOrigin } from '../app/start/_server/checkout-runtime.ts';
import { registryFromSiteVersions } from '../lib/aimp/hosts/registry.ts';
import { FIXTURE_SELLERS } from '../lib/aimp/sellers/index.ts';
import { createSiteVersionStore, seedDemoSites } from '../lib/aimp/site-versions/index.ts';
import { createStartOrders } from '../app/start/_server/orders-runtime.ts';
import type { SampleSource, StartOrders } from '../app/start/_server/orders-runtime.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { TEST_PURCHASE_LABEL, purchaseState, testPurchaseState } from '../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const START = Date.parse('2026-11-14T10:00:00Z');
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });
const RUNTIME_ACTOR = { workspaceId: WORKSPACE, userId: OWNER };

/** The /start runtime's own site-version store with `published` live and `drafts` created but never published, plus a primary registry holding the built-in demo stores. */
async function originFor(published: string[], drafts: string[] = [], paused: string[] = []): Promise<StoreOrigin> {
  const sites = createSiteVersionStore();
  for (const slug of [...published, ...drafts, ...paused]) assert.ok((await sites.createSite(RUNTIME_ACTOR, storeFor(slug))).ok, `createSite ${slug}`);
  for (const slug of [...published, ...paused]) assert.ok((await sites.publish(RUNTIME_ACTOR, slug)).ok, `publish ${slug}`);
  for (const slug of paused) assert.ok((await sites.pause(RUNTIME_ACTOR, slug)).ok, `pause ${slug}`);
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  return { primary, sites };
}

async function setup() {
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
  const business = async (businessId: string, niche: string, slug: string) => {
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
  };
  const src: SampleSource = { catalogue, products, slugs };
  const businesses = new Set<string>(['biz-a', 'biz-b']);
  const rt: OrdersRuntime & { orderDemo: StartOrders } = { businesses, seeds: new Map(), slugs, productIds: new Map(), orderDemo };
  return { orderDemo, src, rt, business, slugs };
}

test('testPurchaseState: only a demo store published by the /start runtime; a real store never gets it', () => {
  const real: StoreConfig = { ...storeFor('real-shop'), demo: false, merchant: { chargesEnabled: true } };
  assert.deepEqual(testPurchaseState(storeFor('s'), true), { canTest: true, label: TEST_PURCHASE_LABEL });
  assert.match(TEST_PURCHASE_LABEL, /^Test purchase/);
  assert.equal(testPurchaseState(storeFor('s'), false).canTest, false, 'a demo store the runtime does not own');
  assert.equal(testPurchaseState(real, true).canTest, false, 'a real store, even if the slug were in the runtime');
});

test('real (non-demo) store checkout rules are unchanged', () => {
  const real: StoreConfig = { ...storeFor('real-shop'), demo: false, merchant: { chargesEnabled: true } };
  assert.deepEqual(purchaseState(real), { canBuy: false, reason: 'Checkout is not available yet.' }, 'still off while checkoutBuilt is false');
  assert.deepEqual(purchaseState(real, true), { canBuy: true });
  assert.equal(purchaseState({ ...real, merchant: { chargesEnabled: false } }, true).canBuy, false);
  assert.deepEqual(purchaseState(storeFor('s'), true), { canBuy: false, reason: 'Demo store: checkout is turned off.' }, 'a demo store stays unbuyable through purchaseState; the test purchase is a separate path');
});

test('a test purchase on a /start store creates a labelled order the owner Orders page shows, for that business only', async () => {
  const { orderDemo, src, rt, business } = await setup();
  await business('biz-a', 'Wedding planning', 'wedding-shop');
  await business('biz-b', 'Garden planning', 'garden-shop');
  const origin = await originFor(['wedding-shop', 'garden-shop']);
  const r = await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('wedding-shop'), 'buyer@example.com');
  assert.ok(r.ok);
  assert.equal(r.test, true);
  assert.equal(r.label, TEST_PURCHASE_LABEL);
  assert.equal(r.businessId, 'biz-a');

  const order = await orderDemo.orders.get(WORKSPACE, r.summary.orderId);
  assert.equal(order?.businessId, 'biz-a');
  assert.equal(order?.storeSlug, 'wedding-shop');
  assert.equal(order?.status, 'paid');
  assert.ok(order && isTestOrder(order), 'the order carries the test marker (fixture seller account)');

  const a = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.ok(a.found && a.available);
  assert.deepEqual(a.page.orders.map((o) => o.id), [r.summary.orderId]);

  // a second business in the same workspace does not see it
  const b = await loadOrders(rt, ordersSource(rt), 'biz-b', { filter: 'all', cursor: null });
  assert.ok(b.found && b.available);
  assert.equal(b.page.orders.length, 0);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).filter((o) => o.businessId === 'biz-b').length, 0);

  // a second workspace does not see it, by list or by id
  assert.equal((await orderDemo.orders.list('other-workspace')).length, 0);
  assert.equal(await orderDemo.orders.get('other-workspace', r.summary.orderId), null);
});

test('refusals: real store, unknown store, unpublished config, bad email; nothing is created', async () => {
  const { orderDemo, src, business, slugs } = await setup();
  await business('biz-a', 'Wedding planning', 'wedding-shop');
  const real: StoreConfig = { ...storeFor('wedding-shop'), demo: false, merchant: { chargesEnabled: true } };
  const origin = await originFor(['wedding-shop']);
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, origin, real, 'a@example.com')).ok, false);
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('not-in-runtime'), 'a@example.com')).ok, false);
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, origin, { ...storeFor('wedding-shop'), status: 'draft' } as StoreConfig, 'a@example.com')).ok, false);
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('wedding-shop'), 'not-an-email')).ok, false);
  slugs.set('biz-dup', 'wedding-shop');
  assert.equal(businessForStoreSlug(slugs, 'wedding-shop'), null, 'an address two businesses claim resolves to none');
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('wedding-shop'), 'a@example.com')).ok, false);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
});

test('a /start business whose address equals a built-in demo store is refused: no order, no download link', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-a', 'Wedding planning', demoStore.slug);
  // The runtime really published it under that address, but the primary registry (the built-in demo store) holds it too and wins publicly.
  const origin = await originFor([demoStore.slug]);
  assert.equal((await origin.primary.resolve(demoStore.slug)).status, 'live', 'the fixture store really holds this address');
  const r = await runStorefrontTestPurchase(orderDemo, src, origin, storeFor(demoStore.slug), 'buyer@example.com');
  assert.equal(r.ok, false);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  assert.equal(orderDemo.email.outbox().length, 0, 'no delivery email');
});

test('a draft (never published) or paused /start store is refused; nothing is created', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-a', 'Wedding planning', 'draft-shop');
  await business('biz-b', 'Garden planning', 'paused-shop');
  const origin = await originFor([], ['draft-shop'], ['paused-shop']);
  const draft = await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('draft-shop'), 'a@example.com');
  const paused = await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('paused-shop'), 'a@example.com');
  assert.equal(draft.ok, false);
  assert.equal(paused.ok, false);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  // not in the runtime's site store at all
  assert.equal((await runStorefrontTestPurchase(orderDemo, src, await originFor([]), storeFor('draft-shop'), 'a@example.com')).ok, false);
});

test('a business that already has a non-sample seller account is refused: a fixture-paid order would look real', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-a', 'Wedding planning', 'wedding-shop');
  const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')?.snapshot;
  assert.ok(ready);
  orderDemo.sellers.register({ workspaceId: WORKSPACE, businessId: 'biz-a', stripeAccountId: 'acct_real_0001', snapshot: { ...ready, id: 'acct_real_0001' }, lastEventCreated: 0 });
  const origin = await originFor(['wedding-shop']);
  const r = await runStorefrontTestPurchase(orderDemo, src, origin, storeFor('wedding-shop'), 'a@example.com');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.message, /seller account/);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  assert.equal(orderDemo.sellers.get(WORKSPACE, 'biz-a')?.stripeAccountId, 'acct_real_0001', 'the existing account is untouched');
});
