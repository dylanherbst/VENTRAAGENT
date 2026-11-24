// Product download route (AMP-167; C05 C06). The guard runs against the REAL product service and the REAL exporter; only the Next route
// file (a thin wrapper) is not loaded. Every refusal and every file is checked on the real bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BAD_FORMAT, NOT_AVAILABLE, NO_PRODUCT, decideExport, downloadHeaders, safeFileName } from '../app/app/[business]/products/[productId]/_server/export-guard.ts';
import type { ExportDecision } from '../app/app/[business]/products/[productId]/_server/export-guard.ts';
import { loadProductEditor } from '../app/app/[business]/products/[productId]/_server/editor.ts';
import type { EditorContexts, EditorRuntime } from '../app/app/[business]/products/[productId]/_server/editor.ts';
import { exportHref } from '../app/app/[business]/products/[productId]/view-model.ts';
import { nicheKit, printablePlanner } from '../lib/aimp/blueprints/index.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const ctx: EditorContexts = {
  productCtx: { workspaceId: WS, actorId: OWNER },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: OWNER, idempotencyKey: `start:${businessId}` }),
};
const INPUTS = { niche: 'wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const llm = createProviderRegistry({ env: {} }).llm;
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'Demo storage is off on this site.' };

function realRuntime() {
  const products = createProductService({ store: createMemoryProductStore(), generateSpec: () => { throw new Error('not used'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  return {
    products, brands, assets, seeds: new Map(), catalogue: createCatalogueService({ products, brands, assets }),
    productIds: new Map<string, string[]>(), slugs: new Map<string, string>(), businesses: new Set<string>(),
  };
}
type Rt = ReturnType<typeof realRuntime>;

async function addProduct(rt: Rt, businessId: string, kind: 'kit' | 'planner', opts: { approve?: boolean } = {}) {
  rt.businesses.add(businessId);
  const spec = await generateProductSpec({ blueprint: kind === 'kit' ? nicheKit : printablePlanner, inputs: INPUTS, provider: llm });
  const { product, version } = await rt.products.createProduct(ctx.productCtx, { businessId, spec });
  rt.productIds.set(businessId, [...(rt.productIds.get(businessId) ?? []), product.id]);
  if (opts.approve) await rt.products.approve(ctx.productCtx, version.id);
  return product;
}
const ask = (rt: Rt, business: unknown, product: unknown, qs: string, availability = ON) =>
  decideExport({ availability, rt: () => rt as unknown as EditorRuntime, ctx }, business, product, new URLSearchParams(qs));
const refused = (d: ExportDecision) => { assert.equal(d.ok, false); return d as Extract<ExportDecision, { ok: false }>; };
const file = (d: ExportDecision) => { assert.equal(d.ok, true, d.ok ? '' : d.message); return d as Extract<ExportDecision, { ok: true }>; };
const bytesOf = (d: Extract<ExportDecision, { ok: true }>) => { assert.ok(d.body instanceof Uint8Array); return d.body as Uint8Array; };

test('a spreadsheet download is a real XLSX (zip) with the right type and a safe file name', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit', { approve: true });
  const d = file(await ask(rt, 'biz-a', p.id, 'format=xlsx'));
  const b = bytesOf(d);
  assert.deepEqual([...b.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(d.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(d.fileName, /\.xlsx$/);
  const h = downloadHeaders(d.fileName, d.contentType, b.byteLength);
  assert.match(h['Content-Disposition'], /^attachment; filename="[A-Za-z0-9._-]+\.xlsx"$/);
  assert.equal(h['Cache-Control'], 'no-store');
  assert.equal(h['Content-Length'], String(b.byteLength));
});

test('a cover image download is a real PNG', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'planner');
  const d = file(await ask(rt, 'biz-a', p.id, 'format=png'));
  const b = bytesOf(d);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(d.contentType, 'image/png');
  assert.match(d.fileName, /\.png$/);
});

test('the licence note comes as a text file with part=licence, for both formats', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  for (const format of ['xlsx', 'png']) {
    const d = file(await ask(rt, 'biz-a', p.id, `format=${format}&part=licence`));
    assert.equal(d.contentType, 'text/plain; charset=utf-8');
    assert.match(d.fileName, /-licence\.txt$/);
    assert.equal(typeof d.body, 'string');
    assert.ok((d.body as string).trim().split('\n').length >= 2, 'a title line and the note');
  }
  assert.equal(refused(await ask(rt, 'biz-a', p.id, 'format=png&part=other')).status, 400);
});

test('JPG is a plain "not available", never a file and never a crash', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  const r = refused(await ask(rt, 'biz-a', p.id, 'format=jpg'));
  assert.equal(r.status, 422);
  assert.match(r.message, /JPG export is not available yet/);
  assert.equal(refused(await ask(rt, 'biz-a', p.id, 'format=jpg&part=licence')).status, 422);
});

test('a spreadsheet for a product without a table is "not available", and the editor flag says so', async () => {
  const rt = realRuntime();
  const planner = await addProduct(rt, 'biz-a', 'planner');
  const kit = await addProduct(rt, 'biz-a', 'kit');
  const r = refused(await ask(rt, 'biz-a', planner.id, 'format=xlsx'));
  assert.equal(r.status, 422);
  assert.match(r.message, /no tracker or checklist pages/);
  const flag = async (id: string) => {
    const f = await loadProductEditor(rt as unknown as EditorRuntime, ctx, 'biz-a', id);
    assert.equal(f.found, true);
    return f.found && f.editor.canExportXlsx;
  };
  assert.equal(await flag(planner.id), false);
  assert.equal(await flag(kit.id), true);
});

test('bad or missing formats are a plain 400', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  for (const qs of ['', 'format=', 'format=pdf', 'format=XLSX', 'width=3', 'accent=red']) {
    const r = refused(await ask(rt, 'biz-a', p.id, qs));
    assert.equal(r.status, 400, qs);
    assert.equal(r.message, BAD_FORMAT, qs);
  }
});

test('width and accent are not accepted: they change nothing and never cause a refusal', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  const plain = bytesOf(file(await ask(rt, 'biz-a', p.id, 'format=png')));
  for (const qs of ['format=png&width=3', 'format=png&width=99999', 'format=png&accent=red', 'format=png&accent=%23ff0000&width=400']) {
    assert.deepEqual(bytesOf(file(await ask(rt, 'biz-a', p.id, qs))), plain, qs);
  }
});

test('signed out or demo storage off: refused before anything is read', async () => {
  let read = false;
  const d = await decideExport({ availability: OFF, rt: () => { read = true; throw new Error('must not be read'); }, ctx }, 'biz-a', 'prod-1', new URLSearchParams('format=png'));
  assert.deepEqual(d, { ok: false, status: 503, message: OFF.reason });
  assert.equal(read, false);
});

test('a missing product, a product of another business and a malformed id all get exactly the same answer', async () => {
  const rt = realRuntime();
  const mine = await addProduct(rt, 'biz-a', 'kit');
  const theirs = await addProduct(rt, 'biz-b', 'kit');
  const same = { ok: false, status: 404, message: NO_PRODUCT };
  assert.deepEqual(await ask(rt, 'biz-a', 'does-not-exist', 'format=png'), same);
  assert.deepEqual(await ask(rt, 'biz-a', theirs.id, 'format=png'), same, 'another business\'s product');
  assert.deepEqual(await ask(rt, 'biz-b', mine.id, 'format=png'), same);
  assert.deepEqual(await ask(rt, 'biz-zzz', mine.id, 'format=png'), same, 'unknown business');
  assert.deepEqual(await ask(rt, 'biz-a', '../etc', 'format=png'), same, 'malformed product id');
  assert.deepEqual(await ask(rt, 42, mine.id, 'format=png'), same, 'malformed business id');
  assert.deepEqual(await ask(rt, 'biz-a', 'does-not-exist', 'format=nonsense'), same, 'a bad format does not reveal that the product is missing');
  file(await ask(rt, 'biz-a', mine.id, 'format=png'));
});

test('another workspace cannot download: the service refuses and the answer is the same', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  const d = await decideExport({ availability: ON, rt: () => rt as unknown as EditorRuntime, ctx: { productCtx: { workspaceId: 'other-workspace', actorId: 'someone' } } }, 'biz-a', p.id, new URLSearchParams('format=png'));
  assert.deepEqual(d, { ok: false, status: 404, message: NO_PRODUCT });
});

test('an archived product downloads like the editor shows it (read only); file names are made safe', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit', { approve: true });
  await rt.products.archiveProduct(ctx.productCtx, p.id, 'biz-a');
  file(await ask(rt, 'biz-a', p.id, 'format=png'));
  assert.equal(safeFileName('../../My "Plan"\r\n.png'), 'My-Plan-.png');
  assert.equal(safeFileName('...'), 'download');
  assert.equal(exportHref('biz-a', 'prod-1', 'png', 'licence'), '/app/biz-a/products/prod-1/export?format=png&part=licence');
  assert.equal(exportHref('biz-a', 'prod-1', 'xlsx'), '/app/biz-a/products/prod-1/export?format=xlsx');
});

test('an unusable stored spec gets the plain NOT_AVAILABLE answer and nothing else', async () => {
  const rt = realRuntime();
  const p = await addProduct(rt, 'biz-a', 'kit');
  const real = rt.products;
  const broken = {
    getProduct: real.getProduct.bind(real),
    listVersions: async (c: typeof ctx.productCtx, id: string) =>
      (await real.listVersions(c, id)).map((v) => ({ ...v, spec: { notASpec: true, secret: 'internal detail' } })),
  };
  const d = await ask({ ...rt, products: broken } as unknown as Rt, 'biz-a', p.id, 'format=png');
  assert.deepEqual(d, { ok: false, status: 422, message: NOT_AVAILABLE });
  assert.match(NOT_AVAILABLE, /not available/);
  assert.doesNotMatch(JSON.stringify(d), /secret|internal|notASpec/);
});
