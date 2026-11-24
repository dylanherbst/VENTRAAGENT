// AMP-104: the journey runtime supplies the published-store probe with a tenant-scoped store lookup, and the published
// snapshot carries the product id so "not shown" survives a rename. Real site-version store, real product service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SAME_WORKSPACE_SEEDS } from '../lib/aimp/journey/fixtures.ts';
import type { JourneyKey } from '../lib/aimp/journey/fixtures.ts';
import { createJourneyWorld } from '../lib/aimp/journey/world.ts';
import type { JourneyWorld } from '../lib/aimp/journey/world.ts';
import { createSitePublishedStoreProbe, createTenantStoreSlugFor, ProductError } from '../lib/aimp/products/index.ts';
import type { ProductRecord } from '../lib/aimp/products/index.ts';
import { validateStoreConfig } from '../lib/aimp/storefront/schema.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

async function built(world: JourneyWorld, k: JourneyKey) {
  world.intake(k); world.rankIdeas(k); await world.chooseIdea(k);
  assert.equal((await world.build(k)).status, 'succeeded');
  const b = world.biz[k];
  return { b, pc: { workspaceId: b.seed.workspaceId, actorId: b.seed.ownerId }, businessId: b.businessId as string, productId: b.productId as string };
}
const notFound = (e: unknown) => e instanceof ProductError && e.code === 'not_found';

test('AMP-104: the journey world archive answers from the real published store (shown, then not shown after a pause)', async () => {
  const w = await createJourneyWorld();
  const a = await built(w, 'a');
  const r = await w.productService.archiveProduct(a.pc, a.productId, a.businessId);
  assert.deepEqual([r.publishedStore, r.storeNeedsRepublish], ['shown', true]);
  assert.equal((await w.sites.pause({ workspaceId: a.b.seed.workspaceId, userId: a.b.seed.ownerId }, a.b.slug as string)).ok, true);
  const paused = await w.productService.archiveProduct(a.pc, a.productId, a.businessId);
  assert.deepEqual([paused.publishedStore, paused.storeNeedsRepublish], ['not_shown', false]);
});

test('AMP-104: two workspaces: neither can see or learn about the other store through the probe', async () => {
  const w = await createJourneyWorld();
  const a = await built(w, 'a');
  const b = await built(w, 'b');
  assert.notEqual(a.b.seed.workspaceId, b.b.seed.workspaceId);
  assert.equal((await w.sites.resolvePublished(a.b.slug as string)).status, 'live');
  assert.equal((await w.sites.resolvePublished(b.b.slug as string)).status, 'live');

  // Through the service: the other workspace cannot even reach the product.
  await assert.rejects(w.productService.archiveProduct(b.pc, a.productId, a.businessId), notFound);
  await assert.rejects(w.productService.archiveProduct(a.pc, b.productId, b.businessId), notFound);
  assert.equal((await w.productService.getProduct(a.pc, a.productId)).archivedAt, undefined, 'a refused archive changes nothing');

  // Directly on the probe the world wired (the strongest form: a product record handed in from the wrong workspace).
  const productA = await w.productService.getProduct(a.pc, a.productId);
  const productB = await w.productService.getProduct(b.pc, b.productId);
  const slugFor = createTenantStoreSlugFor({
    sites: w.sites,
    storeOf: (ws, biz) => { const k = (['a', 'b'] as const).find((x) => w.biz[x].seed.workspaceId === ws && w.biz[x].businessId === biz); return k ? { slug: w.biz[k].slug as string, userId: w.biz[k].seed.ownerId } : null; },
  });
  assert.equal(await slugFor({ workspaceId: a.b.seed.workspaceId }, productA), a.b.slug);
  assert.equal(await slugFor({ workspaceId: b.b.seed.workspaceId }, productA), null, 'B asking about A\'s product gets no store');
  assert.equal(await slugFor({ workspaceId: a.b.seed.workspaceId }, productB), null, 'A asking about B\'s product gets no store');
  const probe = createSitePublishedStoreProbe({ resolvePublished: (s) => w.sites.resolvePublished(s), storeSlugFor: slugFor });
  assert.equal(await probe.isProductShown({ workspaceId: b.b.seed.workspaceId }, productA), 'not_shown');
  assert.equal(await probe.isProductShown({ workspaceId: a.b.seed.workspaceId }, productA), 'shown');

  // A runtime registry that wrongly points workspace A at B's slug is still refused by the real site store (B's site is not A's).
  const lying = createTenantStoreSlugFor({ sites: w.sites, storeOf: () => ({ slug: b.b.slug as string, userId: a.b.seed.ownerId }) });
  assert.equal(await lying({ workspaceId: a.b.seed.workspaceId }, productA), null);
  // A site lookup that fails is an error (reported as unknown by archive), never "no store".
  const broken = createTenantStoreSlugFor({ sites: { listSites: async () => ({ ok: false, code: 'denied', errors: ['x'] }) as never }, storeOf: () => ({ slug: 'x-store', userId: 'u' }) });
  await assert.rejects(broken({ workspaceId: a.b.seed.workspaceId }, productA));
  assert.equal(await slugFor({ workspaceId: '' }, productA), null);
});

test('AMP-104: two businesses in ONE workspace: the store lookup is scoped to the business, not just the workspace', async () => {
  const w = await createJourneyWorld({ seeds: SAME_WORKSPACE_SEEDS });
  const a = await built(w, 'a');
  const b = await built(w, 'b');
  assert.equal(a.b.seed.workspaceId, b.b.seed.workspaceId);
  assert.notEqual(a.b.slug, b.b.slug);
  // Pause only A's store: archiving A's product says "not shown" and archiving B's still says "shown".
  assert.equal((await w.sites.pause({ workspaceId: a.b.seed.workspaceId, userId: a.b.seed.ownerId }, a.b.slug as string)).ok, true);
  const ra = await w.productService.archiveProduct(a.pc, a.productId, a.businessId);
  const rb = await w.productService.archiveProduct(b.pc, b.productId, b.businessId);
  assert.equal(ra.publishedStore, 'not_shown');
  assert.equal(rb.publishedStore, 'shown');
  // A product record of a business the runtime has no store for is "no store", not the workspace's other store.
  const slugFor = createTenantStoreSlugFor({ sites: w.sites, storeOf: (ws, biz) => (biz === a.businessId ? { slug: a.b.slug as string, userId: a.b.seed.ownerId } : null) });
  const productB = await w.productService.getProduct(b.pc, b.productId);
  assert.equal(await slugFor({ workspaceId: a.b.seed.workspaceId }, productB), null);
});

test('AMP-104: the published snapshot carries the product id and the probe matches on it, so a rename cannot hide the product', async () => {
  const w = await createJourneyWorld();
  const a = await built(w, 'a');
  const live = await w.sites.resolvePublished(a.b.slug as string);
  assert.equal(live.status, 'live');
  if (live.status !== 'live') return;
  assert.deepEqual(live.config.products.map((p) => p.productId), [a.productId]);
  const product = await w.productService.getProduct(a.pc, a.productId);
  const renamed = (productId?: string): StoreConfig => ({ ...live.config, products: live.config.products.map((p) => { const rest = { ...p }; delete rest.productId; return { ...rest, slug: 'renamed-by-the-owner', ...(productId ? { productId } : {}) }; }) });
  const probeFor = (config: StoreConfig, slugs: string[] = []) => createSitePublishedStoreProbe({
    resolvePublished: async () => ({ ...live, config }),
    storeSlugFor: async () => a.b.slug as string,
    productSlugsFor: async () => slugs,
  });
  const ctx = { workspaceId: a.b.seed.workspaceId };
  // Id match wins even though the slug changed and the slug list is useless.
  assert.equal(await probeFor(renamed(a.productId), ['the-old-slug']).isProductShown(ctx, product), 'shown');
  // Every store product names a source and none is this product: a reliable "not shown", slug or no slug.
  assert.equal(await probeFor(renamed('some-other-product-id'), ['renamed-by-the-owner']).isProductShown(ctx, product), 'not_shown');
  // No ids at all (older snapshot): slug hit is shown; a slug miss is unknown, never not_shown.
  assert.equal(await probeFor(renamed(), ['renamed-by-the-owner']).isProductShown(ctx, product), 'shown');
  assert.equal(await probeFor(renamed(), ['the-old-slug']).isProductShown(ctx, product), 'unknown');
  assert.equal(await probeFor(renamed(), []).isProductShown(ctx, product), 'unknown');
  // Without a slug fallback at all it is still unknown, not not_shown.
  const noFallback = createSitePublishedStoreProbe({ resolvePublished: async () => ({ ...live, config: renamed() }), storeSlugFor: async () => a.b.slug as string });
  assert.equal(await noFallback.isProductShown(ctx, product), 'unknown');
  // Mixed snapshot: one store product has an id for another product, one has none: cannot rule this product out.
  const mixed: StoreConfig = { ...live.config, products: [{ ...renamed('other').products[0] as StoreConfig['products'][number] }, { ...renamed().products[0] as StoreConfig['products'][number], slug: 'second-product' }] };
  assert.equal(await probeFor(mixed, ['nope']).isProductShown(ctx, product), 'unknown');
  const asProduct: ProductRecord = product;
  assert.equal(asProduct.id, a.productId);
});

test('AMP-104: productId on a store product is optional and validated', async () => {
  const w = await createJourneyWorld();
  const a = await built(w, 'a');
  const live = await w.sites.resolvePublished(a.b.slug as string);
  assert.equal(live.status, 'live');
  if (live.status !== 'live') return;
  const withId = live.config;
  assert.equal(validateStoreConfig(withId).ok, true);
  const without = { ...withId, products: withId.products.map((p) => { const c = { ...p }; delete c.productId; return c; }) };
  assert.equal(validateStoreConfig(without).ok, true, 'existing snapshots without an id stay valid');
  for (const bad of [42, '', 'x'.repeat(121), null]) {
    const r = validateStoreConfig({ ...withId, products: withId.products.map((p) => ({ ...p, productId: bad })) });
    assert.equal(r.ok, false, `productId ${String(bad).slice(0, 5)} must be refused`);
  }
});
