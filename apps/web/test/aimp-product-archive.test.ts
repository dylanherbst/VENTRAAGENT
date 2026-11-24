// AMP-096: archive / unarchive a product. Product-level flag; versions, listings and past orders are untouched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogueService, createMemoryCatalogueStore, listingIdFor } from '../lib/aimp/catalogue/index.ts';
import type { OperationContext } from '../lib/aimp/catalogue/index.ts';
import { createDemoCatalogue, seedApprovedBrand, seedApprovedProduct } from '../lib/aimp/catalogue/demo.ts';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import { createJourneyWorld } from '../lib/aimp/journey/world.ts';
import { slugify } from '../lib/aimp/preview/generate.ts';
import { createProductService, createSitePublishedStoreProbe, ProductError } from '../lib/aimp/products/index.ts';
import type { PublishedStoreProbe } from '../lib/aimp/products/index.ts';

const octx = (ws: string, biz: string, actor = 'owner'): OperationContext => ({ workspaceId: ws, businessId: biz, actorUserId: actor, idempotencyKey: `k-${ws}` });
const A = octx('ws-a', 'biz-a', 'owner-a');
const pctx = { workspaceId: 'ws-a', actorId: 'owner-a' };
const notFound = (e: unknown) => e instanceof ProductError && e.code === 'not_found';

async function setup() {
  let tick = 0;
  const d = createDemoCatalogue(() => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++)), {});
  const p = await seedApprovedProduct(d, A, 'biz-a');
  await seedApprovedBrand(d, A, 'biz-a', p.title);
  const listingId = listingIdFor(p.productId);
  await d.catalogue.createDraft(A, { businessId: 'biz-a', productId: p.productId });
  await d.catalogue.approveListing(A, listingId);
  return { d, p, listingId, svc: d.catalogue, products: d.products };
}

test('archive and unarchive: flag readable through get and list, idempotent, first archive record kept', async () => {
  const s = await setup();
  assert.equal((await s.products.getProduct(pctx, s.p.productId, 'biz-a')).archivedAt, undefined);
  const a1 = await s.products.archiveProduct(pctx, s.p.productId, 'biz-a');
  assert.ok(a1.archivedAt);
  assert.equal(a1.archivedBy, 'owner-a');
  const a2 = await s.products.archiveProduct({ ...pctx, actorId: 'someone-else' }, s.p.productId, 'biz-a');
  assert.deepEqual(a2, a1, 'a second archive changes nothing');
  assert.equal((await s.products.getProduct(pctx, s.p.productId)).archivedAt, a1.archivedAt);
  const listed = await s.products.listProducts(pctx, 'biz-a');
  assert.deepEqual(listed.map((p) => [p.id, Boolean(p.archivedAt)]), [[s.p.productId, true]]);
  const u1 = await s.products.unarchiveProduct(pctx, s.p.productId, 'biz-a');
  assert.equal(u1.archivedAt, undefined);
  assert.equal(u1.archivedBy, undefined);
  assert.deepEqual(await s.products.unarchiveProduct(pctx, s.p.productId, 'biz-a'), u1, 'unarchive is idempotent');
  assert.equal((await s.products.listProducts(pctx, 'biz-a'))[0]?.archivedAt, undefined);
});

test('unknown product, wrong business and wrong workspace are refused the same way and change nothing', async () => {
  const s = await setup();
  for (const [ctx, id, biz] of [
    [pctx, 'prod-nope', 'biz-a'],
    [pctx, s.p.productId, 'biz-other'],
    [{ workspaceId: 'ws-b', actorId: 'x' }, s.p.productId, 'biz-a'],
    [{ workspaceId: '', actorId: 'x' }, s.p.productId, 'biz-a'],
  ] as const) {
    await assert.rejects(s.products.archiveProduct(ctx, id, biz), notFound);
    await assert.rejects(s.products.unarchiveProduct(ctx, id, biz), notFound);
  }
  await assert.rejects(s.products.getProduct(pctx, s.p.productId, 'biz-other'), notFound);
  assert.deepEqual(await s.products.listProducts({ workspaceId: 'ws-b' }, 'biz-a'), []);
  assert.equal((await s.products.getProduct(pctx, s.p.productId)).archivedAt, undefined);
});

test('an archived product cannot be bought or resolved as an active listing; unarchive restores the exact prior state', async () => {
  const s = await setup();
  const before = await s.svc.listVersions(A, s.listingId);
  const price = await s.svc.getCheckoutPrice(A, s.listingId);
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a')).length, 1);
  assert.equal(await s.svc.isListingArchived(A, s.listingId), false);

  await s.products.archiveProduct(pctx, s.p.productId, 'biz-a');
  assert.equal(await s.svc.getApprovedListing(A, s.listingId), null);
  await assert.rejects(s.svc.getCheckoutPrice(A, s.listingId), (e: unknown) => (e as { code?: string }).code === 'not_approved');
  assert.deepEqual(await s.svc.listApprovedForBusiness(A, 'biz-a'), []);
  assert.equal(await s.svc.isListingArchived(A, s.listingId), true);
  // Owner reads still see the listing, still approved, byte for byte.
  assert.deepEqual(await s.svc.listVersions(A, s.listingId), before);
  assert.equal((await s.svc.getListing(A, s.listingId))?.status, 'approved');

  await s.products.unarchiveProduct(pctx, s.p.productId, 'biz-a');
  assert.deepEqual(await s.svc.getCheckoutPrice(A, s.listingId), price);
  assert.equal((await s.svc.getApprovedListing(A, s.listingId))?.status, 'approved');
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a')).length, 1);
  assert.equal(await s.svc.isListingArchived(A, s.listingId), false);
  assert.deepEqual(await s.svc.listVersions(A, s.listingId), before);
});

test('AMP-100: a catalogue cannot be built without the product lookup (no fail-open)', async () => {
  const s = await setup();
  const store = createMemoryCatalogueStore();
  // Typed as required; a JS caller or a cast still fails closed at construction instead of ignoring archiving.
  assert.throws(
    () => createCatalogueService({ store, products: { listVersions: s.products.listVersions } as never, brands: s.d.brands, assets: s.d.assets }),
    (e: unknown) => e instanceof TypeError && /getProduct/.test(e.message),
  );
  assert.throws(() => createCatalogueService({ store, brands: s.d.brands, assets: s.d.assets } as never), TypeError);
  // With the lookup supplied it works and refuses an archived product.
  const ok = createCatalogueService({ store, products: s.products, brands: s.d.brands, assets: s.d.assets });
  await ok.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
  await ok.approveListing(A, s.listingId);
  await s.products.archiveProduct(pctx, s.p.productId, 'biz-a');
  assert.equal(await ok.getApprovedListing(A, s.listingId), null);
  assert.equal(await s.svc.getApprovedListing(A, s.listingId), null);
});

test('AMP-100: fail closed: a listing whose product record is missing is not sold or listed', async () => {
  const s = await setup();
  let gone = false;
  const products = {
    listVersions: s.products.listVersions,
    getProduct: async (...a: Parameters<typeof s.products.getProduct>) => {
      if (gone) throw new ProductError('not_found', 'That product was not found.');
      return s.products.getProduct(...a);
    },
  };
  const cat = createCatalogueService({ store: createMemoryCatalogueStore(), products, brands: s.d.brands, assets: s.d.assets });
  await cat.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
  await cat.approveListing(A, s.listingId);
  assert.ok(await cat.getApprovedListing(A, s.listingId), 'sellable while the product record exists');
  assert.equal((await cat.listApprovedForBusiness(A, 'biz-a')).length, 1);
  gone = true;
  assert.equal(await cat.getApprovedListing(A, s.listingId), null);
  assert.deepEqual(await cat.listApprovedForBusiness(A, 'biz-a'), []);
  await assert.rejects(cat.getCheckoutPrice(A, s.listingId), (e: unknown) => (e as { code?: string }).code === 'not_approved');
});

test('AMP-100: real journey wiring: an archived product is refused at checkout price and omitted from the storefront list', async () => {
  const w = await createJourneyWorld();
  w.intake('a'); w.rankIdeas('a'); await w.chooseIdea('a');
  const job = await w.build('a');
  assert.equal(job.status, 'succeeded');
  const b = w.biz.a;
  const ctx = w.catalogueCtx('a');
  const listingId = b.listingId as string;
  const productId = b.productId as string;
  const pc = { workspaceId: b.seed.workspaceId, actorId: b.seed.ownerId };
  assert.equal((await w.catalogue.listApprovedForBusiness(ctx, ctx.businessId as string)).length, 1);
  assert.equal((await w.catalogue.getCheckoutPrice(ctx, listingId)).productId, productId);

  await w.productService.archiveProduct(pc, productId, ctx.businessId as string);
  await assert.rejects(w.catalogue.getCheckoutPrice(ctx, listingId), (e: unknown) => (e as { code?: string }).code === 'not_approved');
  assert.deepEqual(await w.catalogue.listApprovedForBusiness(ctx, ctx.businessId as string), []);
  assert.equal(await w.catalogue.getApprovedListing(ctx, listingId), null);
  const r = await w.checkout.startCheckout({ storeSlug: b.slug as string, listingId, buyerEmail: 'late@example.test', idempotencyKey: 'journey-archived' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'listing_not_available');
});

test('AMP-100: archiveProduct says whether a published store still shows the product', async () => {
  const w = await createJourneyWorld();
  w.intake('a'); w.rankIdeas('a'); await w.chooseIdea('a');
  await w.build('a');
  const b = w.biz.a;
  const businessId = b.businessId as string;
  const productId = b.productId as string;
  const pc = { workspaceId: b.seed.workspaceId, actorId: b.seed.ownerId };
  const ctx = w.catalogueCtx('a');
  const titleSlugs = async () => (await w.catalogue.listVersions(ctx, b.listingId as string)).map((l) => slugify(l.title));
  // A snapshot published before store products carried a product id (AMP-104): same store, ids removed.
  const legacyResolve = async (slug: string) => {
    const r = await w.sites.resolvePublished(slug);
    return r.status === 'live' ? { ...r, config: { ...r.config, products: r.config.products.map((p) => { const c = { ...p }; delete c.productId; return c; }) } } : r;
  };
  const probeWith = (productSlugsFor: () => Promise<string[]>, storeSlugFor?: () => Promise<string | null>, legacy = false) => createSitePublishedStoreProbe({
    resolvePublished: (slug) => (legacy ? legacyResolve(slug) : w.sites.resolvePublished(slug)),
    storeSlugFor: storeSlugFor ?? (async (c) => (c.workspaceId === b.seed.workspaceId ? (b.slug as string) : null)),
    productSlugsFor,
  });
  const serviceWith = (probe?: PublishedStoreProbe) => createProductService({
    store: w.products, now: w.now, generateSpec: async () => { throw new Error('not used'); }, ...(probe ? { publishedStores: probe } : {}),
  });

  // 1. Live store published before the archive still shows it: the owner must republish.
  const shown = await serviceWith(probeWith(titleSlugs)).archiveProduct(pc, productId, businessId);
  assert.ok(shown.archivedAt);
  assert.equal(shown.publishedStore, 'shown');
  assert.equal(shown.storeNeedsRepublish, true);
  // Asking again (idempotent archive) still reports it, because nothing was republished.
  assert.equal((await serviceWith(probeWith(titleSlugs)).archiveProduct(pc, productId, businessId)).storeNeedsRepublish, true);

  // 2. Not shown: the store is paused or absent. A live store with products where none matches by slug is NOT a confident
  // "not shown" (the store may have renamed or de-duplicated the slug), so it is unknown.
  const other = await serviceWith(probeWith(async () => ['some-other-product'], undefined, true)).archiveProduct(pc, productId, businessId);
  assert.deepEqual([other.publishedStore, other.storeNeedsRepublish], ['unknown', null]);
  const paused = await w.sites.pause({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId }, b.slug as string);
  assert.equal(paused.ok, true);
  const afterPause = await serviceWith(probeWith(titleSlugs)).archiveProduct(pc, productId, businessId);
  assert.deepEqual([afterPause.publishedStore, afterPause.storeNeedsRepublish], ['not_shown', false]);
  await w.sites.unpause({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId }, b.slug as string);
  const noStore = await serviceWith(probeWith(titleSlugs, async () => null)).archiveProduct(pc, productId, businessId);
  assert.equal(noStore.storeNeedsRepublish, false);

  // 3. Dependency absent, cannot tell which store product it is, or the lookup fails: honestly unknown, never "false".
  for (const svc of [
    serviceWith(),
    serviceWith(probeWith(async () => [], undefined, true)),
    serviceWith({ isProductShown: async () => { throw new Error('site data unavailable'); } }),
  ]) {
    const r = await svc.archiveProduct(pc, productId, businessId);
    assert.ok(r.archivedAt, 'the product is archived whatever the probe says');
    assert.deepEqual([r.publishedStore, r.storeNeedsRepublish], ['unknown', null]);
  }
});

// This only proves the probe asks storeSlugFor with the caller's workspace and trusts the answer. It does NOT prove a real
// store registry is tenant-scoped: the published snapshot carries no workspace/business id to compare. That multi-workspace
// test is owed when the runtime wiring lands (see the contract).
test('AMP-100: the probe passes the caller workspace to storeSlugFor and reports no store as not_shown (stub only)', async () => {
  const w = await createJourneyWorld();
  w.intake('a'); w.rankIdeas('a'); await w.chooseIdea('a');
  await w.build('a');
  const b = w.biz.a;
  const seen: string[] = [];
  const probe = createSitePublishedStoreProbe({
    resolvePublished: (slug) => w.sites.resolvePublished(slug),
    storeSlugFor: async (c) => { seen.push(c.workspaceId); return c.workspaceId === b.seed.workspaceId ? (b.slug as string) : null; },
    productSlugsFor: async () => [slugify(b.productTitle as string)],
  });
  const product = await w.productService.getProduct({ workspaceId: b.seed.workspaceId, actorId: 'x' }, b.productId as string);
  assert.equal(await probe.isProductShown({ workspaceId: 'ws-someone-else' }, product), 'not_shown');
  assert.equal(await probe.isProductShown({ workspaceId: b.seed.workspaceId }, product), 'shown');
  assert.deepEqual(seen, ['ws-someone-else', b.seed.workspaceId]);
});

test('AMP-100: a live store with no products at all is not_shown; with products but no slug match it is unknown', async () => {
  const w = await createJourneyWorld();
  w.intake('a'); w.rankIdeas('a'); await w.chooseIdea('a');
  await w.build('a');
  const b = w.biz.a;
  const product = await w.productService.getProduct({ workspaceId: b.seed.workspaceId, actorId: 'x' }, b.productId as string);
  const live = await w.sites.resolvePublished(b.slug as string);
  assert.equal(live.status, 'live');
  if (live.status !== 'live') return;
  const probeFor = (products: typeof live.config.products) => createSitePublishedStoreProbe({
    resolvePublished: async () => ({ ...live, config: { ...live.config, products } }),
    storeSlugFor: async () => b.slug as string,
    productSlugsFor: async () => ['renamed-by-the-store-elsewhere'],
  });
  assert.equal(await probeFor([]).isProductShown({ workspaceId: b.seed.workspaceId }, product), 'not_shown');
  assert.equal(await probeFor(live.config.products.map((p) => { const c = { ...p }; delete c.productId; return c; })).isProductShown({ workspaceId: b.seed.workspaceId }, product), 'unknown');
});

test('past orders and every earlier product version still resolve after archiving; new checkouts are refused', async () => {
  let t = 0;
  const w = await createFulfilmentWorld({ now: () => new Date(Date.UTC(2026, 10, 14, 9, 0, t++)) });
  const store = w.stores.a;
  const { orderId } = await w.buy('a');
  const order = await w.orders.get(store.workspaceId, orderId);
  assert.equal(order?.status, 'paid');

  // A second approved version supersedes v1 (v1 is what the order was bought at).
  const svc = createProductService({ store: w.products, generateSpec: async (_p, prev) => structuredClone(prev), now: () => new Date(Date.UTC(2026, 10, 15)) });
  const ctx = { workspaceId: store.workspaceId, actorId: 'owner-a' };
  const v2 = await svc.regenerate(ctx, store.productId);
  await svc.approve(ctx, v2.id);
  const versionsBefore = await svc.listVersions(ctx, store.productId);
  assert.deepEqual(versionsBefore.map((v) => v.status), ['superseded', 'approved']);

  await svc.archiveProduct(ctx, store.productId, store.businessId);

  // Versions identical, each readable by id, including the one the order was bought at.
  assert.deepEqual(await svc.listVersions(ctx, store.productId), versionsBefore);
  for (const v of versionsBefore) assert.deepEqual(await w.products.getVersion(store.workspaceId, v.id), v);
  const bought = versionsBefore.find((v) => v.version === order?.productVersion);
  assert.ok(bought, 'the purchased version exists');
  assert.equal((await svc.previewVersion(ctx, bought.id)).version, order?.productVersion);
  // The order itself still reads, unchanged.
  assert.deepEqual(await w.orders.get(store.workspaceId, orderId), order);
  assert.equal((await w.orders.list(store.workspaceId)).length, 1);

  // Checkout refuses a new purchase through the catalogue API it already calls.
  const r = await w.checkout.startCheckout({ storeSlug: store.slug, listingId: store.listingId, buyerEmail: 'late@example.test', idempotencyKey: 'after-archive' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'listing_not_available');

  // Unarchiving makes the same purchase possible again.
  await svc.unarchiveProduct(ctx, store.productId, store.businessId);
  const again = await w.checkout.startCheckout({ storeSlug: store.slug, listingId: store.listingId, buyerEmail: 'late@example.test', idempotencyKey: 'after-unarchive' });
  assert.equal(again.ok, true);
});
