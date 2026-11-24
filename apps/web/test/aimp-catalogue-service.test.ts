import assert from 'node:assert/strict';
import test from 'node:test';
import { getApprovedBrand } from '../lib/aimp/branding/index.ts';
import {
  CatalogueError, createCatalogueService, createMemoryCatalogueStore, createMemoryCoverAssets, listingIdFor, toPublicListing, toStoreProduct,
} from '../lib/aimp/catalogue/index.ts';
import type { CatalogueListing, OperationContext } from '../lib/aimp/catalogue/index.ts';
import { createDemoCatalogue, seedApprovedBrand, seedApprovedProduct } from '../lib/aimp/catalogue/demo.ts';
import type { SeededProduct } from '../lib/aimp/catalogue/demo.ts';

const ctxFor = (workspaceId: string, businessId: string, actor = 'owner'): OperationContext => ({ workspaceId, businessId, actorUserId: actor, idempotencyKey: `k-${workspaceId}` });
const A = ctxFor('ws-a', 'biz-a', 'owner-a');
const B = ctxFor('ws-b', 'biz-b', 'owner-b');
const code = (c: string) => (e: unknown) => e instanceof CatalogueError && e.code === c;
const field = (f: string) => (e: unknown) => e instanceof CatalogueError && e.issues.some((i) => i.field === f);

async function setup(opts: { brand?: boolean } = {}) {
  let tick = 0;
  const d = createDemoCatalogue(() => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++)), {});
  const p = await seedApprovedProduct(d, A, 'biz-a');
  if (opts.brand !== false) await seedApprovedBrand(d, A, 'biz-a', p.title);
  const id = listingIdFor(p.productId);
  return { d, p, id, svc: d.catalogue };
}
const draft = async (s: Awaited<ReturnType<typeof setup>>) => s.svc.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
const approved = async (s: Awaited<ReturnType<typeof setup>>) => { await draft(s); return s.svc.approveListing(A, s.id); };

test('a draft points at the approved product version, uses the approved brand copy and the suggested price', async () => {
  const s = await setup();
  const l = await draft(s);
  const brand = await getApprovedBrand({ store: s.d.brands }, { workspaceId: 'ws-a' }, 'biz-a');
  assert.ok(brand);
  assert.equal(l.status, 'draft');
  assert.equal(l.version, 1);
  assert.equal(l.productVersionId, s.p.versionId);
  assert.equal(l.productVersion, 1);
  assert.equal(l.title, s.p.title);
  assert.equal(l.shortDescription, brand.shortDescription);
  assert.equal(l.longDescription, brand.longDescription);
  assert.deepEqual(l.cover, { assetId: s.p.assets.cover.id, role: 'cover' });
  assert.equal(l.currency, 'AUD');
  assert.equal(l.priceMinor, (await s.svc.suggestPrice(A, s.id)).suggestedMinor);
  assert.ok(Number.isInteger(l.priceMinor));
  assert.equal(l.editedBySeller, false);
  assert.equal(l.history.length, 1);
  assert.equal(l.history[0]?.kind, 'created');
  assert.equal(l.approvedAt, null);
});

test('a draft needs an approved product, an approved brand, and only one listing per product', async () => {
  const s = await setup();
  // product with no approved version
  const noApproved = createCatalogueService({
    products: { getProduct: s.d.products.getProduct, listVersions: async (c, id) => (await s.d.products.listVersions(c, id)).map((v) => ({ ...v, status: 'in_review' as const })) },
    brands: s.d.brands, assets: s.d.assets,
  });
  await assert.rejects(noApproved.createDraft(A, { businessId: 'biz-a', productId: s.p.productId }), code('product_not_approved'));
  // a business with no approved brand
  const t = await setup({ brand: false });
  await assert.rejects(t.svc.createDraft(A, { businessId: 'biz-a', productId: t.p.productId }), code('brand_not_approved'));
  // second draft for the same product
  await draft(s);
  await assert.rejects(draft(s), code('already_exists'));
});

test('a product from another business cannot be listed', async () => {
  const s = await setup();
  await assert.rejects(s.svc.createDraft({ ...A, businessId: undefined }, { businessId: 'biz-other', productId: s.p.productId }), code('not_found'));
  await assert.rejects(s.svc.createDraft(A, { businessId: 'biz-other', productId: s.p.productId }), code('not_found'));
});

test('approve as-is: checkout uses the stored approved price', async () => {
  const s = await setup();
  const d1 = await draft(s);
  await assert.rejects(s.svc.getCheckoutPrice(A, s.id), code('not_approved'), 'a draft has no checkout price');
  const a = await s.svc.approveListing(A, s.id);
  assert.equal(a.status, 'approved');
  assert.equal(a.approvedBy, 'owner-a');
  assert.ok(a.approvedAt);
  assert.equal(a.editedBySeller, false);
  const price = await s.svc.getCheckoutPrice(A, s.id);
  assert.equal(price.priceMinor, d1.priceMinor);
  assert.equal(price.currency, 'AUD');
  assert.equal(price.listingVersion, 1);
  assert.equal(price.productVersion, 1);
  assert.equal(price.title, s.p.title);
  const hist = (await s.svc.getListing(A, s.id))?.history.map((h) => h.kind);
  assert.deepEqual(hist, ['created', 'approved']);
});

test('getCheckoutPrice cannot be given a price: any extra argument is ignored', async () => {
  const s = await setup();
  const a = await approved(s);
  const sneaky = s.svc.getCheckoutPrice as unknown as (c: OperationContext, id: string, clientPriceMinor: number) => Promise<{ priceMinor: number }>;
  assert.equal((await sneaky(A, s.id, 1)).priceMinor, a.priceMinor);
});

test('edit then approve: the seller price is the one checkout uses, and the edit is recorded', async () => {
  const s = await setup();
  const before = await draft(s);
  const edited = await s.svc.editListing(A, s.id, { title: 'Wedding Planner Pro', priceMinor: 1650 });
  assert.equal(edited.status, 'draft');
  assert.equal(edited.version, 1, 'a draft is edited in place');
  assert.equal(edited.editedBySeller, true);
  assert.equal(edited.title, 'Wedding Planner Pro');
  assert.deepEqual(edited.history.at(-1)?.changes, [
    { field: 'title', from: before.title, to: 'Wedding Planner Pro' },
    { field: 'priceMinor', from: before.priceMinor, to: 1650 },
  ]);
  await s.svc.approveListing(A, s.id);
  const price = await s.svc.getCheckoutPrice(A, s.id);
  assert.equal(price.priceMinor, 1650);
  assert.equal(price.title, 'Wedding Planner Pro');
});

test('editing an approved listing starts a new draft and the approved price stays until it is approved', async () => {
  const s = await setup();
  const v1 = await approved(s);
  const v2 = await s.svc.editListing(A, s.id, { priceMinor: v1.priceMinor + 500, shortDescription: 'A calm, simple planner for the whole wedding journey.' });
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'draft');
  assert.equal(v2.editedBySeller, true);
  assert.equal(v2.approvedAt, null);
  assert.equal(v2.approvedBy, null);

  const during = await s.svc.getCheckoutPrice(A, s.id);
  assert.equal(during.priceMinor, v1.priceMinor, 'checkout still charges the approved price');
  assert.equal(during.listingVersion, 1);
  assert.equal((await s.svc.getApprovedListing(A, s.id))?.version, 1);
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a'))[0]?.priceMinor, v1.priceMinor);
  assert.deepEqual((await s.svc.listVersions(A, s.id)).map((v) => [v.version, v.status]), [[1, 'approved'], [2, 'draft']]);

  // a further edit changes the same draft
  const v2b = await s.svc.editListing(A, s.id, { priceMinor: v1.priceMinor + 700 });
  assert.equal(v2b.version, 2);
  assert.equal((await s.svc.getCheckoutPrice(A, s.id)).priceMinor, v1.priceMinor);

  await s.svc.approveListing(A, s.id);
  const after = await s.svc.getCheckoutPrice(A, s.id);
  assert.equal(after.priceMinor, v1.priceMinor + 700);
  assert.equal(after.listingVersion, 2);
  const all = await s.svc.listVersions(A, s.id);
  assert.deepEqual(all.map((v) => [v.version, v.status]), [[1, 'superseded'], [2, 'approved']]);
  assert.equal(all.filter((v) => v.status === 'approved').length, 1);
  // version history of edits is kept
  assert.deepEqual(all[1]?.history.map((h) => h.kind), ['created', 'approved', 'edited', 'edited', 'approved']);
  // the superseded version keeps its own price
  assert.equal(all[0]?.priceMinor, v1.priceMinor);
});

test('saving with nothing changed writes nothing', async () => {
  const s = await setup();
  const l = await draft(s);
  const same = await s.svc.editListing(A, s.id, { title: `  ${l.title}  `, priceMinor: l.priceMinor });
  assert.deepEqual(same, l);
  const a = await s.svc.approveListing(A, s.id);
  const again = await s.svc.editListing(A, s.id, { priceMinor: a.priceMinor });
  assert.equal(again.version, 1);
  assert.equal((await s.svc.listVersions(A, s.id)).length, 1, 'no new draft for a no-op edit');
});

test('validation: title, descriptions and price are checked and nothing is saved on failure', async () => {
  const s = await setup();
  const l = await draft(s);
  await assert.rejects(s.svc.editListing(A, s.id, { title: 'ab' }), field('title'));
  await assert.rejects(s.svc.editListing(A, s.id, { title: 'x'.repeat(81) }), field('title'));
  await assert.rejects(s.svc.editListing(A, s.id, { title: '   ' }), field('title'));
  await assert.rejects(s.svc.editListing(A, s.id, { title: 'Nice <b>planner</b>' }), field('title'));
  await assert.rejects(s.svc.editListing(A, s.id, { shortDescription: '' }), field('shortDescription'));
  await assert.rejects(s.svc.editListing(A, s.id, { shortDescription: 'x'.repeat(161) }), field('shortDescription'));
  await assert.rejects(s.svc.editListing(A, s.id, { longDescription: '   ' }), field('longDescription'));
  await assert.rejects(s.svc.editListing(A, s.id, { longDescription: 'y'.repeat(601) }), field('longDescription'));
  await assert.rejects(s.svc.editListing(A, s.id, { longDescription: 'Guaranteed to make money while you sleep, risk-free.' }), field('longDescription'));
  for (const bad of [299, 10001, 0, -500, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(s.svc.editListing(A, s.id, { priceMinor: bad }), field('priceMinor'), `price ${bad}`);
  }
  await assert.rejects(s.svc.editListing(A, s.id, { priceMinor: '1200' as unknown as number }), field('priceMinor'));
  await assert.rejects(s.svc.editListing(A, s.id, { currency: 'USD' } as never), field('currency'));
  await assert.rejects(s.svc.editListing(A, s.id, { status: 'approved', approvedBy: 'me' } as never), field('status'));
  // several problems are reported together
  await assert.rejects(s.svc.editListing(A, s.id, { title: 'a', priceMinor: 5 }), (e: unknown) => e instanceof CatalogueError && e.issues.length === 2);
  // the failed edits above left the draft exactly as it was
  const fresh = await s.svc.getListing(A, s.id);
  assert.equal(fresh?.title, l.title);
  assert.equal(fresh?.priceMinor, l.priceMinor);
  assert.equal(fresh?.shortDescription, l.shortDescription);
  assert.equal(fresh?.longDescription, l.longDescription);
  assert.deepEqual(fresh, l);
  // boundaries are accepted
  assert.equal((await s.svc.editListing(A, s.id, { priceMinor: 300 })).priceMinor, 300);
  assert.equal((await s.svc.editListing(A, s.id, { priceMinor: 10000 })).priceMinor, 10000);
  assert.equal((await s.svc.editListing(A, s.id, { title: 'abc' })).title, 'abc');
});

test('a cover that is not found is reported on its own, and a cover from another business is refused', async () => {
  const s = await setup();
  await draft(s);
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: 'no-such-image' }), (e: unknown) =>
    e instanceof CatalogueError && e.issues.length === 1 && e.issues[0]?.field === 'cover' && /not found/.test(e.issues[0].message) && !/master/i.test(e.message));
  s.d.assets.add({ id: 'other-biz-img', workspaceId: 'ws-a', businessId: 'biz-other', productId: s.p.productId, role: 'cover' });
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: 'other-biz-img' }), (e: unknown) =>
    e instanceof CatalogueError && e.issues.length === 1 && /not found/.test(e.issues[0]?.message ?? ''));
  assert.equal((await s.svc.getListing(A, s.id))?.cover?.assetId, s.p.assets.cover.id);
});

test('a cover change after approval makes a new draft while the approved cover stays', async () => {
  const s = await setup();
  const v1 = await approved(s);
  assert.equal(v1.cover?.assetId, s.p.assets.cover.id);
  const v2 = await s.svc.editListing(A, s.id, { coverAssetId: s.p.assets.preview.id });
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'draft');
  assert.deepEqual(v2.cover, { assetId: s.p.assets.preview.id, role: 'preview' });
  assert.equal((await s.svc.getApprovedListing(A, s.id))?.cover?.assetId, s.p.assets.cover.id);
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a'))[0]?.cover.assetId, s.p.assets.cover.id);
  await s.svc.approveListing(A, s.id);
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a'))[0]?.cover.assetId, s.p.assets.preview.id);
});

test('the store refuses two approved versions or two open drafts of one listing', async () => {
  const s = await setup();
  const store = createMemoryCatalogueStore();
  const svc = createCatalogueService({ store, products: s.d.products, brands: s.d.brands, assets: s.d.assets });
  const l = await svc.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
  const approvedRow = (n: number): CatalogueListing => ({ ...l, id: `${l.listingId}-v${n}`, version: n, status: 'approved', approvedAt: 't', approvedBy: 'me' });
  const draftRow = (n: number): CatalogueListing => ({ ...l, id: `${l.listingId}-v${n}`, version: n, status: 'draft' });
  await assert.rejects(store.mutate('ws-a', l.listingId, () => ({ versions: [approvedRow(1), approvedRow(2)], result: null })), code('conflict'));
  await assert.rejects(store.mutate('ws-a', l.listingId, () => ({ versions: [draftRow(1), draftRow(2)], result: null })), code('conflict'));
  await assert.rejects(store.mutate('ws-a', l.listingId, () => ({ versions: [draftRow(1), { ...draftRow(1), status: 'superseded' }], result: null })), code('conflict'), 'duplicate version number');
  // nothing was saved by the refused writes
  assert.deepEqual((await store.list('ws-a', l.listingId)).map((v) => [v.version, v.status]), [[1, 'draft']]);
});

test('a draft with a bad stored field cannot be approved', async () => {
  const s = await setup();
  await draft(s);
  await s.svc.editListing(A, s.id, { coverAssetId: null });
  await assert.rejects(s.svc.approveListing(A, s.id), field('cover'));
  assert.equal((await s.svc.getListing(A, s.id))?.status, 'draft');
  await assert.rejects(s.svc.getCheckoutPrice(A, s.id), code('not_approved'));
});

test('master files can never be a cover', async () => {
  const s = await setup();
  await draft(s);
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: s.p.assets.master.id }), (e: unknown) =>
    e instanceof CatalogueError && e.issues.some((i) => i.field === 'cover' && /master file/i.test(i.message)));
  assert.equal((await s.svc.getListing(A, s.id))?.cover?.role, 'cover', 'the cover did not change');
  // a preview is fine
  const ok = await s.svc.editListing(A, s.id, { coverAssetId: s.p.assets.preview.id });
  assert.deepEqual(ok.cover, { assetId: s.p.assets.preview.id, role: 'preview' });

  // a listing cannot be created from a product whose only image is a master
  const t = await setup();
  const onlyMaster = createMemoryCoverAssets();
  onlyMaster.add(t.p.assets.master);
  const svc = createCatalogueService({ products: t.d.products, brands: t.d.brands, assets: onlyMaster });
  const l = await svc.createDraft(A, { businessId: 'biz-a', productId: t.p.productId });
  assert.equal(l.cover, null, 'a master is never picked automatically');
  await assert.rejects(svc.approveListing(A, listingIdFor(t.p.productId)), field('cover'));
});

test('the store refuses an approved listing whose cover is a master, even if the service were bypassed', async () => {
  const s = await setup();
  const store = createMemoryCatalogueStore();
  const svc = createCatalogueService({ store, products: s.d.products, brands: s.d.brands, assets: s.d.assets });
  const l = await svc.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
  await assert.rejects(
    store.mutate('ws-a', l.listingId, (vs) => ({ versions: vs.map((v) => ({ ...v, status: 'approved' as const, cover: { assetId: 'x', role: 'master' as const }, approvedAt: 'now', approvedBy: 'me' })), result: null })),
    code('conflict'),
  );
  assert.equal((await store.list('ws-a', l.listingId))[0]?.status, 'draft');
});

test('a cover must be an image of this product in this workspace', async () => {
  const s = await setup();
  await draft(s);
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: 'no-such-image' }), field('cover'));
  s.d.assets.add({ id: 'other-prod-img', workspaceId: 'ws-a', businessId: 'biz-a', productId: 'some-other-product', role: 'cover' });
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: 'other-prod-img' }), field('cover'));
  s.d.assets.add({ id: 'ws-b-img', workspaceId: 'ws-b', businessId: 'biz-b', productId: s.p.productId, role: 'cover' });
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: 'ws-b-img' }), field('cover'));
  await assert.rejects(s.svc.editListing(A, s.id, { coverAssetId: '' }), field('cover'));
});

test('another workspace sees nothing and changes nothing', async () => {
  const s = await setup();
  const a = await approved(s);
  assert.equal(await s.svc.getListing(B, s.id), null);
  assert.equal(await s.svc.getApprovedListing(B, s.id), null);
  assert.deepEqual(await s.svc.listVersions(B, s.id), []);
  assert.deepEqual(await s.svc.listApprovedForBusiness(B, 'biz-a'), []);
  assert.deepEqual(await s.svc.listApprovedForBusiness({ ...B, businessId: undefined }, 'biz-a'), []);
  await assert.rejects(s.svc.getCheckoutPrice(B, s.id), code('not_found'));
  await assert.rejects(s.svc.editListing(B, s.id, { priceMinor: 301 }), code('not_found'));
  await assert.rejects(s.svc.approveListing(B, s.id), code('not_found'));
  await assert.rejects(s.svc.repinProduct(B, s.id), code('not_found'));
  await assert.rejects(s.svc.suggestPrice(B, s.id), code('not_found'));
  await assert.rejects(s.svc.createDraft(B, { businessId: 'biz-b', productId: s.p.productId }), code('not_found'));
  // the same message as a listing that does not exist
  const missing = await s.svc.getCheckoutPrice(B, 'listing-nope').catch((e: unknown) => e);
  const foreign = await s.svc.getCheckoutPrice(B, s.id).catch((e: unknown) => e);
  assert.equal((missing as Error).message, (foreign as Error).message);
  // and the owner's data did not change
  assert.equal((await s.svc.getCheckoutPrice(A, s.id)).priceMinor, a.priceMinor);
  assert.equal((await s.svc.listVersions(A, s.id)).length, 1);
});

test('the right workspace with the wrong business is refused too', async () => {
  const s = await setup();
  await approved(s);
  const wrongBiz = { ...A, businessId: 'biz-z' };
  assert.equal(await s.svc.getListing(wrongBiz, s.id), null);
  await assert.rejects(s.svc.getCheckoutPrice(wrongBiz, s.id), code('not_found'));
  await assert.rejects(s.svc.editListing(wrongBiz, s.id, { priceMinor: 301 }), code('not_found'));
});

test('writes need a signed-in user and a workspace', async () => {
  const s = await setup();
  await assert.rejects(s.svc.createDraft({ ...A, actorUserId: '' }, { businessId: 'biz-a', productId: s.p.productId }), code('invalid'));
  await draft(s);
  await assert.rejects(s.svc.editListing({ ...A, workspaceId: '' }, s.id, { priceMinor: 400 }), code('invalid'));
  await assert.rejects(s.svc.approveListing({ ...A, actorUserId: '  ' }, s.id), code('invalid'));
  await assert.rejects(s.svc.getCheckoutPrice({ ...A, workspaceId: '' }, s.id), code('not_found'));
  assert.equal(await s.svc.getListing(A, s.id).then((l) => l?.status), 'draft');
});

test('a stale page cannot overwrite a newer version', async () => {
  const s = await setup();
  await draft(s);
  await s.svc.editListing(A, s.id, { priceMinor: 1300 });
  await assert.rejects(s.svc.approveListing(A, s.id, { expectedVersion: 2 }), code('stale'));
  await assert.rejects(s.svc.editListing(A, s.id, { priceMinor: 1400 }, { expectedVersion: 7 }), code('stale'));
  assert.equal((await s.svc.getListing(A, s.id))?.priceMinor, 1300);
  assert.equal((await s.svc.approveListing(A, s.id, { expectedVersion: 1 })).version, 1);
  await assert.rejects(s.svc.approveListing(A, s.id), code('not_draft'));
});

test('if the product gets a new approved version, the listing must be moved to it before approval', async () => {
  const s = await setup();
  const l = await draft(s);
  const v2 = await s.d.products.regenerate({ workspaceId: 'ws-a', actorId: 'owner-a' }, s.p.productId);
  await s.d.products.approve({ workspaceId: 'ws-a', actorId: 'owner-a' }, v2.id);
  await assert.rejects(s.svc.approveListing(A, s.id), code('product_version_changed'));
  const moved = await s.svc.repinProduct(A, s.id);
  assert.equal(moved.productVersion, 2);
  assert.equal(moved.productVersionId, v2.id);
  assert.equal(moved.history.at(-1)?.kind, 'repinned');
  assert.equal(moved.priceMinor, l.priceMinor);
  assert.equal((await s.svc.repinProduct(A, s.id)).history.length, moved.history.length, 'repinning twice changes nothing');
  const a = await s.svc.approveListing(A, s.id);
  assert.equal(a.productVersion, 2);
  assert.equal((await s.svc.getCheckoutPrice(A, s.id)).productVersion, 2);
});

test('an approved listing keeps its price when the product is re-versioned, and an edit follows the new version', async () => {
  const s = await setup();
  const a = await approved(s);
  const v2 = await s.d.products.regenerate({ workspaceId: 'ws-a', actorId: 'owner-a' }, s.p.productId);
  await s.d.products.approve({ workspaceId: 'ws-a', actorId: 'owner-a' }, v2.id);
  const p = await s.svc.getCheckoutPrice(A, s.id);
  assert.equal(p.priceMinor, a.priceMinor);
  assert.equal(p.productVersion, 1, 'the listing still names the product version it was approved for');
  const next = await s.svc.editListing(A, s.id, { priceMinor: a.priceMinor + 100 });
  assert.equal(next.productVersion, 2);
  assert.equal(next.status, 'draft');
  await s.svc.approveListing(A, s.id);
});

test('checkout is refused when the product is no longer approved', async () => {
  const s = await setup();
  let hide = false;
  const svc = createCatalogueService({
    store: createMemoryCatalogueStore(),
    products: { getProduct: s.d.products.getProduct, listVersions: async (c, id) => (await s.d.products.listVersions(c, id)).map((v) => (hide ? { ...v, status: 'superseded' as const } : v)) },
    brands: s.d.brands, assets: s.d.assets,
  });
  await svc.createDraft(A, { businessId: 'biz-a', productId: s.p.productId });
  await svc.approveListing(A, s.id);
  assert.ok((await svc.getCheckoutPrice(A, s.id)).priceMinor > 0);
  hide = true;
  await assert.rejects(svc.getCheckoutPrice(A, s.id), code('product_not_approved'));
});

test('the storefront gets approved listings only, with public fields only', async () => {
  const s = await setup();
  await draft(s);
  assert.deepEqual(await s.svc.listApprovedForBusiness(A, 'biz-a'), [], 'a draft is not shown');
  const a = await s.svc.approveListing(A, s.id);
  const [pub] = await s.svc.listApprovedForBusiness(A, 'biz-a');
  assert.ok(pub);
  assert.deepEqual(Object.keys(pub).sort(), ['businessId', 'cover', 'currency', 'listingId', 'longDescription', 'priceMinor', 'productId', 'shortDescription', 'title']);
  assert.deepEqual(pub, toPublicListing(a));
  assert.notEqual(pub.cover.role, 'master');
  // a draft edit does not leak into what the storefront shows
  await s.svc.editListing(A, s.id, { title: 'Brand new title' });
  assert.equal((await s.svc.listApprovedForBusiness(A, 'biz-a'))[0]?.title, a.title);
});

test('an approved listing becomes a valid storefront product', async () => {
  const s = await setup();
  const a = await approved(s);
  const pub = toPublicListing(a);
  const sp = toStoreProduct(pub, { coverStyle: 'grid', pages: 12, includes: ['12 monthly pages'] });
  assert.equal(sp.priceMinor, a.priceMinor);
  assert.equal(sp.title, a.title);
  assert.equal(sp.summary, a.shortDescription);
  assert.deepEqual(sp.description, [a.longDescription]);
  assert.deepEqual(sp.cover, { style: 'grid', label: a.title });
  assert.match(sp.slug, /^[a-z0-9-]{3,}$/);
  assert.equal(sp.format, 'PDF');
});

test('suggestPrice for a listing explains itself and follows new comparables', async () => {
  const s = await setup();
  await draft(s);
  const base = await s.svc.suggestPrice(A, s.id);
  assert.equal(base.basis, 'family_default');
  const withComps = await s.svc.suggestPrice(A, s.id, { comparablePricesMinor: [1000, 1500, 2000] });
  assert.equal(withComps.basis, 'comparables');
  assert.equal(withComps.suggestedMinor, 1500);
  assert.ok(withComps.reasons.length >= 3);
});

test('comparable prices given when the draft is created are used and kept', async () => {
  const s = await setup();
  const l = await s.svc.createDraft(A, { businessId: 'biz-a', productId: s.p.productId, comparablePricesMinor: [900, 1000, 1100, 5, 99999] });
  assert.deepEqual(l.comparablePricesMinor, [900, 1000, 1100]);
  assert.equal(l.priceMinor, 1000);
  assert.equal((await s.svc.suggestPrice(A, s.id)).basis, 'comparables');
});

test('stored versions are copies: changing a returned listing does not change the store', async () => {
  const s = await setup();
  const a = await approved(s);
  (a as CatalogueListing).priceMinor = 1;
  const seeded: SeededProduct = s.p;
  assert.ok(seeded.productId);
  assert.notEqual((await s.svc.getCheckoutPrice(A, s.id)).priceMinor, 1);
});
