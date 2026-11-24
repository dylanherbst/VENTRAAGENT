import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import type { ProductSpec } from '../lib/aimp/factory/spec.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createMemoryProductStore, createProductService, ProductError, renderBuyerFile, sha256 } from '../lib/aimp/products/index.ts';
import type { ProductStore, ProductVersion } from '../lib/aimp/products/index.ts';

const A = { workspaceId: 'ws-a', actorId: 'owner-a' };
const B = { workspaceId: 'ws-b', actorId: 'owner-b' };
const inputs = { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };

async function spec(): Promise<ProductSpec> {
  const bp = blueprintRegistry.find('printable-planner');
  assert.ok(bp);
  return generateProductSpec({ blueprint: bp, inputs, provider: createProviderRegistry({ env: {} }).llm });
}
/** A spec whose listing claim promises more pages than exist: fails validation, claims and consistency. */
async function brokenSpec(): Promise<ProductSpec> {
  const s = structuredClone(await spec());
  const c = s.claims[1];
  assert.ok(c);
  c.count += 3;
  return s;
}
const expectCode = (code: string) => (e: unknown) => e instanceof ProductError && e.code === code;
const make = async (opts: Partial<Parameters<typeof createProductService>[0]> = {}) =>
  createProductService({ generateSpec: spec, ...opts });

test('a good spec passes every QA check and lands in review', async () => {
  const svc = await make();
  const { version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  assert.equal(version.status, 'in_review');
  assert.equal(version.version, 1);
  assert.equal(version.qaPassed, true);
  assert.deepEqual(version.qa.map((q) => q.id), ['spec', 'required_sections', 'pdf_integrity', 'layout', 'listing_consistency']);
  assert.ok(version.qa.every((q) => q.passed && q.reasons.length === 0));
  assert.match(version.fileHash ?? '', /^[0-9a-f]{64}$/);
  assert.ok((version.pageCount ?? 0) > 2);
  assert.equal(version.claimsOk, true);
});

test('failed QA stays in review with plain reasons and can never be approved', async () => {
  const svc = await make();
  const { version } = await svc.createProduct(A, { businessId: 'biz', spec: await brokenSpec() });
  assert.equal(version.status, 'qa_failed');
  assert.equal(version.qaPassed, false);
  assert.equal(version.approvedHash, null);
  assert.ok(version.qa.some((q) => !q.passed && q.reasons.length > 0));
  await assert.rejects(svc.approve(A, version.id), expectCode('qa_not_passed'));
  const after = (await svc.listVersions(A, version.productId))[0];
  assert.equal(after?.status, 'qa_failed');
  await assert.rejects(svc.getBuyerFile(A, version.productId), expectCode('not_approved'));
});

test('a missing required section fails QA', async () => {
  const s = structuredClone(await spec());
  s.sections = s.sections.filter((x, i) => i !== s.sections.length - 1);
  const svc = await make();
  const { version } = await svc.createProduct(A, { businessId: 'biz', spec: s });
  assert.equal(version.status, 'qa_failed');
  assert.equal(version.qa.find((q) => q.id === 'required_sections')?.passed, false);
});

test('approval pins the hash; buyer file hash equals the approved hash', async () => {
  const svc = await make();
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const preview = await svc.previewVersion(A, version.id);
  assert.equal(preview.hash, version.fileHash);
  const approved = await svc.approve(A, version.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedHash, version.fileHash);
  assert.equal(approved.approvedBy, 'owner-a');
  const buyer = await svc.getBuyerFile(A, product.id);
  assert.equal(buyer.version, 1);
  assert.equal(buyer.hash, approved.approvedHash);
  assert.equal(sha256(buyer.bytes), approved.approvedHash);
  assert.deepEqual(Buffer.from(buyer.bytes), Buffer.from(preview.bytes));
  assert.equal(Buffer.from(buyer.bytes).subarray(0, 2).toString(), 'PK');
});

test('an approved version is immutable (service and store)', async () => {
  const store = createMemoryProductStore();
  const svc = await make({ store });
  const { version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const approved = await svc.approve(A, version.id);
  await assert.rejects(svc.approve(A, version.id), expectCode('immutable'));
  await assert.rejects(store.saveVersion({ ...approved, fileHash: 'f'.repeat(64) }), expectCode('immutable'));
  await assert.rejects(store.saveVersion({ ...approved, status: 'in_review' }), expectCode('immutable'));
  await assert.rejects(store.saveVersion({ ...approved, approvedHash: 'e'.repeat(64), status: 'superseded' }), expectCode('immutable'));
  assert.deepEqual(await store.getVersion(A.workspaceId, version.id), approved);
});

test('regenerate makes v2, keeps v1, and never changes the approved version', async () => {
  let tick = 0;
  const svc = await make({
    now: () => new Date(Date.UTC(2026, 10, 14, 0, 0, tick++)),
    generateSpec: async () => ({ ...(await spec()), title: 'Wedding Planning Printable Planner, Second Edition' }),
  });
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const v1 = await svc.approve(A, version.id);
  const v2 = await svc.regenerate(A, product.id);
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'in_review');
  const list = await svc.listVersions(A, product.id);
  assert.deepEqual(list.map((v) => v.version), [1, 2]);
  assert.deepEqual(list[0], v1);
  assert.equal((await svc.getBuyerFile(A, product.id)).version, 1);
  // Approving v2 supersedes v1 and moves the pinned hash to v2.
  const a2 = await svc.approve(A, v2.id);
  const after = await svc.listVersions(A, product.id);
  assert.equal(after[0]?.status, 'superseded');
  assert.equal(after[0]?.approvedHash, v1.approvedHash);
  assert.equal(after[1]?.status, 'approved');
  assert.equal((await svc.getBuyerFile(A, product.id)).hash, a2.approvedHash);
  assert.notEqual(a2.approvedHash, v1.approvedHash);
});

test('regenerate limit is enforced', async () => {
  const svc = await make({ maxRegenerations: 2 });
  const { product } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await svc.regenerate(A, product.id);
  await svc.regenerate(A, product.id);
  await assert.rejects(svc.regenerate(A, product.id), expectCode('regenerate_limit'));
  assert.equal((await svc.listVersions(A, product.id)).length, 3);
  const dflt = await make();
  const p2 = (await dflt.createProduct(A, { businessId: 'biz', spec: await spec() })).product;
  for (let i = 0; i < 5; i++) await dflt.regenerate(A, p2.id);
  await assert.rejects(dflt.regenerate(A, p2.id), expectCode('regenerate_limit'));
});

test('a mismatching render is refused for buyer file, preview and approval', async () => {
  let tamper = false;
  const render = (s: ProductSpec) => {
    const f = renderBuyerFile(s);
    if (!tamper) return f;
    const bytes = Uint8Array.from(f.bytes);
    bytes[bytes.length - 30] = (bytes[bytes.length - 30] ?? 0) ^ 0xff;
    return { ...f, bytes };
  };
  const svc = await make({ render });
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const v2 = await svc.regenerate(A, product.id);
  await svc.approve(A, version.id);
  tamper = true;
  await assert.rejects(svc.getBuyerFile(A, product.id), expectCode('hash_mismatch'));
  await assert.rejects(svc.previewVersion(A, version.id), expectCode('hash_mismatch'));
  await assert.rejects(svc.approve(A, v2.id), expectCode('hash_mismatch'));
  // A render that lies about its own hash is still caught, because the bytes are hashed again.
  const liar = await make({ render: (s) => ({ ...render(s), hash: renderBuyerFile(s).hash }) });
  const q = await liar.createProduct(A, { businessId: 'biz', spec: await spec() });
  await assert.rejects(liar.approve(A, q.version.id), expectCode('hash_mismatch'));
});

test('a stored spec changed after approval is refused', async () => {
  const inner = createMemoryProductStore();
  let edit = false;
  const store: ProductStore = {
    ...inner,
    async listVersions(w, p) {
      const list = await inner.listVersions(w, p);
      return edit ? list.map((v): ProductVersion => ({ ...v, spec: { ...v.spec, title: `${v.spec.title} (edited)` } })) : list;
    },
  };
  const svc = await make({ store });
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await svc.approve(A, version.id);
  edit = true;
  await assert.rejects(svc.getBuyerFile(A, product.id), expectCode('hash_mismatch'));
});

test('another workspace cannot read, approve, preview, regenerate or download', async () => {
  const svc = await make();
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await assert.rejects(svc.listVersions(B, product.id), expectCode('not_found'));
  await assert.rejects(svc.approve(B, version.id), expectCode('not_found'));
  await assert.rejects(svc.previewVersion(B, version.id), expectCode('not_found'));
  await assert.rejects(svc.regenerate(B, product.id), expectCode('not_found'));
  await assert.rejects(svc.getBuyerFile(B, product.id), expectCode('not_found'));
  await assert.rejects(svc.getBuyerFile({ workspaceId: '' }, product.id), expectCode('not_found'));
  assert.equal((await svc.listVersions(A, product.id)).length, 1);
  assert.equal((await svc.listVersions(A, product.id))[0]?.status, 'in_review');
});

const raw = async (id: string, over: Partial<ProductVersion> = {}): Promise<ProductVersion> => {
  const s = await spec();
  return {
    id, productId: 'p1', workspaceId: A.workspaceId, businessId: 'biz', version: 1, status: 'in_review', spec: s,
    fileHash: 'a'.repeat(64), fileName: 'x.zip', fileBytes: 1, pageCount: 1, claimsOk: true,
    qa: [{ id: 'spec', label: 'x', passed: true, reasons: [] }], qaPassed: true,
    approvedHash: null, approvedAt: null, approvedBy: null, createdAt: 't', ...over,
  };
};

test('a concurrent double approve leaves exactly one approved version', async () => {
  const svc = await make();
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const v2 = await svc.regenerate(A, product.id);
  const same = await Promise.allSettled([svc.approve(A, version.id), svc.approve(A, version.id)]);
  assert.equal(same.filter((r) => r.status === 'fulfilled').length, 1);
  const both = await Promise.allSettled([svc.approve(A, version.id), svc.approve(A, v2.id)]);
  assert.ok(both.some((r) => r.status === 'fulfilled'));
  const list = await svc.listVersions(A, product.id);
  assert.equal(list.filter((v) => v.status === 'approved').length, 1);
});

test('getBuyerFile refuses when a store holds two approved versions', async () => {
  const inner = createMemoryProductStore();
  const store: ProductStore = {
    ...inner,
    async listVersions(w, p) {
      const list = await inner.listVersions(w, p);
      const a = list.find((v) => v.status === 'approved');
      return a ? [...list, { ...a, id: `${a.id}-dup`, version: 99 }] : list;
    },
  };
  const svc = await make({ store });
  const { product, version } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await svc.approve(A, version.id);
  await assert.rejects(svc.getBuyerFile(A, product.id), expectCode('conflict'));
});

test('the store itself refuses to approve a failed or unpinned version', async () => {
  const store = createMemoryProductStore();
  const svc = await make({ store });
  const { version } = await svc.createProduct(A, { businessId: 'biz', spec: await brokenSpec() });
  assert.equal(version.status, 'qa_failed');
  await assert.rejects(store.saveVersion({ ...version, status: 'approved', approvedHash: version.fileHash }), expectCode('qa_not_passed'));
  await assert.rejects(store.saveVersion({ ...version, status: 'approved', qaPassed: true, approvedHash: 'a'.repeat(64), fileHash: 'a'.repeat(64) }), expectCode('qa_not_passed'));
  await assert.rejects(store.approveVersion(A.workspaceId, version.id, { approvedAt: 't', approvedBy: null }), expectCode('qa_not_passed'));
  const good = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await assert.rejects(store.saveVersion({ ...good.version, status: 'approved', approvedHash: 'b'.repeat(64) }), expectCode('qa_not_passed'));
  await assert.rejects(store.saveVersion({ ...good.version, status: 'approved', approvedHash: good.version.fileHash }), expectCode('invalid'));
  await assert.rejects(store.createVersion({ ...good.version, id: 'new', version: 7, status: 'approved', approvedHash: good.version.fileHash }), expectCode('invalid'));
  assert.equal((await store.getVersion(A.workspaceId, version.id))?.status, 'qa_failed');
});

test('a draft version cannot be approved (not_in_review)', async () => {
  const store = createMemoryProductStore();
  const svc = await make({ store });
  const { product } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  await store.createVersion(await raw('draft-1', { productId: product.id, version: 50, status: 'draft' }));
  await assert.rejects(svc.approve(A, 'draft-1'), expectCode('not_in_review'));
  await assert.rejects(store.approveVersion(A.workspaceId, 'draft-1', { approvedAt: 't', approvedBy: null }), expectCode('not_in_review'));
});

test('the store never overwrites an existing version id or number', async () => {
  const store = createMemoryProductStore();
  await store.createVersion(await raw('v-a'));
  await assert.rejects(store.createVersion(await raw('v-a', { version: 2 })), expectCode('conflict'));
  await assert.rejects(store.createVersion(await raw('v-b', { version: 1 })), expectCode('conflict'));
  await store.createVersion(await raw('v-c', { version: 2 }), 2);
  await assert.rejects(store.createVersion(await raw('v-d', { version: 3 }), 2), expectCode('regenerate_limit'));
  assert.equal((await store.listVersions(A.workspaceId, 'p1')).length, 2);
});

test('concurrent regenerates cannot overwrite each other or pass the limit', async () => {
  const svc = await make({ maxRegenerations: 1 });
  const { product } = await svc.createProduct(A, { businessId: 'biz', spec: await spec() });
  const r = await Promise.allSettled([svc.regenerate(A, product.id), svc.regenerate(A, product.id)]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.deepEqual((await svc.listVersions(A, product.id)).map((v) => v.version), [1, 2]);
  const svc2 = await make();
  const p2 = (await svc2.createProduct(A, { businessId: 'biz', spec: await spec() })).product;
  const many = await Promise.allSettled(Array.from({ length: 4 }, () => svc2.regenerate(A, p2.id)));
  assert.equal(many.filter((x) => x.status === 'fulfilled').length, 1);
  assert.deepEqual((await svc2.listVersions(A, p2.id)).map((v) => v.version), [1, 2]);
});
