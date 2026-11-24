import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildPin, createZernioClient, readPost, verifyWebhook, type ZernioPin } from '../lib/aimp/social/zernio.ts';
import type { FetchLike } from '../lib/aimp/social/ayrshare.ts';

const soon = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const pin = (o: Partial<ZernioPin> = {}): ZernioPin => ({
  text: 'Budget wedding planner printable. Download the PDF and start with page one. A$14.', title: 'Budget wedding planner printable', link: 'https://shop.example.test/products/planner',
  imageUrl: 'https://files.example.test/pins/d01.png', boardId: 'board-1', idempotencyKey: 'asset-d01-pin-v3', approvedBy: 'owner-1', ...o,
});

test('an approved Pin becomes the Zernio request: board, title, link, image, idempotency header', () => {
  const now = buildPin(pin(), 'acc-1');
  assert.ok(now.ok);
  if (now.ok) {
    assert.deepEqual(now.body.platforms, [{ platform: 'pinterest', accountId: 'acc-1', platformSpecificData: { boardId: 'board-1', title: 'Budget wedding planner printable', link: 'https://shop.example.test/products/planner' } }]);
    assert.deepEqual(now.body.mediaItems, [{ url: 'https://files.example.test/pins/d01.png', type: 'image' }]);
    assert.equal(now.body.publishNow, true);
    assert.equal(now.headers['Idempotency-Key'], 'asset-d01-pin-v3');
  }
  const later = buildPin(pin({ scheduleDate: soon }), 'acc-1');
  assert.ok(later.ok && later.body.scheduledFor === soon && later.body.timezone === 'UTC' && later.body.publishNow === undefined);
});

test('refused before any request: unapproved, no board, no https image, over 800 characters, past date', () => {
  const bad = (o: Partial<ZernioPin>, acc = 'acc-1') => { const r = buildPin(pin(o), acc); assert.equal(r.ok, false); return r.ok ? '' : r.errors.join(' '); };
  assert.match(bad({ approvedBy: null }), /not been approved/);
  assert.match(bad({ boardId: ' ' }), /board/);
  assert.match(bad({ imageUrl: 'http://x.test/a.png' }), /https/);
  assert.match(bad({ text: 'x'.repeat(801) }), /800/);
  assert.match(bad({ scheduleDate: '2020-01-01T00:00:00Z' }), /already passed/);
  assert.match(bad({}, ''), /connected Pinterest/);
});

test('a 2xx that is partial, failed or 207 is not a success; duplicates are recognised', () => {
  assert.deepEqual(readPost(201, { post: { _id: 'p1', status: 'published', platforms: [{ platformPostUrl: 'https://pin.it/x' }] } }), { ok: true, state: 'posted', ayrshareId: 'p1', postUrl: 'https://pin.it/x' });
  assert.ok(readPost(201, { post: { _id: 'p2', status: 'scheduled' } }).ok);
  const partial = readPost(207, { post: { status: 'partial', platforms: [{ errorMessage: 'Board not found' }] } });
  assert.ok(!partial.ok && /Board not found/.test(partial.message));
  assert.ok(!readPost(201, { post: { status: 'failed' } }).ok);
  const dup = readPost(409, { error: 'dup', code: 'duplicate_content' });
  assert.ok(!dup.ok && dup.duplicate);
});

test('webhook signatures: valid passes, tampered body, wrong secret and missing header fail', () => {
  const body = '{"event":"post.published"}';
  const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(verifyWebhook(body, sig, 's3cret'), true);
  assert.equal(verifyWebhook(body + ' ', sig, 's3cret'), false);
  assert.equal(verifyWebhook(body, sig, 'other'), false);
  assert.equal(verifyWebhook(body, null, 's3cret'), false);
  assert.equal(verifyWebhook(body, 'abc', 's3cret'), false);
});

function fake(routes: Record<string, (init: { method: string; headers: Record<string, string>; body?: string }) => { status: number; json: unknown }>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const key = Object.keys(routes).find((k) => `${init.method} ${url.replace('https://zernio.com/api/v1', '')}`.startsWith(k));
    if (!key) throw new Error('no route');
    const r = routes[key]!(init);
    return { status: r.status, json: async () => r.json };
  };
  return { f, calls };
}

test('one profile per customer: an existing one is reused, a missing one is created with our business id', async () => {
  const a = fake({ 'GET /profiles?externalId=biz-1': () => ({ status: 200, json: { profiles: [{ _id: 'prof-9' }] } }) });
  assert.deepEqual(await createZernioClient({ apiKey: 'K', fetch: a.f }).ensureProfile('Wedding Planning Paper', 'biz-1'), { ok: true, profileId: 'prof-9', created: false });
  const b = fake({ 'GET /profiles?externalId=biz-2': () => ({ status: 200, json: { profiles: [] } }), 'POST /profiles': () => ({ status: 201, json: { profile: { _id: 'prof-10' } } }) });
  assert.deepEqual(await createZernioClient({ apiKey: 'K', fetch: b.f }).ensureProfile('Shop', 'biz-2'), { ok: true, profileId: 'prof-10', created: true });
  assert.deepEqual(JSON.parse(b.calls[1]!.body!), { name: 'Shop', externalId: 'biz-2' });
  assert.equal(b.calls[1]!.headers.Authorization, 'Bearer K');
});

test('connect link: https only, returns the Zernio sign-in address', async () => {
  const a = fake({ 'GET /connect/pinterest': () => ({ status: 200, json: { authUrl: 'https://www.pinterest.com/oauth/?x=1', state: 's' } }) });
  const c = createZernioClient({ apiKey: 'K', fetch: a.f });
  assert.deepEqual(await c.connectUrl('pinterest', 'prof-9', 'https://app.example.test/app/biz-1/payments'), { ok: true, authUrl: 'https://www.pinterest.com/oauth/?x=1' });
  assert.match(a.calls[0]!.url, /profileId=prof-9/);
  assert.equal((await c.connectUrl('pinterest', 'prof-9', 'http://insecure.test/')).ok, false);
});

test('posting is blocked for an account that is not in this customer\'s profile, and sends no post', async () => {
  const a = fake({ 'GET /accounts?profileId=prof-9': () => ({ status: 200, json: { accounts: [{ _id: 'acc-1', platform: 'pinterest', username: 'mine', isActive: true }] } }) });
  const c = createZernioClient({ apiKey: 'K', fetch: a.f });
  const r = await c.postPin(pin(), { profileId: 'prof-9', accountId: 'acc-OTHER-CUSTOMER' });
  assert.ok(!r.ok && /not connected to this business/.test(r.message));
  assert.ok(!a.calls.some((x) => x.method === 'POST'));
});

test('a verified account posts once with the idempotency header; a network failure says we do not know', async () => {
  const a = fake({
    'GET /accounts?profileId=prof-9': () => ({ status: 200, json: { accounts: [{ _id: 'acc-1', platform: 'pinterest', username: 'mine', isActive: true }] } }),
    'POST /posts': () => ({ status: 201, json: { post: { _id: 'p1', status: 'published', platforms: [{ platformPostUrl: 'https://pin.it/x' }] } } }),
  });
  const r = await createZernioClient({ apiKey: 'K', fetch: a.f }).postPin(pin(), { profileId: 'prof-9', accountId: 'acc-1' });
  assert.ok(r.ok && r.postUrl === 'https://pin.it/x');
  assert.equal(a.calls.find((x) => x.method === 'POST')!.headers['Idempotency-Key'], 'asset-d01-pin-v3');
  const down = fake({ 'GET /accounts?profileId=prof-9': () => ({ status: 200, json: { accounts: [{ _id: 'acc-1', platform: 'pinterest', isActive: true }] } }) });
  const f2 = createZernioClient({ apiKey: 'SECRET', fetch: down.f });
  const bad = await f2.postPin(pin(), { profileId: 'prof-9', accountId: 'acc-1' });
  assert.ok(!bad.ok && /do not know/.test(bad.message) && !bad.message.includes('SECRET'));
});
