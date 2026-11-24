import assert from 'node:assert/strict';
import test from 'node:test';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import type { ProductSpec } from '../lib/aimp/factory/spec.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createMemoryProductStore, createProductService } from '../lib/aimp/products/index.ts';
import {
  AUDIT_CAP, createDownloadHandler, createFilesService, createMemoryFileStorage, createMemoryGrantStore, createMemoryOrderBook, DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_HOURS,
  FilesError, fileKeyPath, MAX_TOKEN_LENGTH, resolveFilesConfig, safeContentType, signToken, verifyToken,
} from '../lib/aimp/files/index.ts';
import type { DenyReason, FilesService, FileStorage, Grant, GrantStore, OrderBook, StoredFile } from '../lib/aimp/files/index.ts';

const SECRET = 'test-only-signing-secret-0123456789abcdef';
const A = { workspaceId: 'ws-a', businessId: 'biz-a', actorId: 'owner-a' };
const B = { workspaceId: 'ws-b', businessId: 'biz-b', actorId: 'owner-b' };
const inputs = { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const HOUR = 3_600_000;

async function spec(): Promise<ProductSpec> {
  const bp = blueprintRegistry.find('printable-planner');
  assert.ok(bp);
  return generateProductSpec({ blueprint: bp, inputs, provider: createProviderRegistry({ env: {} }).llm });
}

interface World {
  files: FilesService; store: ReturnType<typeof createMemoryProductStore>; products: ReturnType<typeof createProductService>;
  orders: ReturnType<typeof createMemoryOrderBook>; storage: FileStorage; clock: { t: number };
  productId: string; versionId: string; itemId: string; master: StoredFile; preview: StoredFile;
}

interface Opts {
  maxDownloads?: number; ttlMs?: number; wrapStorage?: (s: FileStorage) => FileStorage;
  wrapOrders?: (o: OrderBook) => OrderBook; wrapGrants?: (g: GrantStore) => GrantStore;
}
async function world(opts: Opts = {}): Promise<World> {
  const store = createMemoryProductStore();
  const products = createProductService({ store, generateSpec: spec });
  const { product, version } = await products.createProduct(A, { businessId: 'biz-a', spec: await spec() });
  const approved = await products.approve(A, version.id);
  const buyer = await products.getBuyerFile(A, product.id);
  const master: StoredFile = { fileName: buyer.fileName, contentType: buyer.contentType, bytes: buyer.bytes };
  const preview: StoredFile = { fileName: 'preview.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('SAMPLE ONLY') };
  const base = createMemoryFileStorage();
  const storage = opts.wrapStorage ? opts.wrapStorage(base) : base;
  const orders = createMemoryOrderBook();
  const clock = { t: Date.parse('2026-11-14T00:00:00Z') };
  const grants = opts.wrapGrants ? opts.wrapGrants(createMemoryGrantStore()) : undefined;
  const files = createFilesService({ storage, orders: opts.wrapOrders ? opts.wrapOrders(orders) : orders, grants, products: store, secret: SECRET, ttlMs: opts.ttlMs, maxDownloads: opts.maxDownloads, now: () => new Date(clock.t) });
  await files.storeMaster(A, approved.id, master);
  await files.storePreview(A, approved.id, preview);
  orders.addPaidOrder({ orderId: 'o1', itemId: 'i1', workspaceId: 'ws-a', businessId: 'biz-a', productId: product.id, productVersion: 1 });
  return { files, store, products, orders, storage, clock, productId: product.id, versionId: approved.id, itemId: 'i1', master, preview };
}

const reasonOf = async (files: FilesService, token: string, opts?: { businessId?: string }): Promise<DenyReason | 'ok'> => {
  const r = await files.redeem(token, opts);
  return r.ok ? 'ok' : r.reason;
};
const issueFails = async (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof FilesError && e.code === code, `expected ${code}`);

test('a buyer can download the purchased master, byte for byte, and the count goes down', async () => {
  const w = await world();
  const { token, grant } = await w.files.issueGrant(A, w.itemId);
  assert.equal(grant.maxDownloads, 5);
  assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 72 * HOUR);
  const r = await w.files.redeem(token);
  assert.ok(r.ok);
  assert.deepEqual(Buffer.from(r.file.bytes), Buffer.from(w.master.bytes));
  assert.equal(r.remaining, 4);
  assert.equal(r.sha256, (await w.products.getBuyerFile(A, w.productId)).hash);
});

test('tampered, malformed and foreign-secret tokens are all invalid_token', async () => {
  const w = await world();
  const { token } = await w.files.issueGrant(A, w.itemId);
  const [v, body, sig] = token.split('.') as [string, string, string];
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { g: string; i: string; e: number };
  const forged = Buffer.from(JSON.stringify({ ...payload, e: payload.e + 365 * 24 * HOUR })).toString('base64url');
  const mid = Math.floor(sig.length / 2);
  const flipped = sig.slice(0, mid) + (sig[mid] === 'A' ? 'B' : 'A') + sig.slice(mid + 1);
  for (const bad of [`${v}.${forged}.${sig}`, `${v}.${body}.${flipped}`, `${v}.${body}`, `${v}.${body}.`, 'garbage', '', `${token}x`, 'x'.repeat(MAX_TOKEN_LENGTH + 1), `v2.${body}.${sig}`]) {
    assert.equal(await reasonOf(w.files, bad), 'invalid_token', bad.slice(0, 30));
  }
  assert.equal(await reasonOf(w.files, undefined as unknown as string), 'invalid_token');
  // A token signed with a different secret is just as dead.
  const other = signToken('another-secret-another-secret-another', payload);
  assert.equal(await reasonOf(w.files, other), 'invalid_token');
  assert.equal(await reasonOf(w.files, token), 'ok');
});

test('a non-canonical final base64url character (same decoded bytes) is rejected', async () => {
  const w = await world();
  const { token } = await w.files.issueGrant(A, w.itemId);
  const [v, body, sig] = token.split('.') as [string, string, string];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(sig.at(-1) as string);
  assert.equal(last % 4, 0, 'a 32-byte MAC ends on a canonical character');
  const twin = sig.slice(0, -1) + alphabet[last + 1];
  // Node decodes both spellings to the same bytes, so only the canonical check can tell them apart.
  assert.deepEqual(Buffer.from(twin, 'base64url'), Buffer.from(sig, 'base64url'));
  assert.equal(await reasonOf(w.files, `${v}.${body}.${twin}`), 'invalid_token');
  assert.equal(await reasonOf(w.files, token), 'ok');
});

test('a validly signed token for a grant that does not exist is invalid_token', async () => {
  const w = await world();
  const ghost = signToken(SECRET, { g: 'no-such-grant', i: w.itemId, e: w.clock.t + HOUR });
  assert.equal(await reasonOf(w.files, ghost), 'invalid_token');
});

test('expired links are denied with expired', async () => {
  const w = await world();
  const { token } = await w.files.issueGrant(A, w.itemId);
  w.clock.t += 72 * HOUR - 1;
  assert.equal(await reasonOf(w.files, token), 'ok');
  w.clock.t += 2;
  assert.equal(await reasonOf(w.files, token), 'expired');
});

test('revoked links are denied with revoked', async () => {
  const w = await world();
  const { token, grant } = await w.files.issueGrant(A, w.itemId);
  await w.files.revokeGrant(A, grant.id);
  assert.equal(await reasonOf(w.files, token), 'revoked');
});

test('the download count is enforced and counted only on success', async () => {
  const w = await world({ maxDownloads: 2 });
  const { token } = await w.files.issueGrant(A, w.itemId);
  assert.equal(await reasonOf(w.files, token), 'ok');
  assert.equal(await reasonOf(w.files, token), 'ok');
  assert.equal(await reasonOf(w.files, token), 'limit_reached');
  assert.equal((await w.files.listGrants(A, w.itemId))[0]?.downloads, 2);
});

test('parallel redeems cannot exceed the cap', async () => {
  const w = await world({ maxDownloads: 3 });
  const { token } = await w.files.issueGrant(A, w.itemId);
  const results = await Promise.all(Array.from({ length: 12 }, () => reasonOf(w.files, token)));
  assert.equal(results.filter((x) => x === 'ok').length, 3);
  assert.equal(results.filter((x) => x === 'limit_reached').length, 9);
});

test('unpaid, pending, failed and refunded orders never get or keep a link', async () => {
  const w = await world();
  for (const status of ['pending', 'failed', 'refunded'] as const) {
    w.orders.addPaidOrder({ orderId: `o-${status}`, itemId: `i-${status}`, workspaceId: 'ws-a', businessId: 'biz-a', productId: w.productId, productVersion: 1, status });
    await issueFails(w.files.issueGrant(A, `i-${status}`), 'order_not_paid');
  }
  const { token } = await w.files.issueGrant(A, w.itemId);
  assert.equal(await reasonOf(w.files, token), 'ok');
  w.orders.setStatus('o1', 'refunded');
  assert.equal(await reasonOf(w.files, token), 'order_not_paid');
  await issueFails(w.files.reissueGrant(A, w.itemId), 'order_not_paid');
});

test('another tenant cannot issue, revoke, list or reissue, and a wrong business is denied on redeem', async () => {
  const w = await world();
  const { token, grant } = await w.files.issueGrant(A, w.itemId);
  await issueFails(w.files.issueGrant(B, w.itemId), 'wrong_tenant');
  await issueFails(w.files.reissueGrant(B, w.itemId), 'wrong_tenant');
  await issueFails(w.files.revokeGrant(B, grant.id), 'wrong_tenant');
  assert.deepEqual(await w.files.listGrants(B, w.itemId), []);
  assert.equal(await reasonOf(w.files, token, { businessId: 'biz-b' }), 'wrong_tenant');
  assert.equal(await reasonOf(w.files, token, { businessId: 'biz-a' }), 'ok');
  // B's own order line that points at A's product must not reach A's file.
  w.orders.addPaidOrder({ orderId: 'ob', itemId: 'ib', workspaceId: 'ws-b', businessId: 'biz-b', productId: w.productId, productVersion: 1 });
  await assert.rejects(w.files.issueGrant(B, 'ib'), (e: unknown) => e instanceof FilesError && ['version_not_approved', 'wrong_tenant'].includes(e.code));
  // Same workspace but a different business than the product's.
  w.orders.addPaidOrder({ orderId: 'ox', itemId: 'ix', workspaceId: 'ws-a', businessId: 'biz-x', productId: w.productId, productVersion: 1 });
  await issueFails(w.files.issueGrant({ ...A, businessId: 'biz-x' }, 'ix'), 'wrong_tenant'); // the caller is the order's own business (biz-x), so the product mismatch is what refuses
  // A's audit does not show B's attempts and B's audit does not show A's grants.
  assert.ok(w.files.audit(B).every((e) => e.workspaceId === 'ws-b'));
  assert.ok(w.files.audit(A).every((e) => e.workspaceId === 'ws-a'));
});

test('a grant whose order line later moved to another business is denied on redeem', async () => {
  const w = await world();
  const { token } = await w.files.issueGrant(A, w.itemId);
  w.orders.addPaidOrder({ orderId: 'o1', itemId: w.itemId, workspaceId: 'ws-a', businessId: 'biz-other', productId: w.productId, productVersion: 1 });
  assert.equal(await reasonOf(w.files, token), 'wrong_tenant');
});

test('only an approved version can be delivered, stored or previewed', async () => {
  const w = await world();
  const v2 = await w.products.regenerate(A, w.productId);
  assert.equal(v2.status, 'in_review');
  w.orders.addPaidOrder({ orderId: 'o2', itemId: 'i2', workspaceId: 'ws-a', businessId: 'biz-a', productId: w.productId, productVersion: 2 });
  await issueFails(w.files.issueGrant(A, 'i2'), 'version_not_approved');
  await issueFails(w.files.storeMaster(A, v2.id, w.master), 'version_not_approved');
  await issueFails(w.files.storePreview(A, v2.id, w.preview), 'version_not_approved');
  await assert.rejects(w.files.getPreview({ workspaceId: 'ws-a', versionId: v2.id }), (e: unknown) => e instanceof FilesError && e.code === 'version_not_approved');
  // A paid buyer keeps the version they bought: approving v2 supersedes v1 but v1 links (old and new) keep working.
  const { token } = await w.files.issueGrant(A, w.itemId);
  await w.products.approve(A, v2.id);
  assert.equal(await reasonOf(w.files, token), 'ok');
  assert.equal(await reasonOf(w.files, (await w.files.issueGrant(A, w.itemId)).token), 'ok');
  assert.equal(await reasonOf(w.files, (await w.files.reissueGrant(A, w.itemId)).token), 'ok');
  // ...but the superseded version is no longer storable or publicly previewable, and a never-approved one stays denied.
  await issueFails(w.files.storeMaster(A, w.versionId, w.master), 'version_not_approved');
  await issueFails(w.files.issueGrant(A, 'i2-never'), 'order_not_found');
  await assert.rejects(w.files.getPreview({ workspaceId: 'ws-a', versionId: w.versionId }), (e: unknown) => e instanceof FilesError && e.code === 'version_not_approved');
});

test('a master that does not match the approved hash cannot be stored', async () => {
  const w = await world();
  const v2 = await w.products.regenerate(A, w.productId);
  const approved = await w.products.approve(A, v2.id);
  await issueFails(w.files.storeMaster(A, approved.id, { ...w.master, bytes: new TextEncoder().encode('not the product') }), 'file_changed');
});

test('missing and swapped master files are denied', async () => {
  const gone = { on: false }; const swap = { on: false };
  const w = await world({
    wrapStorage: (s) => ({
      ...s,
      getMaster: async (k) => {
        if (gone.on) return null;
        const f = await s.getMaster(k);
        return f && swap.on ? { ...f, bytes: new TextEncoder().encode('swapped') } : f;
      },
    }),
  });
  const { token } = await w.files.issueGrant(A, w.itemId);
  swap.on = true;
  assert.equal(await reasonOf(w.files, token), 'file_changed');
  swap.on = false; gone.on = true;
  assert.equal(await reasonOf(w.files, token), 'file_missing');
  await issueFails(w.files.issueGrant(A, w.itemId), 'file_missing');
  assert.equal((await w.files.listGrants(A, w.itemId)).length, 1);
  assert.equal((await w.files.listGrants(A, w.itemId))[0]?.downloads, 0);
});

test('an approved version with no stored master cannot get a link', async () => {
  const w = await world();
  const v2 = await w.products.regenerate(A, w.productId);
  const approved = await w.products.approve(A, v2.id);
  w.orders.addPaidOrder({ orderId: 'o3', itemId: 'i3', workspaceId: 'ws-a', businessId: 'biz-a', productId: w.productId, productVersion: approved.version });
  await issueFails(w.files.issueGrant(A, 'i3'), 'file_missing');
});

test('reissue gives a new working token and the old one stops working', async () => {
  const w = await world();
  const first = await w.files.issueGrant(A, w.itemId);
  const second = await w.files.reissueGrant(A, w.itemId);
  assert.notEqual(second.token, first.token);
  assert.notEqual(second.grant.id, first.grant.id);
  assert.equal(second.grant.replacesGrantId, first.grant.id);
  assert.equal(second.grant.downloads, 0);
  assert.equal(await reasonOf(w.files, first.token), 'revoked');
  assert.equal(await reasonOf(w.files, second.token), 'ok');
  const third = await w.files.reissueGrant(A, w.itemId);
  assert.equal(await reasonOf(w.files, second.token), 'revoked');
  assert.equal(await reasonOf(w.files, third.token), 'ok');
  assert.equal((await w.files.listGrants(A, w.itemId)).filter((g) => g.revokedAt === null).length, 1);
});

test('masters are never reachable through the preview path', async () => {
  const w = await world();
  const p = await w.files.getPreview({ workspaceId: 'ws-a', versionId: w.versionId });
  assert.equal(p.fileName, 'preview.txt');
  assert.notDeepEqual(Buffer.from(p.bytes), Buffer.from(w.master.bytes));
  // Storage exposes exactly four operations and none maps a master to a public address.
  assert.deepEqual(Object.keys(w.storage).sort(), ['getMaster', 'getPreview', 'putMaster', 'putPreview']);
  // A preview identical to the master is refused, so the paid file cannot be published by mistake.
  const key = { workspaceId: 'ws-a', businessId: 'biz-a', productId: w.productId, version: 1 };
  await assert.rejects(w.storage.putPreview(key, w.master), (e: unknown) => e instanceof FilesError);
  // A version with a master but no preview serves nothing (never falls back to the master).
  const v2 = await w.products.regenerate(A, w.productId);
  const ap = await w.products.approve(A, v2.id);
  await w.files.storeMaster(A, ap.id, { fileName: 'v2.zip', contentType: 'application/zip', bytes: (await w.products.getBuyerFile(A, w.productId)).bytes });
  await assert.rejects(w.files.getPreview({ workspaceId: 'ws-a', versionId: ap.id }), (e: unknown) => e instanceof FilesError && e.code === 'file_missing');
  // Another workspace cannot read A's preview by version id.
  await assert.rejects(w.files.getPreview({ workspaceId: 'ws-b', versionId: w.versionId }), (e: unknown) => e instanceof FilesError && e.code === 'wrong_tenant');
});

test('storage keys cannot escape their folder and namespaces are per tenant, business, product and version', async () => {
  assert.equal(fileKeyPath({ workspaceId: 'w', businessId: 'b', productId: 'p', version: 3 }), 'w/b/p/v3');
  for (const bad of ['..', 'a/b', '', 'x\\y']) assert.throws(() => fileKeyPath({ workspaceId: bad, businessId: 'b', productId: 'p', version: 1 }), FilesError);
  assert.throws(() => fileKeyPath({ workspaceId: 'w', businessId: 'b', productId: 'p', version: 0 }), FilesError);
  const s = createMemoryFileStorage();
  const f: StoredFile = { fileName: 'a', contentType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) };
  await s.putMaster({ workspaceId: 'w1', businessId: 'b', productId: 'p', version: 1 }, f);
  assert.equal(await s.getMaster({ workspaceId: 'w2', businessId: 'b', productId: 'p', version: 1 }), null);
  assert.equal(await s.getMaster({ workspaceId: 'w1', businessId: 'b2', productId: 'p', version: 1 }), null);
  assert.equal(await s.getMaster({ workspaceId: 'w1', businessId: 'b', productId: 'p', version: 2 }), null);
  assert.equal(await s.getPreview({ workspaceId: 'w1', businessId: 'b', productId: 'p', version: 1 }), null);
});

test('every allow and deny is audited, with reason codes and never a token or the secret', async () => {
  const w = await world({ maxDownloads: 1 });
  const first = await w.files.issueGrant(A, w.itemId);
  await w.files.redeem(first.token);
  await w.files.redeem(first.token);
  await w.files.redeem('garbage');
  const second = await w.files.reissueGrant(A, w.itemId);
  await w.files.redeem(first.token);
  await w.files.revokeGrant(A, second.grant.id);
  await w.files.getPreview({ workspaceId: 'ws-a', versionId: w.versionId });
  const all = w.files.auditAll();
  const events = all.map((e) => `${e.event}:${e.reason ?? ''}`);
  for (const want of ['master_stored:', 'preview_stored:', 'grant_issued:', 'download_allowed:', 'download_denied:limit_reached', 'download_denied:invalid_token', 'grant_reissued:', 'download_denied:revoked', 'grant_revoked:', 'preview_served:']) {
    assert.ok(events.includes(want), `missing ${want}; have ${events.join(', ')}`);
  }
  assert.deepEqual(all.map((e) => e.seq), all.map((_, i) => i + 1));
  const dump = JSON.stringify(all);
  for (const secretish of [first.token, second.token, SECRET, first.token.split('.')[2] as string]) assert.ok(!dump.includes(secretish));
  assert.equal(w.files.audit(A).some((e) => e.event === 'download_allowed'), true);
});

test('config: demo falls back to a temporary secret, live without a secret refuses, defaults are sane', () => {
  const demo = resolveFilesConfig({});
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.connection, 'fixture');
  assert.equal(demo.secretSource, 'ephemeral');
  assert.ok(demo.secret.length >= 32);
  assert.equal(demo.ttlMs, DEFAULT_TTL_HOURS * HOUR);
  assert.equal(demo.maxDownloads, DEFAULT_MAX_DOWNLOADS);
  assert.throws(() => resolveFilesConfig({ AIMP_STORAGE_LIVE: 'true' }), /AIMP_FILES_SIGNING_SECRET/);
  assert.throws(() => resolveFilesConfig({ AIMP_STORAGE_LIVE: 'true', AIMP_FILES_SIGNING_SECRET: 'short' }));
  const live = resolveFilesConfig({ AIMP_STORAGE_LIVE: 'true', AIMP_FILES_SIGNING_SECRET: SECRET, AIMP_FILES_LINK_TTL_HOURS: '24', AIMP_FILES_MAX_DOWNLOADS: '3' });
  assert.equal(live.mode, 'live');
  assert.equal(live.connection, 'disconnected');
  assert.equal(live.secretSource, 'env');
  assert.equal(live.ttlMs, 24 * HOUR);
  assert.equal(live.maxDownloads, 3);
  assert.equal(resolveFilesConfig({ AIMP_FILES_MAX_DOWNLOADS: '0' }).maxDownloads, DEFAULT_MAX_DOWNLOADS);
  assert.throws(() => signToken('short', { g: 'a', i: 'b', e: 1 }));
  assert.equal(verifyToken(SECRET, signToken(SECRET, { g: 'a', i: 'b', e: 5 }))?.e, 5);
  assert.throws(() => createFilesService({ storage: createMemoryFileStorage(), orders: createMemoryOrderBook(), products: createMemoryProductStore(), secret: 'short' }), FilesError);
});

// ---- route handler -------------------------------------------------------------------------------------------------

const call = (h: ReturnType<typeof createDownloadHandler>, token: string) =>
  h(new Request(`http://localhost/api/aimp/files/${token}`), { params: Promise.resolve({ token }) });

test('route: a valid link streams the master as an attachment with no-store and safe headers', async () => {
  const w = await world();
  const h = createDownloadHandler(() => w.files);
  const { token } = await w.files.issueGrant(A, w.itemId);
  const res = await call(h, token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="[A-Za-z0-9._-]+"$/);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('content-length'), String(w.master.bytes.byteLength));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(w.master.bytes));
});

test('route: unauthorised visitors get a generic 404 or 410 that never names the reason', async () => {
  const w = await world({ maxDownloads: 1 });
  const h = createDownloadHandler(() => w.files);
  const bodies = new Set<string>();
  const seen = async (token: string, status: number) => {
    const res = await call(h, token);
    assert.equal(res.status, status);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('content-disposition'), null);
    const body = await res.text();
    assert.ok(!/revoked|expired|limit|refund|paid|tenant|approved|signature|tamper|missing/i.test(body), body);
    bodies.add(`${status}:${body}`);
  };
  const live = await w.files.issueGrant(A, w.itemId);
  await seen(`${live.token}x`, 404);
  await seen('garbage', 404);
  assert.equal((await call(h, live.token)).status, 200);
  // The token above was consumed (cap 1): now over the cap -> 410.
  await seen(live.token, 410);
  const re = await w.files.reissueGrant(A, w.itemId);
  await seen(live.token, 410); // revoked
  w.clock.t += 100 * HOUR;
  await seen(re.token, 410); // expired
  const fresh = await w.files.reissueGrant(A, w.itemId);
  w.orders.setStatus('o1', 'refunded');
  await seen(fresh.token, 404); // refunded -> 404, not 410
  // Only two distinct public answers exist.
  assert.deepEqual([...bodies].sort(), ['404:{"error":"Not found."}', '410:{"error":"This link is no longer available."}']);
});

test('route: 503 when storage is not connected, 404 when the token param cannot be read', async () => {
  const none = createDownloadHandler(() => null);
  assert.equal((await call(none, 'whatever')).status, 503);
  const w = await world();
  const h = createDownloadHandler(() => w.files);
  const res = await h(new Request('http://localhost/x'), { params: Promise.reject(new Error('bad')) });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('route: the Next route file exports only GET and dynamic', async () => {
  const mod = await import('../app/api/aimp/files/[token]/route.ts');
  assert.deepEqual(Object.keys(mod).sort(), ['GET', 'dynamic']);
});

// ---- rework round: races, caps, content types, config errors ---------------------------------------------------------

test('store: tryConsume refuses revoked, expired and capped grants in one conditional step', async () => {
  const s = createMemoryGrantStore();
  const base: Grant = { id: 'g', orderItemId: 'i', workspaceId: 'w', businessId: 'b', issuedAt: '2026-11-14T00:00:00.000Z', expiresAt: '2026-11-15T00:00:00.000Z', maxDownloads: 2, downloads: 0, revokedAt: null, replacesGrantId: null };
  await s.put(base);
  assert.equal(await s.tryConsume('g', '2026-11-14T12:00:00.000Z'), true);
  assert.equal(await s.tryConsume('g', '2026-11-15T00:00:00.000Z'), false, 'expiry instant is already expired');
  await s.revoke('g', '2026-11-14T13:00:00.000Z');
  assert.equal(await s.tryConsume('g', '2026-11-14T14:00:00.000Z'), false);
  await s.put({ ...base, id: 'c', maxDownloads: 1 });
  assert.equal(await s.tryConsume('c', '2026-11-14T01:00:00.000Z'), true);
  assert.equal(await s.tryConsume('c', '2026-11-14T01:00:00.000Z'), false);
  assert.equal(await s.tryConsume('missing', '2026-11-14T01:00:00.000Z'), false);
});

test('a revoke that lands between the checks and the count still wins', async () => {
  let revokeNow: (() => Promise<void>) | null = null;
  const w = await world({
    wrapGrants: (g) => ({ ...g, tryConsume: async (id, at) => { await revokeNow?.(); return g.tryConsume(id, at); } }),
  });
  const { token, grant } = await w.files.issueGrant(A, w.itemId);
  revokeNow = () => w.files.revokeGrant(A, grant.id);
  assert.equal(await reasonOf(w.files, token), 'revoked');
  assert.equal((await w.files.listGrants(A, w.itemId))[0]?.downloads, 0);
});

test('a refund that lands while the file loads wins over the download', async () => {
  const flip = { on: false };
  const w: World = await world({ wrapStorage: (s) => ({ ...s, getMaster: async (k) => { const f = await s.getMaster(k); if (flip.on) w.orders.setStatus('o1', 'refunded'); return f; } }) });
  const { token } = await w.files.issueGrant(A, w.itemId);
  flip.on = true;
  assert.equal(await reasonOf(w.files, token), 'order_not_paid');
  assert.equal((await w.files.listGrants(A, w.itemId))[0]?.downloads, 0);
});

test('redeem: an order line that vanished is order_not_found, and over HTTP the answer is a generic 404', async () => {
  const gone = { on: false };
  const w = await world({ wrapOrders: (o) => ({ getItem: async (id) => (gone.on ? null : o.getItem(id)) }) });
  const h = createDownloadHandler(() => w.files);
  const { token } = await w.files.issueGrant(A, w.itemId);
  gone.on = true;
  assert.equal(await reasonOf(w.files, token), 'order_not_found');
  assert.equal((await call(h, token)).status, 404);
});

test('route: a link whose order line moved to another business is a generic 404 (wrong_tenant)', async () => {
  const w = await world();
  const h = createDownloadHandler(() => w.files);
  const { token } = await w.files.issueGrant(A, w.itemId);
  w.orders.addPaidOrder({ orderId: 'o1', itemId: w.itemId, workspaceId: 'ws-a', businessId: 'biz-other', productId: w.productId, productVersion: 1 });
  const res = await call(h, token);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '{"error":"Not found."}');
  assert.equal(w.files.auditAll().at(-1)?.reason, 'wrong_tenant');
});

test('the in-memory audit log is a ring buffer of the newest entries', async () => {
  const w = await world();
  for (let i = 0; i < AUDIT_CAP + 100; i++) await w.files.redeem('garbage');
  const all = w.files.auditAll();
  assert.equal(all.length, AUDIT_CAP);
  assert.equal(all.at(-1)?.seq, AUDIT_CAP + 100 + 2); // 2 entries came from storing the master and preview
  assert.ok((all[0]?.seq ?? 0) > 100);
});

test('parallel reissues leave exactly one active grant', async () => {
  const w = await world();
  await w.files.issueGrant(A, w.itemId);
  const results = await Promise.all(Array.from({ length: 6 }, () => w.files.reissueGrant(A, w.itemId)));
  const grants = await w.files.listGrants(A, w.itemId);
  const active = grants.filter((g) => g.revokedAt === null);
  assert.equal(active.length, 1);
  assert.equal(grants.length, 7);
  const works: string[] = [];
  for (const r of results) if ((await reasonOf(w.files, r.token)) === 'ok') works.push(r.grant.id);
  assert.deepEqual(works, [active[0]?.id]);
});

test('content types are header-safe: bad values fall back to application/octet-stream, good ones are kept', async () => {
  assert.equal(safeContentType('application/zip'), 'application/zip');
  assert.equal(safeContentType('text/plain; charset=utf-8'), 'text/plain; charset=utf-8');
  for (const bad of ['text/html\r\nX-Evil: 1', 'nonsense', '', 'a/b c', 'text/plain; boundary=x', undefined, 42]) assert.equal(safeContentType(bad), 'application/octet-stream');
  const w = await world();
  const v2 = await w.products.regenerate(A, w.productId);
  const ap = await w.products.approve(A, v2.id);
  const bytes = (await w.products.getBuyerFile(A, w.productId)).bytes;
  await w.files.storeMaster(A, ap.id, { fileName: 'v2.zip', contentType: 'text/html\r\nX-Evil: 1', bytes });
  const stored = await w.storage.getMaster({ workspaceId: 'ws-a', businessId: 'biz-a', productId: w.productId, version: 2 });
  assert.equal(stored?.contentType, 'application/octet-stream');
});

test('route: a throwing lookup (configuration error) is a generic 503 with no detail', async () => {
  const h = createDownloadHandler(() => { throw new Error('AIMP_FILES_SIGNING_SECRET must be set'); });
  const res = await call(h, 'whatever');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!(await res.text()).includes('AIMP_FILES'));
});
