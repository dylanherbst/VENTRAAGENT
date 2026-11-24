// Products page (screen 12, AMP-083; E01). The server read runs against the REAL product service, catalogue service and brand store
// with the same factories and contexts app/start/_server/runtime.ts uses (that file, and app/start/actions.ts, import lib modules
// without a `.ts` extension, so the node test runner cannot load them: the server actions are not exercised here).
// Archive and restore (AMP-097) are tested in aimp-app-products-archive.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_BUSINESS, NO_IDEA, guardCreate } from '../app/app/[business]/products/_server/create-guard.ts';
import { loadProducts } from '../app/app/[business]/products/_server/products.ts';
import type { ProductsContexts, ProductsRuntime } from '../app/app/[business]/products/_server/products.ts';
import {
  ARCHIVE_NOTE, applyFilter, buildRow, emptyCopy, filterCounts, filterHref, parseFilter, planCreate, statusFilters,
} from '../app/app/[business]/products/view-model.ts';
import type { ProductSource } from '../app/app/[business]/products/view-model.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService, listingIdFor } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const ctx: ProductsContexts = {
  productCtx: { workspaceId: WS, actorId: OWNER },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` }),
  maxProducts: 3,
};
const SEED = { blueprintId: 'printable-planner', inputs: { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } as Record<string, string | number> };
const BRAND_INPUT = { niche: 'meal planning', audience: 'busy parents', productType: 'printable planner' };

function realRuntime() {
  const llm = createProviderRegistry({ env: {} }).llm;
  const seeds = new Map<string, typeof SEED>();
  const spec = (blueprintId: string, inputs: typeof SEED.inputs) => generateProductSpec({ blueprint: blueprintRegistry.find(blueprintId)!, inputs, provider: llm });
  const products = createProductService({ generateSpec: (p) => spec(p.blueprintId, seeds.get(p.businessId)!.inputs) });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  return {
    products, brands, assets, seeds, spec, catalogue: createCatalogueService({ products, brands, assets }),
    productIds: new Map<string, string[]>(), slugs: new Map<string, string>(), businesses: new Set<string>(),
  };
}
type Rt = ReturnType<typeof realRuntime>;
const asRuntime = (rt: Rt): ProductsRuntime => rt;

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
async function list(rt: Rt, businessId: string, c: ProductsContexts = ctx) {
  const r = await loadProducts(asRuntime(rt), c, businessId);
  assert.equal(r.found, true);
  if (!r.found) throw new Error('unreachable');
  return r;
}

// ---- view-model: filters ----
test('the status filter reads ?status= safely: bad, repeated, empty and odd values fall back to all', () => {
  for (const f of statusFilters) assert.equal(parseFilter(f), f);
  assert.equal(parseFilter(undefined), 'all');
  for (const bad of ['', 'nope', 'ACTIVE', 'active ', '__proto__', 'constructor', 'all,active', "'; drop", '%00']) assert.equal(parseFilter(bad), 'all', bad);
  assert.equal(parseFilter(['draft', 'active']), 'draft');
  assert.equal(parseFilter([]), 'all');
});

test('filter links are backed by the URL, and "all" is the plain page', () => {
  assert.equal(filterHref('biz-a', 'all'), '/app/biz-a/products');
  assert.equal(filterHref('biz-a', 'active'), '/app/biz-a/products?status=active');
  assert.equal(filterHref('biz-a', 'archived'), '/app/biz-a/products?status=archived');
});

test('each filter has plain-English empty copy, and archived explains what archiving does', () => {
  for (const f of statusFilters) {
    for (const total of [0, 2]) {
      for (const archived of [0, total]) {
        const c = emptyCopy(f, total, archived);
        assert.ok(c.title.length > 0 && c.text.length > 0);
        assert.doesNotMatch(c.title + c.text, /undefined|null|NaN/);
      }
    }
  }
  assert.equal(emptyCopy('archived', 2).text, ARCHIVE_NOTE);
  assert.doesNotMatch(ARCHIVE_NOTE, /isn't available|not available/i, 'archiving is real now (AMP-097)');
  assert.match(ARCHIVE_NOTE, /restore/i);
  assert.match(emptyCopy('all', 2, 2).title, /archived/i, 'every product archived: the default list says where they went');
  assert.doesNotMatch(ARCHIVE_NOTE, /service|\bstore\b|API/i, 'beginner wording, no developer terms ("restore" is fine)');
  // The note belongs to the Archived filter only (also when the business has no products at all).
  assert.equal(emptyCopy('archived', 0).text, ARCHIVE_NOTE);
  for (const f of ['all', 'active', 'draft'] as const) for (const total of [0, 3]) assert.notEqual(emptyCopy(f, total).text, ARCHIVE_NOTE);
  assert.match(emptyCopy('active', 1).text, /approve/i);
  assert.match(emptyCopy('all', 0).title, /No products yet/);
});

test('create is allowed only with an idea saved and room left under the demo limit', () => {
  assert.deepEqual(planCreate({ hasSeed: true, count: 0, max: 3 }), { canCreate: true, reason: '', remaining: 3 });
  assert.equal(planCreate({ hasSeed: true, count: 2, max: 3 }).remaining, 1);
  const full = planCreate({ hasSeed: true, count: 3, max: 3 });
  assert.equal(full.canCreate, false);
  assert.match(full.reason, /limited to 3 products/);
  assert.equal(planCreate({ hasSeed: true, count: 9, max: 3 }).remaining, 0);
  const none = planCreate({ hasSeed: false, count: 0, max: 3 });
  assert.equal(none.canCreate, false);
  assert.match(none.reason, /guided set-up/);
});

// ---- view-model: rows (pure, on service-shaped data) ----
const src = (over: Partial<ProductSource> = {}): ProductSource => ({
  id: 'p1', typeTitle: 'Printable planner',
  versions: [{ version: 1, status: 'in_review', qaPassed: true, spec: { title: ' Meal planner ' } as never }],
  listing: [], ...over,
});

test('a built product with no listing is a draft with no price, never a made-up price', () => {
  const r = buildRow(src());
  assert.equal(r.status, 'draft');
  assert.equal(r.name, 'Meal planner');
  assert.equal(r.type, 'Printable planner');
  assert.equal(r.price, 'No price yet');
  assert.doesNotMatch(r.price, /\d/);
});

test('a product with an approved listing is active and shows the approved price, not a newer draft price', () => {
  const r = buildRow(src({
    versions: [{ version: 1, status: 'approved', qaPassed: true, spec: { title: 'Meal planner' } as never }],
    listing: [{ version: 1, status: 'approved', priceMinor: 1400, currency: 'AUD' }, { version: 2, status: 'draft', priceMinor: 1900, currency: 'AUD' }],
  }));
  assert.equal(r.status, 'active');
  assert.equal(r.price, 'A$14');
  assert.match(r.priceNote, /newer draft/);
});

test('a draft listing price is labelled as a draft price; a failed check is said plainly', () => {
  const drafted = buildRow(src({ listing: [{ version: 1, status: 'draft', priceMinor: 1450, currency: 'AUD' }] }));
  assert.equal(drafted.status, 'draft');
  assert.equal(drafted.price, 'A$14.50');
  assert.match(drafted.priceNote, /not approved/);
  const failed = buildRow(src({ versions: [{ version: 1, status: 'qa_failed', qaPassed: false, spec: { title: 'X' } as never }] }));
  assert.match(failed.detail, /Failed a check/);
});

test('filters split rows by status and counts match; archived is empty when nothing is archived', () => {
  const rows = [
    buildRow(src({ id: 'a', versions: [{ version: 1, status: 'approved', qaPassed: true, spec: { title: 'A' } as never }], listing: [{ version: 1, status: 'approved', priceMinor: 500, currency: 'AUD' }] })),
    buildRow(src({ id: 'b' })), buildRow(src({ id: 'c' })),
  ];
  assert.deepEqual(applyFilter(rows, 'active').map((r) => r.id), ['a']);
  assert.deepEqual(applyFilter(rows, 'draft').map((r) => r.id), ['b', 'c']);
  assert.deepEqual(applyFilter(rows, 'archived'), []);
  assert.equal(applyFilter(rows, 'all').length, 3);
  assert.deepEqual(filterCounts(rows), { all: 3, active: 1, draft: 2, archived: 0 });
});

// ---- server read over the real services ----
test('a business built through the real services lists its products with name, type, price and status', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product } = await addProduct(rt, 'biz-a', { approve: true });
  const first = await list(rt, 'biz-a');
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].status, 'draft');
  assert.equal(first.rows[0].price, 'No price yet');
  assert.equal(first.rows[0].type, blueprintRegistry.find('printable-planner')!.title);
  assert.ok(first.rows[0].name.length > 0);

  const listing = await rt.catalogue.createDraft(ctx.catalogueCtx('biz-a'), { businessId: 'biz-a', productId: product.id });
  await rt.catalogue.approveListing(ctx.catalogueCtx('biz-a'), listingIdFor(product.id), { expectedVersion: 1 });
  const second = await list(rt, 'biz-a');
  assert.equal(second.rows[0].status, 'active');
  assert.equal(second.rows[0].price, `A$${listing.priceMinor % 100 === 0 ? listing.priceMinor / 100 : (listing.priceMinor / 100).toFixed(2)}`);
  assert.deepEqual(applyFilter(second.rows, 'active').map((r) => r.id), [product.id]);
  assert.deepEqual(applyFilter(second.rows, 'draft'), []);
  assert.equal(second.create.canCreate, true);
});

test('creating through the product service adds a row, and the demo limit is enforced by the plan', async () => {
  const rt = realRuntime();
  await addProduct(rt, 'biz-a');
  assert.equal((await list(rt, 'biz-a')).rows.length, 1);
  await addProduct(rt, 'biz-a');
  await addProduct(rt, 'biz-a');
  const full = await list(rt, 'biz-a');
  assert.equal(full.rows.length, 3);
  assert.equal(full.create.canCreate, false);
  assert.equal(full.create.remaining, 0);
});

test('a known business with no products reads as empty, and one with no saved idea cannot add', async () => {
  const rt = realRuntime();
  rt.businesses.add('biz-new');
  const r = await list(rt, 'biz-new');
  assert.deepEqual(r.rows, []);
  assert.equal(r.create.canCreate, false);
  assert.match(r.create.reason, /guided set-up/);
});

test('an approved product that is re-versioned keeps its earlier version and the listing keeps its pinned version', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a');
  const { product, version } = await addProduct(rt, 'biz-a', { approve: true });
  await rt.catalogue.createDraft(ctx.catalogueCtx('biz-a'), { businessId: 'biz-a', productId: product.id });
  await rt.catalogue.approveListing(ctx.catalogueCtx('biz-a'), listingIdFor(product.id), { expectedVersion: 1 });
  const v2 = await rt.products.regenerate(ctx.productCtx, product.id);
  await rt.products.approve(ctx.productCtx, v2.id);
  const versions = await rt.products.listVersions(ctx.productCtx, product.id);
  assert.deepEqual(versions.map((v) => v.status), ['superseded', 'approved']);
  assert.equal(versions[0].id, version.id, 'the earlier version is still resolvable by id');
  const price = await rt.catalogue.getCheckoutPrice(ctx.catalogueCtx('biz-a'), listingIdFor(product.id));
  assert.equal(price.productVersion, 1, 'checkout still names the version the listing was approved for');
  const rows = (await list(rt, 'biz-a')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'active');
});

// ---- isolation ----
test('an unknown business is not found, and nothing about another business is read', async () => {
  const rt = realRuntime();
  await addProduct(rt, 'biz-a');
  assert.deepEqual(await loadProducts(asRuntime(rt), ctx, 'biz-nope'), { found: false });
  assert.deepEqual(await loadProducts(asRuntime(rt), ctx, ''), { found: false });
  assert.deepEqual(await loadProducts(asRuntime(rt), ctx, '__proto__'), { found: false });
});

test('two businesses each see only their own products, with their own prices', async () => {
  const rt = realRuntime();
  await approveBrandFor(rt, 'biz-a', 0);
  await approveBrandFor(rt, 'biz-b', 1);
  const a = await addProduct(rt, 'biz-a', { approve: true });
  const b1 = await addProduct(rt, 'biz-b');
  const b2 = await addProduct(rt, 'biz-b');
  await rt.catalogue.createDraft(ctx.catalogueCtx('biz-a'), { businessId: 'biz-a', productId: a.product.id });
  const ra = await list(rt, 'biz-a');
  const rb = await list(rt, 'biz-b');
  assert.deepEqual(ra.rows.map((r) => r.id), [a.product.id]);
  assert.deepEqual(rb.rows.map((r) => r.id), [b1.product.id, b2.product.id]);
  assert.notEqual(ra.rows[0].price, 'No price yet');
  assert.ok(rb.rows.every((r) => r.price === 'No price yet'), 'a price on business A never shows on business B');
});

test('a product id filed under the wrong business is not shown, and another workspace sees nothing', async () => {
  const rt = realRuntime();
  const a = await addProduct(rt, 'biz-a');
  await addProduct(rt, 'biz-b');
  // Corrupt the index so biz-b points at biz-a's product: the page must refuse to show it.
  rt.productIds.set('biz-b', [a.product.id]);
  assert.deepEqual((await list(rt, 'biz-b')).rows, []);
  // The same business read from another workspace: the product service says not found, so nothing is listed.
  const other = await loadProducts(asRuntime(rt), { ...ctx, productCtx: { workspaceId: 'other-workspace', actorId: OWNER } }, 'biz-a');
  assert.equal(other.found, true);
  if (other.found) assert.deepEqual(other.rows, []);
});

// ---- the checks createProductAction runs before it hands over to productsAction ----
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };
let rtReads = 0;
const guard = (rt: Rt, availability = ON) => (id: unknown) => guardCreate({ availability, rt: () => { rtReads += 1; return rt; } }, id);

test('create is refused, with the reason, when demo storage is off, and the runtime is not even read', async () => {
  const rt = realRuntime();
  await addProduct(rt, 'biz-a');
  rtReads = 0;
  assert.deepEqual(guard(rt, OFF)('biz-a'), { ok: false, message: OFF.reason });
  assert.equal(rtReads, 0);
});

test('create is refused for malformed, empty, non-string and __proto__ ids, and for unknown businesses', async () => {
  const rt = realRuntime();
  await addProduct(rt, 'biz-a');
  for (const bad of ['', ' ', '__proto__', 'constructor', '../biz-a', 'biz a', 'biz/a', '-biz', 'x'.repeat(65), undefined, null, 7, {}, ['biz-a']]) {
    assert.deepEqual(guard(rt)(bad), { ok: false, message: NO_BUSINESS }, String(bad));
  }
  assert.deepEqual(guard(rt)('biz-nope'), { ok: false, message: NO_BUSINESS });
});

test('create is refused when the business has no saved idea, even though it is known', () => {
  const rt = realRuntime();
  rt.businesses.add('biz-new');
  assert.deepEqual(guard(rt)('biz-new'), { ok: false, message: NO_IDEA });
});

test('create is allowed for a known business with a saved idea, and hands back that idea and nothing from another business', async () => {
  const rt = realRuntime();
  await addProduct(rt, 'biz-a');
  rt.businesses.add('biz-b');
  const g = guard(rt)('biz-a');
  assert.deepEqual(g, { ok: true, seed: SEED });
  assert.deepEqual(guard(rt)('biz-b'), { ok: false, message: NO_IDEA }, 'biz-b does not borrow biz-a\'s idea');
});
