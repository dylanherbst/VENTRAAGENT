import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryVault, fileVault, supabaseVault } from '../lib/aimp/studio/vault.ts';
import { hashPassword, verifyPassword, signSession, verifySession, createLoginLimiter } from '../lib/aimp/studio/auth.ts';
import { addBrand, listBrands, setArchived } from '../lib/aimp/studio/brands.ts';
import { openBrand, sandboxAppSecret, type StudioProviders } from '../lib/aimp/studio/workspace.ts';
import { demoWriter } from '../lib/aimp/marketing-engine/index.ts';
import { mockImages, mockPublisher, mockRenderer } from '../lib/aimp/agents/index.ts';
import { ruleAgent, signForTest, simulatedPayload } from '../lib/aimp/setter/index.ts';

const SECRET = 'x'.repeat(40);
const providers = (): StudioProviders => ({ writer: demoWriter, secret: SECRET, setterAgent: () => ruleAgent,
  team: { text: null, images: mockImages, renderer: mockRenderer(), publisher: mockPublisher(), flags: { agentsEnabled: true, paidAdsEnabled: false, autoSendMessagesEnabled: false, publishingEnabled: false }, templates: { reel: null, static: null }, publicUrl: null, zernioWebhookSecret: null, sleep: async () => {} } });
const LASH = { businessName: 'Lash Lab', industry: 'beauty', offer: 'Lash extensions and lifts', audience: 'Women in Joondalup', website: '', timezone: 'Australia/Perth' };
const VENTRA = { businessName: 'AiMoneyPrinter', industry: 'software', offer: 'One app to launch and market a small business', audience: 'Side hustlers and small business owners', website: '', timezone: 'Australia/Perth' };

test('auth: scrypt password, signed expiring session, brute-force brake', async () => {
  const h = await hashPassword('correct horse battery', 1024);
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.equal(await verifyPassword('wrong password here', h), false);
  assert.equal(await verifyPassword('anything', undefined), false);
  await assert.rejects(hashPassword('short'));
  const tok = signSession(SECRET, Date.now());
  assert.ok(await verifySession(tok, SECRET));
  assert.equal(await verifySession(tok, 'y'.repeat(40)), false);
  assert.equal(await verifySession(tok.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), SECRET), false);
  assert.equal(await verifySession(signSession(SECRET, Date.now() - 13 * 3600_000), SECRET), false, 'expired');
  assert.equal(await verifySession(tok, 'short'), false);
  const l = createLoginLimiter(); for (let i = 0; i < 5; i++) l.fail('ip'); assert.ok(l.blocked('ip')); assert.equal(l.blocked('other'), false);
});

test('brands: any number, unique ids, validation, archive', async () => {
  const v = memoryVault();
  const a = await addBrand(v, LASH); const b = await addBrand(v, LASH); const c = await addBrand(v, VENTRA);
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.brand.id, 'studio-lash-lab'); assert.equal(b.brand.id, 'studio-lash-lab-2'); assert.equal(c.brand.id, 'studio-aimoneyprinter');
  assert.equal((await addBrand(v, { businessName: '' })).ok, false);
  assert.equal((await listBrands(v)).length, 3);
  assert.ok(await setArchived(v, 'studio-lash-lab-2', true));
  assert.equal(await openBrand(v, 'studio-lash-lab-2', providers()), null, 'archived brands do not open');
});

test('workspace: agents run per brand, everything persists across requests, brands never mix', async () => {
  const v = memoryVault();
  await addBrand(v, LASH); await addBrand(v, VENTRA);
  // Request 1: posts, ads, an image, a mock account, a setter conversation.
  let o = (await openBrand(v, 'studio-lash-lab', providers()))!;
  assert.equal(o.team.profile(o.ws)?.businessName, 'Lash Lab');
  assert.equal(o.setterStore.config(o.ws)?.businessName, 'Lash Lab');
  const r = await o.team.launch(o.ws, 7, 'owner'); assert.ok(r.ads.ok && r.plan.ok);
  const post = o.team.dashboard(o.ws).posts.find((p) => p.slot.platform === 'instagram')!;
  assert.ok((await o.team.generateImage(o.ws, { type: 'post', id: post.id }, 'owner')).ok);
  await o.team.connectStart(o.ws, 'instagram', '', 'owner');
  const raw = simulatedPayload(o.igAccountId, [{ from: '900000000000001', text: 'how much are lash lifts?', mid: 'm1', ts: Date.now() }]);
  await o.setter.receive(raw, signForTest(raw, sandboxAppSecret()));
  await o.save();
  // Request 2: a fresh open sees it all.
  o = (await openBrand(v, 'studio-lash-lab', providers()))!;
  const d = o.team.dashboard(o.ws);
  assert.equal(d.campaigns.length, 1); assert.equal(d.campaigns[0]!.angles.length, 5);
  assert.ok(d.posts.length >= 3); assert.equal(d.accounts.length, 1);
  assert.equal(d.assets.length, 1); assert.ok(o.team.asset(o.ws, d.assets[0]!.id)?.bytes?.length, 'media bytes come back');
  assert.equal(o.setterStore.conversations(o.ws).length, 1);
  assert.ok(o.setterStore.messages(o.ws, o.setterStore.conversations(o.ws)[0]!.id).length >= 1);
  // The other brand is empty.
  const other = (await openBrand(v, 'studio-aimoneyprinter', providers()))!;
  assert.equal(other.team.dashboard(other.ws).posts.length, 0); assert.equal(other.setterStore.conversations(other.ws).length, 0);
  assert.notEqual(other.igAccountId, o.igAccountId);
});

test('vaults: file vault round-trips; supabase vault sends the right requests; bad keys refused', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-'));
  const f = await fileVault(dir);
  await f.put('brand/studio-x', { a: 1 }); assert.deepEqual(await f.get('brand/studio-x'), { a: 1 });
  assert.equal(await f.get('brand/none'), null);
  await assert.rejects(f.put('../etc/passwd', 1));
  const { rm } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true });
  await f.put('brands', [1]); assert.deepEqual(await f.get('brands'), [1], 'folder removed while running: the next save recreates it');
  const calls: { url: string; method: string; body?: string }[] = [];
  const s = supabaseVault({ url: 'https://p.supabase.co', serviceKey: 'k', fetch: async (url, init) => { calls.push({ url, method: init.method, body: init.body }); return { ok: true, status: 200, json: async () => [{ value: { b: 2 } }] }; } });
  assert.deepEqual(await s.get('brands'), { b: 2 });
  await s.put('brands', [1]);
  assert.equal(calls[0]!.url, 'https://p.supabase.co/rest/v1/studio_snapshots?key=eq.brands&select=value');
  assert.equal(calls[1]!.method, 'POST'); assert.match(calls[1]!.url, /on_conflict=key/); assert.equal(JSON.parse(calls[1]!.body!).key, 'brands');
});
