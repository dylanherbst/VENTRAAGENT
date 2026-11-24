// AMP-081 rework: the overview over the REAL memory services, driven with the same calls app/start/actions.ts makes (brand, product,
// catalogue, site version). The `runtime()` of app/start/_server/runtime.ts is NOT used: that file imports lib modules without a
// `.ts` extension and cannot be loaded by the node test runner, and it may not be edited here. This test builds the same wiring
// (same factories, same contexts) in the test instead. What this does not prove: the `runtime()` singleton on globalThis, the
// server actions themselves, and the Next page.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBusinessOverview } from '../app/app/[business]/_server/overview.ts';
import type { OverviewContexts, OverviewRuntime } from '../app/app/[business]/_server/overview.ts';
import { buildStoreDraft, storeProductsFrom } from '../app/start/store-draft.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft, getApprovedBrand, getApprovedBrandOutputs } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { listingIdFor } from '../lib/aimp/catalogue/index.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { defaultInputs } from '../lib/aimp/selection/preview.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const ctx: OverviewContexts = {
  workspaceId: WORKSPACE,
  productCtx: { workspaceId: WORKSPACE, actorId: OWNER },
  brandCtx: { workspaceId: WORKSPACE },
  siteActor: { workspaceId: WORKSPACE, userId: OWNER },
  catalogueCtx: (businessId) => ({ workspaceId: WORKSPACE, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` }),
};
const NOW = () => new Date();

/** The runtime() wiring, rebuilt from the same factories. */
function realRuntime() {
  const llm = createProviderRegistry({ env: {} }).llm;
  const seeds = new Map<string, { blueprintId: string; inputs: Record<string, string | number> }>();
  const products = createProductService({
    generateSpec: (p) => {
      const seed = seeds.get(p.businessId);
      const blueprint = blueprintRegistry.find(p.blueprintId);
      if (!seed || !blueprint) throw new Error('no seed');
      return generateProductSpec({ blueprint, inputs: seed.inputs, provider: llm });
    },
  });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const rt = {
    llm, products, brands, assets, seeds, catalogue: createCatalogueService({ products, brands, assets }), sites: createSiteVersionStore(),
    productIds: new Map<string, string[]>(), slugs: new Map<string, string>(), businesses: new Set<string>(),
  };
  return rt;
}
type Rt = ReturnType<typeof realRuntime>;
const asOverview = (rt: Rt): OverviewRuntime => rt;

/** Brand, product, listing and site draft for one business, in the order /start does it. Returns what was built. */
async function build(rt: Rt, businessId: string, upTo: 'brand' | 'product' | 'catalogue' | 'site' | 'published') {
  // Two businesses cannot hold the same approved store address, so each one gets its own idea and name.
  const found = findOpportunities({ budgetMinor: 60000, weeklyHours: 10, interests: ['organisation', 'wellbeing'], skills: ['writing', 'design'], preferredEffort: 'medium' }, { now: NOW, mode: 'fixture' }).ideas;
  const n = rt.businesses.size;
  const idea = found[n % found.length];
  rt.businesses.add(businessId);
  const deps = { store: rt.brands, now: NOW };
  const draft = await createBrandDraft(deps, ctx.brandCtx, businessId, { niche: idea.niche, audience: idea.whoToSellTo, productType: idea.whatToSell }, { nameIndex: Math.floor(n / found.length) });
  assert.ok(draft.ok, 'brand draft');
  const approved = await approveBrand(deps, ctx.brandCtx, businessId, OWNER);
  assert.ok(approved.ok, `brand approve: ${approved.ok ? '' : approved.errors.map((e) => e.message).join('; ')}`);
  if (upTo === 'brand') return;

  const seed = { blueprintId: idea.blueprint.id, inputs: defaultInputs(idea) as Record<string, string | number> };
  const spec = await generateProductSpec({ blueprint: blueprintRegistry.find(seed.blueprintId)!, inputs: seed.inputs, provider: rt.llm });
  rt.seeds.set(businessId, seed);
  const { product, version } = await rt.products.createProduct(ctx.productCtx, { businessId, spec });
  for (const role of ['cover', 'preview', 'master'] as const) rt.assets.add({ id: `${product.id}-${role}`, workspaceId: WORKSPACE, businessId, productId: product.id, role });
  rt.productIds.set(businessId, [product.id]);
  await rt.products.approve(ctx.productCtx, version.id);
  if (upTo === 'product') return;

  await rt.catalogue.createDraft(ctx.catalogueCtx(businessId), { businessId, productId: product.id });
  await rt.catalogue.approveListing(ctx.catalogueCtx(businessId), listingIdFor(product.id), { expectedVersion: 1 });
  if (upTo === 'catalogue') return;

  const brand = await getApprovedBrand({ store: rt.brands }, ctx.brandCtx, businessId);
  const outputs = await getApprovedBrandOutputs({ store: rt.brands }, ctx.brandCtx, businessId);
  const listings = await rt.catalogue.listApprovedForBusiness(ctx.catalogueCtx(businessId), businessId);
  assert.ok(brand && outputs && listings.length > 0);
  const created = await rt.sites.createSite(ctx.siteActor, buildStoreDraft(outputs.storefront, storeProductsFrom(listings, brand.visual.coverStyle, {})));
  assert.ok(created.ok, 'site draft');
  if (!created.ok) return;
  rt.slugs.set(businessId, created.value.slug);
  if (upTo === 'site') return;
  const d = await rt.sites.getDraft(ctx.siteActor, created.value.slug);
  assert.ok(d.ok);
  if (!d.ok) return;
  const pub = await rt.sites.publish(ctx.siteActor, created.value.slug, { note: '', expectedRevision: d.value.revision });
  assert.ok(pub.ok, `publish: ${pub.ok ? '' : pub.errors.join(', ')}`);
}

const stepIds = (o: { launchProgress: { steps: { id: string; done: boolean }[] } }) => o.launchProgress.steps.filter((s) => s.done).map((s) => s.id);

test('real memory services: each /start step moves the overview', async () => {
  const rt = realRuntime();
  const view = async (id: string) => {
    const r = await loadBusinessOverview(asOverview(rt), ctx, {}, id, NOW);
    assert.ok(r.found);
    return r.found ? r : (undefined as never);
  };

  await build(rt, 'real-brand', 'brand');
  assert.deepEqual(stepIds((await view('real-brand')).overview), ['idea', 'brand']);
  assert.equal((await view('real-brand')).overview.state, 'new_setup');

  await build(rt, 'real-product', 'product');
  assert.deepEqual(stepIds((await view('real-product')).overview), ['idea', 'brand', 'product']);

  await build(rt, 'real-cat', 'catalogue');
  assert.deepEqual(stepIds((await view('real-cat')).overview), ['idea', 'brand', 'product', 'catalogue']);

  await build(rt, 'real-site', 'site');
  const draftOnly = await view('real-site');
  assert.equal(draftOnly.storeStatus, 'draft');
  assert.deepEqual(stepIds(draftOnly.overview), ['idea', 'brand', 'product', 'catalogue']);
  assert.equal(draftOnly.overview.state, 'new_setup');

  await build(rt, 'real-live', 'published');
  const live = await view('real-live');
  assert.equal(live.storeStatus, 'live');
  assert.deepEqual(stepIds(live.overview), ['idea', 'brand', 'product', 'catalogue', 'store']);
  // Published, payments never connected: a calm "connect payments" case, not an outage.
  assert.equal(live.overview.state, 'degraded_checkout');
  assert.equal(live.overview.needsYou[0].source.id, 'not_connected');
  assert.ok(live.businessName && live.businessName.length > 0);

  // Isolation: the other businesses' steps never show up in this one.
  await build(rt, 'real-other', 'brand');
  assert.deepEqual(stepIds((await view('real-other')).overview), ['idea', 'brand']);
});

test('real memory services: an unknown business is not found and the read adds nothing', async () => {
  const rt = realRuntime();
  await build(rt, 'real-a', 'brand');
  const before = rt.businesses.size;
  assert.deepEqual(await loadBusinessOverview(asOverview(rt), ctx, {}, 'never-seen', NOW), { found: false });
  assert.equal(rt.businesses.size, before);
  assert.equal(rt.businesses.has('never-seen'), false);
  assert.equal(rt.seeds.has('never-seen'), false);
  assert.equal(rt.slugs.has('never-seen'), false);
  // Reading a known business adds nothing either.
  await loadBusinessOverview(asOverview(rt), ctx, {}, 'real-a', NOW);
  assert.equal(rt.businesses.size, before);
});
