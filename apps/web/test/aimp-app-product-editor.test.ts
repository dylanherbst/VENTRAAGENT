// Product editor and asset review (screen 13, AMP-084; C02 C03 C05 C06 C07 I05 I10). The server read runs against the REAL product
// service, catalogue service, brand store and files service, built the way app/start/_server/runtime.ts builds them (that file and
// app/start/actions.ts import lib modules without a `.ts` extension, so the node test runner cannot load them: the server actions
// themselves are not run here, but the guard that decides which existing action runs, and with what, is).
//
// "A paid order still resolves the ORIGINAL purchased file after a new version is published" is proved in the files library by
// test/aimp-files-delivery.test.ts, test 'only an approved version can be delivered, stored or previewed'. The last test here adds the
// page-level check: after v2 is approved, this page's own read still lists v1 with the very bytes (fingerprint) the buyer's link serves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCHIVED, BAD_REQUEST, NO_BUSINESS, NO_PRODUCT, NO_VERSION, guardEditorOp, readOp } from '../app/app/[business]/products/[productId]/_server/editor-guard.ts';
import { loadProductEditor } from '../app/app/[business]/products/[productId]/_server/editor.ts';
import type { EditorContexts, EditorRuntime } from '../app/app/[business]/products/[productId]/_server/editor.ts';
import {
  COMING_SOON_ITEMS, DEMO_NOTE, PRICE_MESSAGE, buildEditor, formFromListing, formatBytes, isFormDirty, parsePrice, planNext, priceInputOf, productsHref,
} from '../app/app/[business]/products/[productId]/view-model.ts';
import type { EditorSource, EditorVM } from '../app/app/[business]/products/[productId]/view-model.ts';
import { productHref } from '../app/app/[business]/products/view-model.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService, listingIdFor } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createFilesService, createMemoryFileStorage, createMemoryOrderBook } from '../lib/aimp/files/index.ts';
import type { StoredFile } from '../lib/aimp/files/index.ts';
import { createProductService, MAX_REGENERATIONS } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const ctx: EditorContexts = {
  productCtx: { workspaceId: WS, actorId: OWNER },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` }),
};
const SEED = { blueprintId: 'printable-planner', inputs: { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } as Record<string, string | number> };
const BRAND_INPUT = { niche: 'meal planning', audience: 'busy parents', productType: 'printable planner' };

function realRuntime(store = createMemoryProductStore()) {
  const llm = createProviderRegistry({ env: {} }).llm;
  const seeds = new Map<string, typeof SEED>();
  const spec = (blueprintId: string, inputs: typeof SEED.inputs) => generateProductSpec({ blueprint: blueprintRegistry.find(blueprintId)!, inputs, provider: llm });
  const products = createProductService({ store, generateSpec: (p) => spec(p.blueprintId, seeds.get(p.businessId)!.inputs) });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  return {
    products, brands, assets, seeds, spec, store, catalogue: createCatalogueService({ products, brands, assets }),
    productIds: new Map<string, string[]>(), slugs: new Map<string, string>(), businesses: new Set<string>(),
  };
}
type Rt = ReturnType<typeof realRuntime>;
const asRuntime = (rt: Rt): EditorRuntime => rt;

/** The calls `productsAction({kind:'create'})` makes: seed, product service, cover records, remember the id. */
async function addProduct(rt: Rt, businessId: string, opts: { approve?: boolean } = {}) {
  rt.businesses.add(businessId);
  rt.seeds.set(businessId, SEED);
  const { product, version } = await rt.products.createProduct(ctx.productCtx, { businessId, spec: await rt.spec(SEED.blueprintId, SEED.inputs) });
  for (const role of ['cover', 'preview', 'master'] as const) rt.assets.add({ id: `${product.id}-${role}`, workspaceId: WS, businessId, productId: product.id, role });
  rt.productIds.set(businessId, [...(rt.productIds.get(businessId) ?? []), product.id]);
  if (opts.approve) await rt.products.approve(ctx.productCtx, version.id);
  return { product, version };
}
async function approveBrandFor(rt: Rt, businessId: string, nameIndex = 0) {
  const deps = { store: rt.brands, now: () => new Date() };
  assert.equal((await createBrandDraft(deps, { workspaceId: WS }, businessId, BRAND_INPUT, { nameIndex })).ok, true);
  assert.equal((await approveBrand(deps, { workspaceId: WS }, businessId, OWNER)).ok, true);
}
async function editor(rt: Rt, businessId: string, productId: string): Promise<EditorVM> {
  const r = await loadProductEditor(asRuntime(rt), ctx, businessId, productId);
  assert.equal(r.found, true);
  if (!r.found) throw new Error('unreachable');
  return r.editor;
}
const cat = (businessId: string) => ctx.catalogueCtx(businessId);

// ---- view-model: the price field ----
test('a typed price becomes whole cents without floating point, and anything else is refused with a plain message', () => {
  for (const [text, minor] of [['14', 1400], ['14.5', 1450], ['14.50', 1450], ['$14', 1400], ['$ 14.05', 1405], [' 0.99 ', 99], ['1234567', 123456700], ['0.10', 10], ['19.99', 1999]] as const) {
    assert.deepEqual(parsePrice(text), { ok: true, minor }, text);
  }
  for (const bad of ['', ' ', 'abc', '-5', '14.999', '1,400', '14.', '.5', '1e3', '12345678', '14 AUD', '0x10', 'NaN', 'Infinity']) {
    assert.deepEqual(parsePrice(bad), { ok: false, message: PRICE_MESSAGE }, bad);
  }
  assert.equal(priceInputOf(1400), '14.00');
  assert.equal(priceInputOf(1999), '19.99');
  assert.equal(priceInputOf(Number.NaN), '');
  assert.equal(parsePrice(priceInputOf(1999)).ok && (parsePrice(priceInputOf(1999)) as { minor: number }).minor, 1999);
});

test('file sizes are worded plainly and never NaN', () => {
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  for (const bad of [null, Number.NaN, -1]) assert.equal(formatBytes(bad as number | null), 'Size not recorded');
});

test('the links between the list and the editor are the real addresses', () => {
  assert.equal(productHref('biz-a', 'prod-1'), '/app/biz-a/products/prod-1');
  assert.equal(productsHref('biz-a'), '/app/biz-a/products');
});

// ---- server read over the real services ----
test('a built product shows its listing fields, buyer file, checks, version and the approve step', async () => {
  const rt = realRuntime();
  const { product, version } = await addProduct(rt, 'biz-a');
  const e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.id, product.id);
  assert.equal(e.name, version.spec.title.trim());
  assert.equal(e.type, blueprintRegistry.find('printable-planner')!.title);
  assert.equal(e.status, 'draft');
  assert.equal(e.archived, false);
  assert.equal(e.versions.length, 1);
  assert.equal(e.versions[0].status, 'in_review');
  assert.equal(e.versions[0].statusLabel, 'Ready for your approval');
  assert.equal(e.listing, null, 'no listing is invented before one is written');
  // buyer file: straight from the service's own record
  assert.equal(e.current?.file?.name, version.fileName);
  assert.equal(e.current?.file?.hash, version.fileHash);
  assert.equal(e.current?.file?.pages, `${version.pageCount} pages`);
  assert.deepEqual(e.contents, version.spec.sections.map((s) => ({ title: s.title, pages: s.pages.length })));
  assert.deepEqual(e.includes, version.spec.claims.map((c) => c.text));
  // QA: the service's results, untouched
  assert.deepEqual(e.qa?.checks, version.qa);
  assert.equal(e.qa?.allPassed, true);
  assert.deepEqual(e.pending, { id: version.id, version: 1 });
  assert.equal(e.next.id, 'approve_version');
  assert.match(e.next.title, /Approve version 1/);
  assert.deepEqual(e.regen, { left: MAX_REGENERATIONS, can: true });
});

test('the page walks the real lifecycle: approve version -> write listing -> approve listing, each step from the services', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product, version } = await addProduct(rt, 'biz-a');
  await rt.products.approve(ctx.productCtx, version.id); // what the guard hands to productsAction({kind:'approve'})
  let e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.versions[0].status, 'approved');
  assert.equal(e.pending, null);
  assert.equal(e.status, 'draft', 'approved but not listed is still a draft');
  assert.equal(e.next.id, 'start_listing');

  const draft = await rt.catalogue.createDraft(cat('biz-a'), { businessId: 'biz-a', productId: product.id }); // catalogueAction({kind:'start'})
  e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.next.id, 'approve_listing');
  assert.ok(e.listing);
  assert.equal(e.listing.status, 'draft');
  assert.equal(e.listing.title, draft.title);
  assert.equal(e.listing.shortDescription, draft.shortDescription);
  assert.equal(e.listing.longDescription, draft.longDescription);
  assert.equal(e.listing.priceMinor, draft.priceMinor);
  assert.equal(e.listing.priceInput, (draft.priceMinor / 100).toFixed(2));
  assert.equal(e.listing.productVersion, 1);
  assert.equal(e.listing.behind, false);
  assert.equal(e.listing.approvedPrice, null);
  assert.equal(e.listing.hasCover, draft.cover !== null);

  // an edit made through the form values goes through the real catalogue service, which owns the rules
  const form = { ...formFromListing(e.listing), title: 'A clearer title for couples', price: '19.50' };
  assert.equal(isFormDirty(formFromListing(e.listing), e.listing), false);
  assert.equal(isFormDirty(form, e.listing), true);
  const p = parsePrice(form.price);
  assert.ok(p.ok);
  const saved = await rt.catalogue.editListing(cat('biz-a'), listingIdFor(product.id), { title: form.title, shortDescription: form.shortDescription, longDescription: form.longDescription, priceMinor: p.minor }, { expectedVersion: e.listing.version });
  e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.listing?.title, 'A clearer title for couples');
  assert.equal(e.listing?.price, 'A$19.50');
  assert.equal(e.listing?.version, saved.version);

  await rt.catalogue.approveListing(cat('biz-a'), listingIdFor(product.id), { expectedVersion: e.listing!.version }); // catalogueAction({kind:'approve'})
  e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.status, 'active');
  assert.equal(e.statusLabel, 'Active');
  assert.equal(e.listing?.status, 'approved');
  assert.equal(e.next.id, 'done');
});

test('a service refusal is the real one: a price the catalogue rejects is not saved, and the page still shows the stored listing', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product } = await addProduct(rt, 'biz-a', { approve: true });
  await rt.catalogue.createDraft(cat('biz-a'), { businessId: 'biz-a', productId: product.id });
  const before = (await editor(rt, 'biz-a', product.id)).listing!;
  await assert.rejects(rt.catalogue.editListing(cat('biz-a'), listingIdFor(product.id), { priceMinor: 1 }, { expectedVersion: before.version }));
  assert.deepEqual((await editor(rt, 'biz-a', product.id)).listing, before);
});

test('a new product version is approved without touching the old one, and the listing says which version it still sells', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product, version: v1 } = await addProduct(rt, 'biz-a', { approve: true });
  await rt.catalogue.createDraft(cat('biz-a'), { businessId: 'biz-a', productId: product.id });
  await rt.catalogue.approveListing(cat('biz-a'), listingIdFor(product.id), { expectedVersion: 1 });
  const v2 = await rt.products.regenerate(ctx.productCtx, product.id); // productsAction({kind:'regenerate'})
  let e = await editor(rt, 'biz-a', product.id);
  assert.deepEqual(e.versions.map((v) => v.version), [2, 1], 'newest first');
  assert.deepEqual(e.versions.map((v) => v.status), ['in_review', 'approved']);
  assert.equal(e.current?.version, 1, 'buyers still get the approved v1 while v2 waits');
  assert.equal(e.next.id, 'approve_version');
  assert.deepEqual(e.regen, { left: MAX_REGENERATIONS - 1, can: true });

  await rt.products.approve(ctx.productCtx, v2.id);
  e = await editor(rt, 'biz-a', product.id);
  assert.deepEqual(e.versions.map((v) => v.status), ['approved', 'superseded']);
  assert.equal(e.versions[1].id, v1.id, 'v1 is still listed, by its own id');
  assert.equal(e.versions[1].file?.hash, v1.fileHash, 'v1 keeps its own recorded file');
  assert.match(e.versions[1].note, /already bought this version keep this exact file/);
  assert.equal(e.listing?.productVersion, 1, 'the approved listing still sells the version it was approved for');
  assert.equal(e.listing?.behind, true);
  assert.equal(e.next.id, 'update_listing');
  assert.equal(e.status, 'active', 'the store keeps selling while the owner updates the listing');

  // starting a new draft (any edit) follows the approved product version, and the next step moves on
  await rt.catalogue.editListing(cat('biz-a'), listingIdFor(product.id), { title: 'New wording' }, { expectedVersion: 1 });
  e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.listing?.status, 'draft');
  assert.equal(e.listing?.productVersion, 2);
  assert.equal(e.listing?.behind, false);
  assert.match(e.listing?.approvedPrice ?? '', /^A\$/, 'the approved price is still shown for the draft');
  assert.equal(e.next.id, 'approve_listing');
});

test('rebuilds run out at the product limit and the page says so instead of offering a dead button', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  for (let i = 0; i < MAX_REGENERATIONS; i += 1) await rt.products.regenerate(ctx.productCtx, product.id);
  const e = await editor(rt, 'biz-a', product.id);
  assert.deepEqual(e.regen, { left: 0, can: false });
  assert.equal(e.versions.length, MAX_REGENERATIONS + 1);
});

test('a version that fails its checks cannot be approved from the page, and the next step is to build another', async () => {
  const rt = realRuntime();
  const { product, version } = await addProduct(rt, 'biz-a');
  const failing = buildEditor({
    product, typeTitle: null, maxRegenerations: MAX_REGENERATIONS, listing: [],
    versions: [{ ...version, status: 'qa_failed', qaPassed: false, qa: version.qa.map((q, i) => (i === 0 ? { ...q, passed: false, reasons: ['The title is missing.'] } : q)) }],
  } satisfies EditorSource);
  assert.equal(failing.pending, null);
  assert.equal(failing.next.id, 'rebuild');
  assert.equal(failing.qa?.allPassed, false);
  assert.equal(failing.qa?.checks[0].reasons[0], 'The title is missing.');
  assert.equal(failing.versions[0].statusLabel, 'Failed a check');
  assert.equal(failing.type, 'Product', 'an unknown blueprint is worded neutrally');
  // the real service agrees: a failed version cannot be approved
  const real = await rt.products.listVersions(ctx.productCtx, product.id);
  assert.equal(real[0].status, 'in_review');
});

test('an archived product is read-only: no next step, no rebuilds', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product } = await addProduct(rt, 'biz-a', { approve: true });
  await rt.products.archiveProduct(ctx.productCtx, product.id, 'biz-a');
  const e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.archived, true);
  assert.equal(e.status, 'archived');
  assert.equal(e.next.id, 'archived');
  assert.equal(e.regen.can, false);
  assert.equal(e.versions[0].status, 'approved', 'archiving never touches a version');
});

// ---- AMP-084 rework: the owner sees the checks and file of the version they are about to approve ----
test('only v1, approved: the checks and file shown are v1\'s, labelled as what buyers get, and there is no newer card', async () => {
  const rt = realRuntime();
  const { product, version } = await addProduct(rt, 'biz-a', { approve: true });
  const e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.newer, null);
  assert.equal(e.qa?.version, 1);
  assert.deepEqual(e.qa?.checks, (await rt.products.listVersions(ctx.productCtx, product.id))[0].qa);
  assert.equal(e.current?.file?.hash, version.fileHash);
  assert.equal(e.current?.status, 'approved');
  assert.equal(e.pending, null);
});

test('v1 approved + v2 in review: v2\'s own checks and file are shown for the approve step, while v1 stays the file buyers get', async () => {
  const rt = realRuntime();
  const { product, version: v1 } = await addProduct(rt, 'biz-a', { approve: true });
  const v2 = await rt.products.regenerate(ctx.productCtx, product.id);
  const e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.current?.version, 1);
  assert.equal(e.qa?.version, 1, 'the approved card still belongs to v1');
  assert.equal(e.current?.file?.hash, v1.fileHash);
  assert.ok(e.newer);
  assert.equal(e.newer.version, 2);
  assert.equal(e.newer.status, 'in_review');
  assert.deepEqual(e.newer.qa.checks, v2.qa, 'v2\'s checks, not v1\'s');
  assert.equal(e.newer.qa.version, 2);
  assert.equal(e.newer.file?.name, v2.fileName);
  assert.equal(e.newer.file?.hash, v2.fileHash);
  assert.deepEqual(e.newer.contents, v2.spec.sections.map((s) => ({ title: s.title, pages: s.pages.length })));
  assert.deepEqual(e.pending, { id: v2.id, version: 2 }, 'the approve button targets the version whose checks are shown');
  assert.equal(e.next.id, 'approve_version');
});

test('only an unapproved v1: its own checks and file are the ones shown, with no separate newer card', async () => {
  const rt = realRuntime();
  const { product, version } = await addProduct(rt, 'biz-a');
  const e = await editor(rt, 'biz-a', product.id);
  assert.equal(e.newer, null);
  assert.equal(e.current?.version, 1);
  assert.equal(e.current?.status, 'in_review');
  assert.deepEqual(e.qa?.checks, version.qa);
  assert.equal(e.current?.file?.hash, version.fileHash);
  assert.equal(e.pending?.version, 1);
});

test('an approved v1 with a newest v2 that failed its checks: the next step says so plainly, names v2 and its failed checks, and buyers keep v1', async () => {
  const rt = realRuntime();
  const { product, version: v1 } = await addProduct(rt, 'biz-a', { approve: true });
  const v2 = await rt.products.regenerate(ctx.productCtx, product.id);
  const failedQa = v2.qa.map((q, i) => (i === 0 ? { ...q, passed: false, reasons: ['The title is missing.'] } : q));
  for (const status of ['qa_failed', 'draft'] as const) {
    const e = buildEditor({
      product, typeTitle: null, maxRegenerations: MAX_REGENERATIONS, listing: [],
      versions: [{ ...v1, status: 'approved' }, { ...v2, status, qaPassed: false, qa: failedQa }],
    } satisfies EditorSource);
    assert.equal(e.pending, null);
    assert.equal(e.next.id, 'rebuild', status);
    assert.match(e.next.title, /Version 2 did not pass/);
    assert.match(e.next.text, /version 2/);
    assert.match(e.next.text, /Buyers still get version 1/);
    if (status === 'qa_failed') assert.match(e.next.text, new RegExp(`${failedQa[0].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*The title is missing\\.`));
    assert.equal(e.newer?.version, 2);
    assert.equal(e.newer?.qa.allPassed, false);
    assert.equal(e.newer?.qa.checks[0].reasons[0], 'The title is missing.');
    assert.equal(e.qa?.version, 1);
  }
  // no rebuilds left: the text says so instead of offering another build
  assert.match(planNext({ archived: false, latest: { status: 'qa_failed', version: 3 }, approvedVersion: 1, listing: null, canRebuild: false, latestFailures: ['A check.'] }).text, /no rebuilds left/);
});

test('the page never shows a newer version\'s details for an archived product', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a', { approve: true });
  await rt.products.regenerate(ctx.productCtx, product.id);
  await rt.products.archiveProduct(ctx.productCtx, product.id, 'biz-a');
  assert.equal((await editor(rt, 'biz-a', product.id)).newer, null);
});

// ---- isolation: unknown product, another business, another workspace ----
test('an unknown business, a malformed id, or an id that is not a product is not found', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  for (const [b, p] of [['biz-nope', product.id], ['', product.id], ['__proto__', product.id], ['biz-a', 'prod-nope'], ['biz-a', ''], ['biz-a', '__proto__'], ['biz-a', '../biz-a'], ['biz-a', `${product.id}/x`], ['biz-a', 'x'.repeat(65)]] as const) {
    assert.deepEqual(await loadProductEditor(asRuntime(rt), ctx, b, p), { found: false }, `${b} / ${p}`);
  }
});

test('business isolation: a product of another business is not found, in both directions, and nothing of it leaks', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a', 0);
  await approveBrandFor(rt, 'biz-b', 1);
  const a = await addProduct(rt, 'biz-a', { approve: true });
  const b = await addProduct(rt, 'biz-b', { approve: true });
  await rt.catalogue.createDraft(cat('biz-a'), { businessId: 'biz-a', productId: a.product.id });
  assert.deepEqual(await loadProductEditor(asRuntime(rt), ctx, 'biz-b', a.product.id), { found: false });
  assert.deepEqual(await loadProductEditor(asRuntime(rt), ctx, 'biz-a', b.product.id), { found: false });
  const own = await editor(rt, 'biz-b', b.product.id);
  assert.equal(own.listing, null, 'biz-a\'s listing does not show on biz-b\'s product');
  assert.ok((await editor(rt, 'biz-a', a.product.id)).listing);
});

test('a product id filed under the wrong business is refused even when the index is corrupted', async () => {
  const rt = realRuntime();
  const a = await addProduct(rt, 'biz-a');
  await addProduct(rt, 'biz-b');
  rt.productIds.set('biz-b', [...(rt.productIds.get('biz-b') ?? []), a.product.id]); // the index lies; the service's own business check does not
  assert.deepEqual(await loadProductEditor(asRuntime(rt), ctx, 'biz-b', a.product.id), { found: false });
});

test('the same product read from another workspace is not found', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  const other: EditorContexts = { ...ctx, productCtx: { workspaceId: 'other-workspace', actorId: OWNER } };
  assert.deepEqual(await loadProductEditor(asRuntime(rt), other, 'biz-a', product.id), { found: false });
});

// ---- the checks editProductAction runs before it hands over to the existing actions ----
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };
let rtReads = 0;
const guard = (rt: Rt, availability = ON) => (b: unknown, p: unknown, op: unknown) =>
  guardEditorOp({ availability, rt: () => { rtReads += 1; return asRuntime(rt); }, ctx: { productCtx: ctx.productCtx } }, b, p, op);

test('every edit is refused, with the reason, when demo storage is off, and the runtime is not even read', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  rtReads = 0;
  assert.deepEqual(await guard(rt, OFF)('biz-a', product.id, { kind: 'regenerate' }), { ok: false, message: OFF.reason });
  assert.equal(rtReads, 0);
});

test('edits are refused for malformed, non-string and __proto__ ids, unknown businesses and unknown products', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  const op = { kind: 'regenerate' };
  for (const bad of ['', ' ', '__proto__', 'constructor', '../biz-a', 'biz a', 'x'.repeat(65), undefined, null, 7, {}, ['biz-a']]) {
    assert.deepEqual(await guard(rt)(bad, product.id, op), { ok: false, message: NO_BUSINESS }, String(bad));
    assert.deepEqual(await guard(rt)('biz-a', bad, op), { ok: false, message: NO_PRODUCT }, String(bad));
  }
  assert.deepEqual(await guard(rt)('biz-nope', product.id, op), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(await guard(rt)('biz-a', 'prod-nope', op), { ok: false, message: NO_PRODUCT });
});

test('a business cannot edit another business\'s product, or approve another product\'s version', async () => {
  const rt = realRuntime();
  const a = await addProduct(rt, 'biz-a');
  const b = await addProduct(rt, 'biz-b');
  assert.deepEqual(await guard(rt)('biz-b', a.product.id, { kind: 'regenerate' }), { ok: false, message: NO_PRODUCT });
  assert.deepEqual(await guard(rt)('biz-a', b.product.id, { kind: 'start_listing' }), { ok: false, message: NO_PRODUCT });
  // a version id that exists, but under a different product of the same business or another business
  assert.deepEqual(await guard(rt)('biz-a', a.product.id, { kind: 'approve_version', versionId: b.version.id }), { ok: false, message: NO_VERSION });
  assert.deepEqual(await guard(rt)('biz-a', a.product.id, { kind: 'approve_version', versionId: 'nope' }), { ok: false, message: NO_VERSION });
  const a2 = await addProduct(rt, 'biz-a');
  assert.deepEqual(await guard(rt)('biz-a', a.product.id, { kind: 'approve_version', versionId: a2.version.id }), { ok: false, message: NO_VERSION });
});

test('asking to approve a superseded (older) version id: the guard passes it on (it is this product\'s own), and the real product service decides', async () => {
  const rt = realRuntime();
  const { product, version: v1 } = await addProduct(rt, 'biz-a', { approve: true });
  const v2 = await rt.products.regenerate(ctx.productCtx, product.id);
  await rt.products.approve(ctx.productCtx, v2.id);
  assert.equal((await rt.products.listVersions(ctx.productCtx, product.id))[0].status, 'superseded');
  const g = await guard(rt)('biz-a', product.id, { kind: 'approve_version', versionId: v1.id });
  assert.deepEqual(g, { ok: true, delegate: { target: 'products', op: { kind: 'approve', versionId: v1.id } } });
  // what productsAction({kind:'approve'}) calls next: the service must refuse, and the approved version must not move
  await assert.rejects(rt.products.approve(ctx.productCtx, v1.id), 'the service refuses to re-approve a superseded version');
  const after = await rt.products.listVersions(ctx.productCtx, product.id);
  assert.deepEqual(after.map((v) => v.status), ['superseded', 'approved']);
  assert.equal((await editor(rt, 'biz-a', product.id)).current?.version, 2);
});

test('each allowed edit hands exactly the right existing action op, with this product\'s own listing id', async () => {
  const rt = realRuntime();
  const { product, version } = await addProduct(rt, 'biz-a');
  const lid = listingIdFor(product.id);
  const g = guard(rt);
  assert.deepEqual(await g('biz-a', product.id, { kind: 'approve_version', versionId: version.id }), { ok: true, delegate: { target: 'products', op: { kind: 'approve', versionId: version.id } } });
  assert.deepEqual(await g('biz-a', product.id, { kind: 'regenerate' }), { ok: true, delegate: { target: 'products', op: { kind: 'regenerate', productId: product.id } } });
  assert.deepEqual(await g('biz-a', product.id, { kind: 'start_listing' }), { ok: true, delegate: { target: 'catalogue', op: { kind: 'start', productId: product.id } } });
  assert.deepEqual(await g('biz-a', product.id, { kind: 'repin_listing' }), { ok: true, delegate: { target: 'catalogue', op: { kind: 'repin', listingId: lid } } });
  assert.deepEqual(await g('biz-a', product.id, { kind: 'approve_listing', version: 2 }), { ok: true, delegate: { target: 'catalogue', op: { kind: 'approve', listingId: lid, version: 2 } } });
  assert.deepEqual(
    await g('biz-a', product.id, { kind: 'save_listing', version: 1, title: 'T', shortDescription: 'S', longDescription: 'L', priceMinor: 1450, listingId: 'someone-elses', productId: 'other' }),
    { ok: true, delegate: { target: 'catalogue', op: { kind: 'save', listingId: lid, version: 1, title: 'T', shortDescription: 'S', longDescription: 'L', priceMinor: 1450 } } },
    'extra fields in the request, such as another listing id, are dropped',
  );
});

test('requests with an unknown kind or the wrong field types are refused before anything runs', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  const save = { kind: 'save_listing', version: 1, title: 'T', shortDescription: 'S', longDescription: 'L', priceMinor: 1450 };
  const bad: unknown[] = [
    undefined, null, 'regenerate', 7, [], {}, { kind: 'delete_everything' }, { kind: '__proto__' }, { kind: 'approve_version' }, { kind: 'approve_version', versionId: 7 }, { kind: 'approve_version', versionId: '' },
    { kind: 'approve_listing' }, { kind: 'approve_listing', version: 0 }, { kind: 'approve_listing', version: 1.5 }, { kind: 'approve_listing', version: '1' }, { kind: 'approve_listing', version: Number.NaN },
    { ...save, version: -1 }, { ...save, title: 5 }, { ...save, shortDescription: null }, { ...save, longDescription: 'x'.repeat(20_001) }, { ...save, priceMinor: '1450' }, { ...save, priceMinor: 14.5 },
    { ...save, priceMinor: Number.POSITIVE_INFINITY }, { ...save, priceMinor: undefined },
  ];
  for (const op of bad) assert.deepEqual(await guard(rt)('biz-a', product.id, op), { ok: false, message: BAD_REQUEST }, JSON.stringify(op));
  assert.equal(readOp({ kind: 'regenerate', extra: 1 })?.kind, 'regenerate');
});

test('an archived product refuses every edit', async () => {
  const rt = realRuntime();
  const { product } = await addProduct(rt, 'biz-a');
  await rt.products.archiveProduct(ctx.productCtx, product.id, 'biz-a');
  assert.deepEqual(await guard(rt)('biz-a', product.id, { kind: 'regenerate' }), { ok: false, message: ARCHIVED });
  assert.deepEqual(await guard(rt)('biz-a', product.id, { kind: 'start_listing' }), { ok: false, message: ARCHIVED });
});

// ---- honest copy ----
test('the page says it is a demo, and lists what it cannot do yet without claiming it does', () => {
  assert.match(DEMO_NOTE, /memory/);
  assert.match(DEMO_NOTE, /not an AI model/);
  assert.ok(COMING_SOON_ITEMS.length >= 5);
  const all = COMING_SOON_ITEMS.map((i) => `${i.title} ${i.text}`).join(' ');
  assert.doesNotMatch(all, /guarantee|earn|revenue|customers? (love|trust)|\d+%/i);
  for (const i of COMING_SOON_ITEMS) assert.ok(i.title.length > 0 && i.text.length > 0);
});

// ---- the acceptance line: a paid order keeps resolving the original file after a new version is published ----
test('a buyer who paid for v1 still gets v1\'s exact file after v2 is approved, and this page still shows that v1', async () => {
  const store = createMemoryProductStore();
  const rt = realRuntime(store);
  const { product, version } = await addProduct(rt, 'biz-a', { approve: true });
  const A = { workspaceId: WS, businessId: 'biz-a', actorId: OWNER };
  const bought = await rt.products.getBuyerFile(ctx.productCtx, product.id);
  const master: StoredFile = { fileName: bought.fileName, contentType: bought.contentType, bytes: bought.bytes };
  const orders = createMemoryOrderBook();
  const files = createFilesService({ storage: createMemoryFileStorage(), orders, products: store, secret: 'test-only-signing-secret-0123456789abcdef', now: () => new Date('2026-11-14T00:00:00Z') });
  await files.storeMaster(A, version.id, master);
  orders.addPaidOrder({ orderId: 'o1', itemId: 'i1', workspaceId: WS, businessId: 'biz-a', productId: product.id, productVersion: 1 });
  const { token } = await files.issueGrant(A, 'i1');

  const before = await editor(rt, 'biz-a', product.id);
  assert.equal(before.versions[0].file?.hash, version.fileHash);

  const v2 = await rt.products.regenerate(ctx.productCtx, product.id);
  await rt.products.approve(ctx.productCtx, v2.id);

  const after = await editor(rt, 'biz-a', product.id);
  assert.deepEqual(after.versions.map((v) => v.status), ['approved', 'superseded']);
  const v1 = after.versions.find((v) => v.version === 1)!;
  assert.equal(v1.status, 'superseded');
  assert.equal(v1.file?.hash, version.fileHash, 'the page still shows v1\'s original fingerprint');

  const served = await files.redeem(token);
  assert.ok(served.ok, 'the buyer\'s existing link still works');
  assert.equal(served.sha256, v1.file?.hash, 'and serves exactly the file the page lists for v1');
  assert.deepEqual(Buffer.from(served.file.bytes), Buffer.from(master.bytes));
  const fresh = await files.issueGrant(A, 'i1');
  const again = await files.redeem(fresh.token);
  assert.ok(again.ok && again.sha256 === version.fileHash, 'a re-issued link for the same paid order is still v1');
});
