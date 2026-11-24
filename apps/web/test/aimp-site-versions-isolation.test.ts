import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';
import { createSiteVersionStore, demoActorA, demoActorB, seedDemoSites, type Actor } from '../lib/aimp/site-versions/index.ts';

const A = demoActorA, B = demoActorB;
const SA = demoStore.slug, SB = demoStoreB.slug;

const denied = (r: { ok: boolean }) => {
  const x = r as unknown as { ok: boolean; code?: string; errors?: string[] };
  assert.equal(x.ok, false);
  assert.equal(x.code, 'denied');
  assert.match(x.errors?.[0] ?? '', /do not have access|already taken|Sign in/);
};

test('another workspace is denied every management call and nothing changes', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  const before = JSON.stringify(await store.resolvePublished(SA));
  denied(await store.getDraft(B, SA));
  denied(await store.editDraft(B, SA, (d) => { d.hero.heading = 'Takeover'; }));
  denied(await store.previewDraft(B, SA));
  denied(await store.publish(B, SA));
  denied(await store.pause(B, SA));
  denied(await store.unpause(B, SA));
  denied(await store.rollback(B, SA, 1));
  denied(await store.history(B, SA));
  denied(await store.getVersion(B, SA, 1));
  assert.equal(JSON.stringify(await store.resolvePublished(SA)), before);
  const own = await store.getDraft(A, SA);
  assert.equal(own.ok && own.value.config.hero.heading, demoStore.hero.heading);
  assert.equal(own.ok && own.value.revision, 1);
});

test('the owner cannot touch the other workspace store either', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  denied(await store.editDraft(A, SB, (d) => { d.hero.heading = 'Takeover'; }));
  denied(await store.pause(A, SB));
  const r = await store.resolvePublished(SB);
  assert.equal(r.status === 'live' && r.config.hero.heading, demoStoreB.hero.heading);
});

test('each workspace sees only its own stores and has its own version numbers', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  const la = await store.listSites(A), lb = await store.listSites(B);
  assert.deepEqual(la.ok && la.value, [SA]);
  assert.deepEqual(lb.ok && lb.value, [SB]);
  const pa = await store.editDraft(A, SA, (d) => { d.hero.heading = 'A two'; });
  assert.equal(pa.ok, true);
  const v = await store.publish(A, SA);
  assert.equal(v.ok && v.value.version, 2);
  const hb = await store.history(B, SB);
  assert.equal(hb.ok && hb.value.liveVersion, 1, 'B is unaffected by A publishing');
  // Pausing one store does not pause another.
  assert.equal((await store.pause(A, SA)).ok, true);
  assert.equal((await store.resolvePublished(SA)).status, 'paused');
  assert.equal((await store.resolvePublished(SB)).status, 'live');
});

test('a store address belongs to the first workspace that creates it', async () => {
  const store = createSiteVersionStore();
  assert.equal((await store.createSite(A, demoStore)).ok, true);
  denied(await store.createSite(B, demoStore));
  const again = await store.createSite(A, demoStore);
  assert.equal(again.ok === false && again.code, 'conflict');
  const reserved = await store.createSite(A, { ...demoStore, slug: 'admin' });
  assert.equal(reserved.ok === false && reserved.code, 'invalid');
  const badCfg = await store.createSite(A, { ...demoStore, slug: 'fresh-store', products: [] });
  assert.equal(badCfg.ok === false && badCfg.code, 'invalid');
  assert.equal((await store.listSites(A)).ok, true);
});

test('missing or empty actor identity is denied', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  for (const actor of [{ workspaceId: '', userId: 'u' }, { workspaceId: 'w', userId: '' }, undefined as unknown as Actor]) {
    denied(await store.getDraft(actor, SA));
    denied(await store.publish(actor, SA));
    denied(await store.listSites(actor));
    denied(await store.createSite(actor, demoStore));
  }
});

test('unknown stores are not_found and the public resolver never leaks drafts or other data', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  const nf = await store.getDraft(A, 'no-such-store');
  assert.equal(nf.ok === false && nf.code, 'not_found');
  await store.editDraft(A, SA, (d) => { d.hero.heading = 'SECRET-DRAFT-TEXT'; });
  const pub = await store.resolvePublished(SA);
  assert.deepEqual(Object.keys(pub).sort(), ['config', 'publishedAt', 'status', 'version']);
  assert.equal(JSON.stringify(pub).includes('SECRET-DRAFT-TEXT'), false);
  assert.equal(pub.status === 'live' && pub.config.status, 'published');
  assert.deepEqual(await store.resolvePublished(''), { status: 'none' });
  assert.deepEqual(await store.resolvePublished('__proto__'), { status: 'none' });
});
