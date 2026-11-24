// AMP-046: secure-download grants separate two businesses that share one workspace.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createMemoryProductStore, createProductService } from '../lib/aimp/products/index.ts';
import { createFilesService, createMemoryFileStorage, createMemoryOrderBook, FilesError } from '../lib/aimp/files/index.ts';
import type { FilesCtx } from '../lib/aimp/files/index.ts';

const SECRET = 'test-only-signing-secret-0123456789abcdef';
const WS = { workspaceId: 'ws-1', actorId: 'owner' };
const mineCtx = { workspaceId: 'ws-1', businessId: 'biz-a' };
const theirsCtx = { workspaceId: 'ws-1', businessId: 'biz-b' };
const inputs = { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };

async function world() {
  const store = createMemoryProductStore();
  const bp = blueprintRegistry.find('printable-planner');
  assert.ok(bp);
  const spec = () => generateProductSpec({ blueprint: bp, inputs, provider: createProviderRegistry({ env: {} }).llm });
  const products = createProductService({ store, generateSpec: spec });
  const orders = createMemoryOrderBook();
  const files = createFilesService({ storage: createMemoryFileStorage(), orders, products: store, secret: SECRET });
  const items: Record<'a' | 'b', string> = { a: 'item-a', b: 'item-b' };
  const versionIds = { a: '', b: '' };
  for (const k of ['a', 'b'] as const) {
    const businessId = `biz-${k}`;
    const { product, version } = await products.createProduct(WS, { businessId, spec: await spec() });
    const approved = await products.approve(WS, version.id);
    const buyer = await products.getBuyerFile(WS, product.id);
    versionIds[k] = approved.id;
    await files.storeMaster({ ...WS, businessId }, approved.id, { fileName: buyer.fileName, contentType: buyer.contentType, bytes: buyer.bytes });
    orders.addPaidOrder({ orderId: `order-${k}`, itemId: items[k], workspaceId: 'ws-1', businessId, productId: product.id, productVersion: 1 });
  }
  return { files, items, versionIds };
}

const code = (c: string) => (e: unknown) => e instanceof FilesError && e.code === c;

test('AMP-046 issue: another business\'s order line in the same workspace is not found, exactly like a missing line', async () => {
  const w = await world();
  await assert.rejects(w.files.issueGrant(mineCtx, w.items.b), code('order_not_found'));
  await assert.rejects(w.files.issueGrant(mineCtx, 'no-such-item'), code('order_not_found'));
  assert.deepEqual(await w.files.listGrants(theirsCtx, w.items.b), [], 'nothing was issued for the other business');
});

test('AMP-046 list: another business\'s grants read as an empty list, the same as a line with none', async () => {
  const w = await world();
  const theirs = await w.files.issueGrant(theirsCtx, w.items.b);
  assert.deepEqual(await w.files.listGrants(mineCtx, w.items.b), []);
  assert.deepEqual(await w.files.listGrants(mineCtx, 'no-such-item'), []);
  assert.equal((await w.files.listGrants(theirsCtx, w.items.b)).length, 1);
  assert.ok((await w.files.redeem(theirs.token)).ok, 'their link still works for them');
});

test('AMP-046 reissue: another business\'s line is not found and its working link is left alone', async () => {
  const w = await world();
  const theirs = await w.files.issueGrant(theirsCtx, w.items.b);
  await assert.rejects(w.files.reissueGrant(mineCtx, w.items.b), code('order_not_found'));
  const after = await w.files.listGrants(theirsCtx, w.items.b);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.revokedAt, null, 'not revoked by the other business');
  assert.ok((await w.files.redeem(theirs.token)).ok);
});

test('AMP-046 revoke: another business cannot revoke a grant it does not own', async () => {
  const w = await world();
  const theirs = await w.files.issueGrant(theirsCtx, w.items.b);
  await assert.rejects(w.files.revokeGrant(mineCtx, theirs.grant.id), code('wrong_tenant'));
  assert.ok((await w.files.redeem(theirs.token)).ok);
});

test('AMP-046 storeMaster: a business cannot store files against another business\'s version', async () => {
  const w = await world();
  await assert.rejects(w.files.storeMaster(mineCtx, w.versionIds.b, { fileName: 'x.txt', contentType: 'text/plain', bytes: new Uint8Array([1]) }), code('wrong_tenant'));
});

test('AMP-046 audit: a business reads only its own entries, never the other business\'s in the same workspace', async () => {
  const w = await world();
  const theirs = await w.files.issueGrant(theirsCtx, w.items.b);
  await w.files.issueGrant(mineCtx, w.items.a);
  await assert.rejects(w.files.issueGrant(mineCtx, w.items.b), code('order_not_found'));
  await w.files.redeem(theirs.token);
  const mine = w.files.audit(mineCtx);
  const their = w.files.audit(theirsCtx);
  assert.ok(mine.length > 0 && their.length > 0);
  assert.ok(mine.every((e) => e.businessId === 'biz-a' && e.workspaceId === 'ws-1'));
  assert.ok(their.every((e) => e.businessId === 'biz-b' && e.workspaceId === 'ws-1'));
  assert.equal(mine.some((e) => e.grantId === theirs.grant.id), false, 'A never sees B\'s grant in its audit');
  assert.equal(their.some((e) => e.event === 'download_denied' && e.note === 'issue'), false, 'A\'s refused attempt is A\'s entry, not B\'s');
  assert.equal(w.files.audit({ workspaceId: 'ws-1', businessId: 'biz-c' }).length, 0);
});

test('AMP-046 a missing or empty business id is refused on every call', async () => {
  const w = await world();
  for (const bad of [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-1', businessId: '' }, { workspaceId: 'ws-1', businessId: undefined }] as unknown as FilesCtx[]) {
    await assert.rejects(w.files.issueGrant(bad, w.items.a), code('wrong_tenant'));
    await assert.rejects(w.files.reissueGrant(bad, w.items.a), code('wrong_tenant'));
    await assert.rejects(w.files.listGrants(bad, w.items.a), code('wrong_tenant'));
    await assert.rejects(w.files.revokeGrant(bad, 'g'), code('wrong_tenant'));
    await assert.rejects(w.files.storeMaster(bad, w.versionIds.a, { fileName: 'x', contentType: 'text/plain', bytes: new Uint8Array([1]) }), code('wrong_tenant'));
    assert.throws(() => w.files.audit(bad), code('wrong_tenant'));
  }
});

test('AMP-046 same business still issues, lists, reissues and redeems', async () => {
  const w = await world();
  const first = await w.files.issueGrant(mineCtx, w.items.a);
  assert.equal((await w.files.listGrants(mineCtx, w.items.a)).length, 1);
  const second = await w.files.reissueGrant(mineCtx, w.items.a);
  assert.notEqual(second.token, first.token);
  assert.equal((await w.files.redeem(first.token)).ok, false, 'the older link is revoked');
  const r = await w.files.redeem(second.token, { businessId: 'biz-a' });
  assert.ok(r.ok);
  assert.equal((await w.files.listGrants(mineCtx, w.items.a)).length, 2);
});

test('AMP-046 a different workspace is still refused, with or without a business', async () => {
  const w = await world();
  await assert.rejects(w.files.issueGrant({ workspaceId: 'ws-2', businessId: 'biz-a' }, w.items.a), code('wrong_tenant'));
  await assert.rejects(w.files.issueGrant({ workspaceId: 'ws-2', businessId: 'biz-b' }, w.items.a), code('wrong_tenant'));
  await assert.rejects(w.files.reissueGrant({ workspaceId: 'ws-2', businessId: 'biz-a' }, w.items.a), code('wrong_tenant'));
  assert.deepEqual(await w.files.listGrants({ workspaceId: 'ws-2', businessId: 'biz-a' }, w.items.a), []);
});

test('AMP-046 a malformed business id is refused, and the token binds the business through the stored grant', async () => {
  const w = await world();
  await assert.rejects(w.files.listGrants({ workspaceId: 'ws-1', businessId: '' }, w.items.a), code('wrong_tenant'));
  await assert.rejects(w.files.issueGrant({ workspaceId: 'ws-1', businessId: 7 as unknown as string }, w.items.a), code('wrong_tenant'));
  const { token } = await w.files.issueGrant(mineCtx, w.items.a);
  const wrong = await w.files.redeem(token, { businessId: 'biz-b' });
  assert.equal(wrong.ok === false && wrong.reason, 'wrong_tenant');
});
