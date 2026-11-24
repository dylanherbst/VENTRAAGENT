import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPinterestPost, createAyrshareClient, readPostResponse, type FetchLike, type PinPost } from '../lib/aimp/social/ayrshare.ts';

const soon = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const pin = (o: Partial<PinPost> = {}): PinPost => ({
  text: 'Budget wedding planner printable. Download the PDF and start with page one. A$14.', title: 'Budget wedding planner printable', link: 'https://shop.example.test/products/planner',
  altText: 'Cover of the wedding planner printable', imageUrl: 'https://files.example.test/pins/d01.png', idempotencyKey: 'asset-d01-pin-v3', approvedBy: 'owner-1', ...o,
});

test('an approved Pin becomes the exact Ayrshare request (Pinterest options, image, idempotency key)', () => {
  const r = buildPinterestPost(pin({ boardId: '93383204522', scheduleDate: soon, aiModified: true }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.body.platforms, ['pinterest']);
  assert.deepEqual(r.body.mediaUrls, ['https://files.example.test/pins/d01.png']);
  assert.equal(r.body.idempotencyKey, 'asset-d01-pin-v3');
  assert.equal(r.body.scheduleDate, soon);
  assert.deepEqual(r.body.pinterestOptions, { title: 'Budget wedding planner printable', link: 'https://shop.example.test/products/planner', altText: ['Cover of the wedding planner printable'], boardId: '93383204522', aiDisclosures: ['AI_MODIFIED'] });
});

test('nothing is sent for a Pin that is not approved, has no https image, or breaks a limit', () => {
  const bad = (o: Partial<PinPost>) => { const r = buildPinterestPost(pin(o)); assert.equal(r.ok, false); return r.ok ? '' : r.errors.join(' '); };
  assert.match(bad({ approvedBy: null }), /not been approved/);
  assert.match(bad({ imageUrl: 'http://files.example.test/a.png' }), /https/);
  assert.match(bad({ text: 'x'.repeat(501) }), /500/);
  assert.match(bad({ title: 'x'.repeat(101) }), /100/);
  assert.match(bad({ link: 'javascript:alert(1)' }), /https/);
  assert.match(bad({ scheduleDate: '2026-12-01 09:00' }), /UTC/);
  assert.match(bad({ scheduleDate: '2020-01-01T00:00:00Z' }), /already passed/);
  assert.match(bad({ idempotencyKey: 'x' }), /stable key/);
});

test('replies are turned into plain results; a duplicate is recognised and error text is short', () => {
  assert.deepEqual(readPostResponse(200, { status: 'success', id: 'abc', postIds: [{ platform: 'pinterest', postUrl: 'https://pin.it/x' }] }), { ok: true, state: 'posted', ayrshareId: 'abc', postUrl: 'https://pin.it/x' });
  assert.deepEqual(readPostResponse(200, { status: 'scheduled', id: 'def' }), { ok: true, state: 'scheduled', ayrshareId: 'def', postUrl: null });
  const dup = readPostResponse(400, { status: 'error', errors: [{ code: 110, message: 'Status is a duplicate.' }] });
  assert.ok(!dup.ok && dup.duplicate && dup.code === 110);
  const long = readPostResponse(400, { errors: [{ code: 1, message: 'y'.repeat(900) }] });
  assert.ok(!long.ok && long.message.length === 300);
  assert.ok(!readPostResponse(500, 'nonsense').ok);
});

test('the client sends the key as Bearer, a customer as Profile-Key, never leaks the key, and survives a network failure', async () => {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const ok: FetchLike = async (url, init) => { calls.push({ url, headers: init.headers, ...(init.body ? { body: init.body } : {}) }); return { status: 200, json: async () => ({ status: 'success', id: 'p1', postIds: [] }) }; };
  const c = createAyrshareClient({ apiKey: 'SECRET-KEY', fetch: ok });
  const r = await c.postPin(pin(), { profileKey: 'cust-key' });
  assert.ok(r.ok);
  assert.equal(calls[0]!.url, 'https://api.ayrshare.com/api/post');
  assert.equal(calls[0]!.headers.Authorization, 'Bearer SECRET-KEY');
  assert.equal(calls[0]!.headers['Profile-Key'], 'cust-key');
  assert.ok(!calls[0]!.body!.includes('SECRET-KEY'));

  const refused = await c.postPin(pin({ approvedBy: null }));
  assert.ok(!refused.ok); assert.equal(calls.length, 1, 'no request for an unapproved Pin');

  const down = createAyrshareClient({ apiKey: 'SECRET-KEY', fetch: async () => { throw new Error('boom SECRET-KEY'); } });
  const f = await down.postPin(pin());
  assert.ok(!f.ok && !f.message.includes('SECRET-KEY') && /do not know/.test(f.message));
});

test('creating a customer profile returns the profile key once, and refuses empty names', async () => {
  const c = createAyrshareClient({ apiKey: 'k', fetch: async () => ({ status: 200, json: async () => ({ status: 'success', profileKey: 'PK1', refId: 'r1' }) }) });
  assert.deepEqual(await c.createProfile(' Wedding Planning Paper '), { ok: true, profileKey: 'PK1', refId: 'r1' });
  assert.equal((await c.createProfile('  ')).ok, false);
  const dup = createAyrshareClient({ apiKey: 'k', fetch: async () => ({ status: 400, json: async () => ({ status: 'error', errors: [{ code: 146, message: 'Profile title already exists.' }] }) }) });
  const r = await dup.createProfile('x'); assert.ok(!r.ok && /already exists/.test(r.message));
});
