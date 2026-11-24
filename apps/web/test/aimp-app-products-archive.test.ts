// Products page: archive and restore (AMP-097; E01; service AMP-096 + AMP-100). The server action itself is NOT run here:
// `archiveProductAction` (app/app/[business]/products/actions.ts) imports Next-only modules, so node cannot load it. What is run is
// `runArchive` and `runArchiveSafely` (products/_server/archive.ts), the two functions the action forwards to, against the real
// product, catalogue and brand services on the same in-memory factories app/start/_server/runtime.ts uses. One test reads actions.ts
// as text to check that the action really is only that forward.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ARCHIVED_OK, BAD_REQUEST, NEEDS_CONFIRM, NO_BUSINESS, NO_PRODUCT, REPUBLISH_NEEDED, REPUBLISH_UNKNOWN, RESTORED_OK, WENT_WRONG,
  readArchiveOp, republishFrom, runArchive, runArchiveSafely, websiteHref,
} from '../app/app/[business]/products/_server/archive.ts';
import { NO_BUSINESS as OWN_NO_BUSINESS, NO_PRODUCT as OWN_NO_PRODUCT, checkOwnProduct } from '../app/app/[business]/products/_server/own-product.ts';
import type { ArchiveGuardInput } from '../app/app/[business]/products/_server/archive.ts';
import { loadProducts } from '../app/app/[business]/products/_server/products.ts';
import type { ProductsContexts } from '../app/app/[business]/products/_server/products.ts';
import {
  ARCHIVED_DETAIL, LIMIT_COUNTS_ARCHIVED, applyFilter, archivedHint, buildRow, confirmArchiveText, filterCounts,
} from '../app/app/[business]/products/view-model.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService, listingIdFor } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import type { PublishedStoreProbe, StoreShowsProduct } from '../lib/aimp/products/published-store.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const productCtx = { workspaceId: WS, actorId: OWNER };
const ctx: ProductsContexts = {
  productCtx,
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` }),
  maxProducts: 3,
};
const SEED = { blueprintId: 'printable-planner', inputs: { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } as Record<string, string | number> };
const BRAND_INPUT = { niche: 'meal planning', audience: 'busy parents', productType: 'printable planner' };
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };

/** The /start runtime's wiring. `probe` is absent there today, which is the demo case; tests pass one to drive the three answers. */
function realRuntime(probe?: PublishedStoreProbe) {
  const llm = createProviderRegistry({ env: {} }).llm;
  const seeds = new Map<string, typeof SEED>();
  const spec = (blueprintId: string, inputs: typeof SEED.inputs) => generateProductSpec({ blueprint: blueprintRegistry.find(blueprintId)!, inputs, provider: llm });
  const products = createProductService({ generateSpec: (p) => spec(p.blueprintId, seeds.get(p.businessId)!.inputs), ...(probe ? { publishedStores: probe } : {}) });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  return {
    products, brands, assets, seeds, spec, catalogue: createCatalogueService({ products, brands, assets }),
    productIds: new Map<string, string[]>(), slugs: new Map<string, string>(), businesses: new Set<string>(),
  };
}
type Rt = ReturnType<typeof realRuntime>;

async function addProduct(rt: Rt, businessId: string, opts: { active?: boolean } = {}) {
  rt.businesses.add(businessId);
  rt.seeds.set(businessId, SEED);
  const { product, version } = await rt.products.createProduct(productCtx, { businessId, spec: await rt.spec(SEED.blueprintId, SEED.inputs) });
  for (const role of ['cover', 'preview', 'master'] as const) rt.assets.add({ id: `${product.id}-${role}`, workspaceId: WS, businessId, productId: product.id, role });
  rt.productIds.set(businessId, [...(rt.productIds.get(businessId) ?? []), product.id]);
  if (opts.active) {
    await rt.products.approve(productCtx, version.id);
    await rt.catalogue.createDraft(ctx.catalogueCtx(businessId), { businessId, productId: product.id });
    await rt.catalogue.approveListing(ctx.catalogueCtx(businessId), listingIdFor(product.id), { expectedVersion: 1 });
  }
  return product.id;
}
async function approveBrandFor(rt: Rt, businessId: string) {
  const deps = { store: rt.brands, now: () => new Date() };
  assert.equal((await createBrandDraft(deps, { workspaceId: WS }, businessId, BRAND_INPUT, { nameIndex: 0 })).ok, true);
  assert.equal((await approveBrand(deps, { workspaceId: WS }, businessId, OWNER)).ok, true);
}
async function rows(rt: Rt, businessId: string) {
  const r = await loadProducts(rt, ctx, businessId);
  assert.equal(r.found, true);
  if (!r.found) throw new Error('unreachable');
  return r;
}
let rtReads = 0;
const input = (rt: Rt, over: Partial<ArchiveGuardInput> = {}): ArchiveGuardInput => ({ availability: ON, rt: () => { rtReads += 1; return rt; }, productCtx, ...over });
const isArchived = async (rt: Rt, productId: string, businessId: string) => Boolean((await rt.products.getProduct(productCtx, productId, businessId)).archivedAt);
const ARCHIVE = { kind: 'archive', confirm: true };
const RESTORE = { kind: 'restore' };
const refused = (message: string) => ({ ok: false, message, storeNote: '', republish: 'none', websiteHref: null });

// ---- refusals ----
test('archive is refused without the explicit confirmation, and the product stays as it was', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  for (const op of [{ kind: 'archive' }, { kind: 'archive', confirm: false }, { kind: 'archive', confirm: 'true' }, { kind: 'archive', confirm: 1 }, { kind: 'archive', confirm: null }]) {
    assert.deepEqual(await runArchive(input(rt), 'biz-a', id, op), refused(NEEDS_CONFIRM), JSON.stringify(op));
  }
  assert.equal(await isArchived(rt, id, 'biz-a'), false);
  assert.equal((await rows(rt, 'biz-a')).rows[0].status, 'draft');
});

test('archive and restore are refused, with the reason, when demo storage is off, and the runtime is not even read', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  rtReads = 0;
  assert.deepEqual(await runArchive(input(rt, { availability: OFF }), 'biz-a', id, ARCHIVE), refused(OFF.reason));
  assert.deepEqual(await runArchive(input(rt, { availability: OFF }), 'biz-a', id, RESTORE), refused(OFF.reason));
  assert.equal(rtReads, 0);
  assert.equal(await isArchived(rt, id, 'biz-a'), false);
});

test('an unknown or malformed product, an unknown business and an odd request are all refused', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  for (const bad of ['', ' ', '__proto__', 'constructor', '../x', 'a b', 'x'.repeat(65), 'prod-nope', undefined, null, 7, {}, [id]]) {
    assert.deepEqual(await runArchive(input(rt), 'biz-a', bad, ARCHIVE), refused(NO_PRODUCT), `product ${String(bad)}`);
    assert.deepEqual(await runArchive(input(rt), 'biz-a', bad, RESTORE), refused(NO_PRODUCT), `restore ${String(bad)}`);
  }
  for (const bad of ['', '__proto__', 'biz-nope', undefined, null, 7, {}, ['biz-a']]) {
    assert.deepEqual(await runArchive(input(rt), bad, id, ARCHIVE), refused(NO_BUSINESS), `business ${String(bad)}`);
  }
  for (const op of [undefined, null, 'archive', 7, [], {}, { kind: 'delete' }, { kind: 'ARCHIVE', confirm: true }, [ARCHIVE]]) {
    assert.deepEqual(await runArchive(input(rt), 'biz-a', id, op), refused(BAD_REQUEST), JSON.stringify(op));
  }
  assert.equal(await isArchived(rt, id, 'biz-a'), false);
  assert.deepEqual(readArchiveOp({ kind: 'archive', confirm: true, extra: 'x' }), { kind: 'archive', confirm: true }, 'only the known fields are kept');
});

// ---- the catch-all the server action relies on ----
test('an unexpected error becomes the plain "Something went wrong" reply, and only the error name is logged', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  const logged: string[][] = [];
  const log = (message: string, detail: string) => { logged.push([message, detail]); };
  const broken = { ...rt, products: { ...rt.products, archiveProduct: async () => { throw new RangeError('store down: secret-detail'); }, unarchiveProduct: async () => { throw 'not even an Error'; } } } as unknown as Rt;

  assert.deepEqual(await runArchiveSafely(() => input(broken), 'biz-a', id, ARCHIVE, log), refused(WENT_WRONG));
  assert.deepEqual(await runArchiveSafely(() => input(broken), 'biz-a', id, RESTORE, log), refused(WENT_WRONG));
  // Building the input can fail too (the runtime or the demo switch): same reply.
  assert.deepEqual(await runArchiveSafely(() => { throw new Error('no runtime'); }, 'biz-a', id, ARCHIVE, log), refused(WENT_WRONG));
  assert.match(WENT_WRONG, /^Something went wrong, so nothing was changed/);
  assert.deepEqual(logged.map((l) => l[1]), ['RangeError', 'unknown error', 'Error']);
  assert.ok(!JSON.stringify(logged).includes('secret-detail'));
  assert.equal(await isArchived(rt, id, 'biz-a'), false);

  // Not-found and ordinary refusals are still worded by runArchive and are not logged as failures; success passes straight through.
  logged.length = 0;
  assert.deepEqual(await runArchiveSafely(() => input(rt), 'biz-a', 'prod-nope', ARCHIVE, log), refused(NO_PRODUCT));
  assert.deepEqual(await runArchiveSafely(() => input(rt), 'biz-a', id, { kind: 'archive' }, log), refused(NEEDS_CONFIRM));
  assert.equal((await runArchiveSafely(() => input(rt), 'biz-a', id, ARCHIVE, log)).ok, true);
  assert.deepEqual(logged, []);

  // The action is only this forward, with the /start runtime.
  const action = readFileSync(new URL('../app/app/[business]/products/actions.ts', import.meta.url), 'utf8');
  assert.match(action, /return runArchiveSafely\(\(\) => \(\{ availability: availability\(\), rt: runtime, productCtx \}\), businessId, productId, op\);/);
});

test('archive and the product editor share one product check, with the same words', () => {
  assert.equal(NO_BUSINESS, OWN_NO_BUSINESS);
  assert.equal(NO_PRODUCT, OWN_NO_PRODUCT);
  const rt = realRuntime();
  rt.businesses.add('biz-a');
  rt.productIds.set('biz-a', ['prod-1']);
  let reads = 0;
  const get = () => { reads += 1; return rt; };
  assert.deepEqual(checkOwnProduct(get, '__proto__', 'prod-1'), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(checkOwnProduct(get, 'biz-a', '../x'), { ok: false, message: NO_PRODUCT });
  assert.equal(reads, 0, 'a malformed id never reads the runtime');
  assert.deepEqual(checkOwnProduct(get, 'biz-nope', 'prod-1'), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(checkOwnProduct(get, 'biz-a', 'prod-2'), { ok: false, message: NO_PRODUCT });
  assert.deepEqual(checkOwnProduct(get, 'biz-a', 'prod-1'), { ok: true, businessId: 'biz-a', productId: 'prod-1', rt });
  for (const f of ['_server/archive.ts', '[productId]/_server/editor-guard.ts']) {
    const src = readFileSync(new URL(`../app/app/[business]/products/${f}`, import.meta.url), 'utf8');
    assert.match(src, /checkOwnProduct\(g\.rt, /, f);
    assert.doesNotMatch(src, /isKnownBusiness|isBusinessId/, `${f} has no copy of the check`);
  }
});

// ---- business isolation ----
test('one business cannot archive or restore another business\'s product, even when the index is wrong', async () => {
  const rt = realRuntime();
  const a = await addProduct(rt, 'biz-a');
  const b = await addProduct(rt, 'biz-b');
  assert.deepEqual(await runArchive(input(rt), 'biz-b', a, ARCHIVE), refused(NO_PRODUCT));
  assert.equal(await isArchived(rt, a, 'biz-a'), false);
  // Corrupt the index so biz-b lists biz-a's product: the guard passes it on, and the product service still says not found.
  rt.productIds.set('biz-b', [b, a]);
  assert.deepEqual(await runArchive(input(rt), 'biz-b', a, ARCHIVE), refused(NO_PRODUCT));
  assert.equal(await isArchived(rt, a, 'biz-a'), false);
  // And the other way for restore: biz-a archives its own product, biz-b cannot bring it back.
  assert.equal((await runArchive(input(rt), 'biz-a', a, ARCHIVE)).ok, true);
  assert.deepEqual(await runArchive(input(rt), 'biz-b', a, RESTORE), refused(NO_PRODUCT));
  assert.equal(await isArchived(rt, a, 'biz-a'), true);
  assert.equal(await isArchived(rt, b, 'biz-b'), false, 'biz-b\'s own product was never touched');
});

test('another workspace cannot archive or restore the product, and learns nothing about it', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  const other = { productCtx: { workspaceId: 'other-workspace', actorId: 'someone-else' } };
  assert.deepEqual(await runArchive(input(rt, other), 'biz-a', id, ARCHIVE), refused(NO_PRODUCT));
  assert.equal(await isArchived(rt, id, 'biz-a'), false);
  assert.equal((await runArchive(input(rt), 'biz-a', id, ARCHIVE)).ok, true);
  assert.deepEqual(await runArchive(input(rt, other), 'biz-a', id, RESTORE), refused(NO_PRODUCT));
  assert.equal(await isArchived(rt, id, 'biz-a'), true);
  // The refusal for a real product in another workspace is word for word the refusal for a product that does not exist.
  assert.deepEqual(await runArchive(input(rt, other), 'biz-a', id, ARCHIVE), await runArchive(input(rt), 'biz-a', 'prod-nope', ARCHIVE));
});

// ---- success: the product moves between the lists ----
test('archive moves an active product to the Archived list and restore brings it back exactly as it was', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const active = await addProduct(rt, 'biz-a', { active: true });
  const draft = await addProduct(rt, 'biz-a');
  const before = await rows(rt, 'biz-a');
  assert.deepEqual(filterCounts(before.rows), { all: 2, active: 1, draft: 1, archived: 0 });
  const rowBefore = before.rows.find((r) => r.id === active)!;

  const done = await runArchive(input(rt), 'biz-a', active, ARCHIVE);
  assert.equal(done.ok, true);
  assert.equal(done.message, ARCHIVED_OK);
  const after = await rows(rt, 'biz-a');
  assert.deepEqual(applyFilter(after.rows, 'archived').map((r) => r.id), [active]);
  assert.deepEqual(applyFilter(after.rows, 'all').map((r) => r.id), [draft], 'the default list leaves the archived product out');
  assert.deepEqual(applyFilter(after.rows, 'active'), []);
  assert.deepEqual(applyFilter(after.rows, 'draft').map((r) => r.id), [draft]);
  assert.deepEqual(filterCounts(after.rows), { all: 1, active: 0, draft: 1, archived: 1 });
  const archivedRow = after.rows.find((r) => r.id === active)!;
  assert.equal(archivedRow.statusLabel, 'Archived');
  assert.equal(archivedRow.detail, ARCHIVED_DETAIL);
  assert.equal(archivedRow.price, rowBefore.price, 'the price is still shown; nothing was deleted');
  // The catalogue agrees: the store can no longer sell it.
  assert.equal(await rt.catalogue.getApprovedListing(ctx.catalogueCtx('biz-a'), listingIdFor(active)), null);

  // Archiving again changes nothing and is not an error (the service is idempotent).
  assert.equal((await runArchive(input(rt), 'biz-a', active, ARCHIVE)).ok, true);
  assert.deepEqual(filterCounts((await rows(rt, 'biz-a')).rows), { all: 1, active: 0, draft: 1, archived: 1 });

  const back = await runArchive(input(rt), 'biz-a', active, RESTORE);
  assert.deepEqual(back, { ok: true, message: RESTORED_OK, storeNote: '', republish: 'none', websiteHref: null });
  const restored = await rows(rt, 'biz-a');
  assert.deepEqual(restored.rows.find((r) => r.id === active), rowBefore, 'active again with the same price, no re-approval');
  assert.deepEqual(filterCounts(restored.rows), { all: 2, active: 1, draft: 1, archived: 0 });
  assert.notEqual(await rt.catalogue.getApprovedListing(ctx.catalogueCtx('biz-a'), listingIdFor(active)), null);
});

test('a draft can be archived and comes back as a draft; restore needs no confirmation', async () => {
  const rt = realRuntime();
  const id = await addProduct(rt, 'biz-a');
  assert.equal((await runArchive(input(rt), 'biz-a', id, ARCHIVE)).ok, true);
  assert.equal((await rows(rt, 'biz-a')).rows[0].status, 'archived');
  assert.equal((await runArchive(input(rt), 'biz-a', id, RESTORE)).ok, true);
  assert.equal((await rows(rt, 'biz-a')).rows[0].status, 'draft');
  // Restoring a product that is not archived is harmless.
  assert.equal((await runArchive(input(rt), 'biz-a', id, RESTORE)).ok, true);
  assert.equal((await rows(rt, 'biz-a')).rows[0].status, 'draft');
});

test('archived products still count towards the demo limit, because the existing product builder counts every product', async () => {
  const rt = realRuntime();
  const first = await addProduct(rt, 'biz-a');
  await addProduct(rt, 'biz-a');
  await addProduct(rt, 'biz-a');
  assert.equal((await rows(rt, 'biz-a')).create.canCreate, false);
  assert.equal((await runArchive(input(rt), 'biz-a', first, ARCHIVE)).ok, true);
  const after = await rows(rt, 'biz-a');
  assert.equal(after.create.canCreate, false, 'archiving does not free a slot: the page must not promise one');
  assert.equal(after.create.remaining, 0);
  assert.match(LIMIT_COUNTS_ARCHIVED, /still count/);
});

// ---- the three storeNeedsRepublish answers ----
const probeSaying = (answer: StoreShowsProduct | Error): PublishedStoreProbe => ({
  isProductShown: async () => { if (answer instanceof Error) throw answer; return answer; },
});

test('storeNeedsRepublish true: the owner is told the live store still shows it, with a link to the Website page', async () => {
  const rt = realRuntime(probeSaying('shown'));
  const id = await addProduct(rt, 'biz-a');
  assert.deepEqual(await runArchive(input(rt), 'biz-a', id, ARCHIVE), {
    ok: true, message: ARCHIVED_OK, storeNote: REPUBLISH_NEEDED, republish: 'needed', websiteHref: '/app/biz-a/website',
  });
  assert.match(REPUBLISH_NEEDED, /still shows/);
  assert.match(REPUBLISH_NEEDED, /publish your website again/);
  // Asked again on a repeat archive, so the page keeps saying it until the owner republishes.
  assert.equal((await runArchive(input(rt), 'biz-a', id, ARCHIVE)).republish, 'needed');
});

test('storeNeedsRepublish false: nothing extra is said and no link is offered', async () => {
  const rt = realRuntime(probeSaying('not_shown'));
  const id = await addProduct(rt, 'biz-a');
  assert.deepEqual(await runArchive(input(rt), 'biz-a', id, ARCHIVE), { ok: true, message: ARCHIVED_OK, storeNote: '', republish: 'none', websiteHref: null });
});

test('storeNeedsRepublish null: the owner is told it could not be checked, never that the store is fine', async () => {
  for (const probe of [probeSaying('unknown'), probeSaying(new Error('lookup down')), undefined]) {
    const rt = realRuntime(probe);
    const id = await addProduct(rt, 'biz-a');
    const r = await runArchive(input(rt), 'biz-a', id, ARCHIVE);
    assert.deepEqual(r, { ok: true, message: ARCHIVED_OK, storeNote: REPUBLISH_UNKNOWN, republish: 'unknown', websiteHref: '/app/biz-a/website' });
    assert.equal(await isArchived(rt, id, 'biz-a'), true, 'the archive itself still happened');
  }
  assert.match(REPUBLISH_UNKNOWN, /could not check/);
  assert.equal(republishFrom(null), 'unknown');
  assert.equal(republishFrom(true), 'needed');
  assert.equal(republishFrom(false), 'none');
  assert.equal(websiteHref('biz-a'), '/app/biz-a/website');
});

// ---- wording ----
test('the wording is plain: the confirm question names the product, and the hint explains the smaller All number', () => {
  const q = confirmArchiveText('Meal planner');
  assert.match(q, /^Archive Meal planner\?/);
  assert.match(q, /Nothing is deleted/);
  assert.match(q, /restore/);
  assert.equal(archivedHint(0), '');
  assert.match(archivedHint(1), /^1 archived product is not in this list/);
  assert.match(archivedHint(3), /^3 archived products are not in this list/);
  for (const s of [q, ARCHIVED_OK, RESTORED_OK, REPUBLISH_NEEDED, REPUBLISH_UNKNOWN, NEEDS_CONFIRM, ARCHIVED_DETAIL, LIMIT_COUNTS_ARCHIVED]) {
    assert.doesNotMatch(s, /service|API|snapshot|flag|undefined|null/i, s);
  }
});

test('an archived product with an approved listing is shown as Archived, not Active', () => {
  const r = buildRow({
    id: 'p1', typeTitle: 'Printable planner', archived: true,
    versions: [{ version: 1, status: 'approved', qaPassed: true, spec: { title: 'Meal planner' } as never }],
    listing: [{ version: 1, status: 'approved', priceMinor: 1400, currency: 'AUD' }],
  });
  assert.equal(r.status, 'archived');
  assert.equal(r.statusLabel, 'Archived');
  assert.equal(r.price, 'A$14');
});
