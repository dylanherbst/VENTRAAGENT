// AMP-107: ONE seller account store in the /start runtime, read by Payments and used by the order demo's sample seller.
// runtime.ts is not loadable in node, so this builds what it builds: one store handed to createStartOrders, and the runtime-shaped
// object `paymentsSource` reads. Fixture adapters only; env is never read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPayments, paymentsSource } from '../app/app/[business]/payments/_server/payments.ts';
import type { PaymentsRuntime } from '../app/app/[business]/payments/_server/payments.ts';
import { buildPayments } from '../app/app/[business]/payments/view-model.ts';
import type { ProviderInput } from '../app/app/[business]/payments/view-model.ts';
import { SAMPLE_SELLER_PREFIX, createSampleOrders, createStartOrders } from '../app/start/_server/orders-runtime.ts';
import type { SampleSource } from '../app/start/_server/orders-runtime.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createInMemorySellerStore } from '../lib/aimp/sellers/index.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const START = Date.parse('2026-11-14T10:00:00Z');
const FIXTURE: ProviderInput = { status: 'fixture', label: 'DEMO' };

async function setup() {
  const llm = createProviderRegistry({ env: {} }).llm;
  const productStore = createMemoryProductStore();
  const products = createProductService({ store: productStore, now: () => new Date(START), generateSpec: async () => { throw new Error('not used'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products, brands, assets, now: () => new Date(START) });
  const slugs = new Map<string, string>();
  const sellers = createInMemorySellerStore();
  const orderDemo = createStartOrders({ workspaceId: WORKSPACE, actorId: OWNER, productStore, catalogue, sellers, now: () => new Date(START) });
  const blueprint = blueprintRegistry.find('printable-planner');
  assert.ok(blueprint);
  const business = async (businessId: string, niche: string) => {
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
  };
  const src: SampleSource = { catalogue, products, slugs };
  const rt: PaymentsRuntime = { businesses: new Set(['biz-a', 'biz-b']), seeds: new Map(), slugs, productIds: new Map(), sellers, orderDemo };
  return { sellers, orderDemo, src, rt, business };
}

test('the order demo uses the runtime\'s one seller store, not a private one', async () => {
  const { sellers, orderDemo } = await setup();
  assert.equal(orderDemo.sellers, sellers);
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.equal(src.match(/createInMemorySellerStore\(\)/g)?.length, 1);
  assert.match(src, /^\s+sellers,$/m, 'the runtime carries the store');
});

test('paymentsSource returns the runtime store and workspace; a business with no seller reads as not connected, not ready', async () => {
  const { sellers, rt } = await setup();
  const source = paymentsSource(rt);
  assert.ok(source);
  assert.equal(source.accounts, sellers);
  assert.equal(source.workspaceId, WORKSPACE);
  const r = loadPayments(rt, source, FIXTURE, 'biz-a');
  assert.ok(r.found && r.available);
  assert.equal(r.input.readiness.state, 'not_connected');
  assert.equal(r.input.payoutsEnabled, null);
  assert.equal(buildPayments(r.input).canTakePayments, false);
  assert.equal(sellers.get(WORKSPACE, 'biz-a'), null, 'nothing was seeded');
});

test('after sample orders, Payments shows the labelled sample seller as ready, and Orders and Payments read the same account', async () => {
  const { sellers, orderDemo, src, rt, business } = await setup();
  await business('biz-a', 'Wedding planning');
  const made = await createSampleOrders(orderDemo, src, 'biz-a');
  assert.ok(made.ok);
  const source = paymentsSource(rt);
  assert.ok(source);
  const r = loadPayments(rt, source, FIXTURE, 'biz-a');
  assert.ok(r.found && r.available);
  assert.equal(r.input.readiness.state, 'ready');
  const seller = sellers.get(WORKSPACE, 'biz-a');
  assert.ok(seller?.stripeAccountId.startsWith(SAMPLE_SELLER_PREFIX));
  assert.deepEqual(orderDemo.sellers.get(WORKSPACE, 'biz-a'), seller, 'the same account');
  assert.equal(buildPayments(r.input).sampleNote !== null, true, 'the page labels it as sample data');
});

test('business A\'s seller account is never shown for business B', async () => {
  const { orderDemo, src, rt, business } = await setup();
  await business('biz-a', 'Wedding planning');
  await business('biz-b', 'Meal prep');
  assert.ok((await createSampleOrders(orderDemo, src, 'biz-a')).ok);
  const source = paymentsSource(rt);
  assert.ok(source);
  const a = loadPayments(rt, source, FIXTURE, 'biz-a');
  const b = loadPayments(rt, source, FIXTURE, 'biz-b');
  assert.ok(a.found && a.available && b.found && b.available);
  assert.equal(a.input.readiness.state, 'ready');
  assert.equal(b.input.readiness.state, 'not_connected');
  assert.equal(b.input.gate.code, 'seller_not_found');
  assert.doesNotMatch(JSON.stringify(b.input), /biz-a|acct_sample_demo/);
  // Once B has its own sample orders it gets its OWN account id.
  assert.ok((await createSampleOrders(orderDemo, src, 'biz-b')).ok);
  assert.equal(orderDemo.sellers.get(WORKSPACE, 'biz-a')?.stripeAccountId, `${SAMPLE_SELLER_PREFIX}biz-a`);
  assert.equal(orderDemo.sellers.get(WORKSPACE, 'biz-b')?.stripeAccountId, `${SAMPLE_SELLER_PREFIX}biz-b`);
});

test('a runtime without a store gives no source, and the runtime wiring never reads env or a real provider', () => {
  assert.equal(paymentsSource({ businesses: new Set(), seeds: new Map(), slugs: new Map(), productIds: new Map() }), null);
  const orders = readFileSync(new URL('../app/start/_server/orders-runtime.ts', import.meta.url), 'utf8');
  assert.match(orders, /createProviderRegistry\(\{ env: \{\} \}\)/);
});
