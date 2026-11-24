import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { validateStoreConfig, type StoreConfig } from '../lib/aimp/storefront/schema.ts';
import { createSiteVersionStore, demoActorA, seedDemoSites } from '../lib/aimp/site-versions/index.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const HEADING = demoStore.hero.heading;

function must<T>(r: { ok: true; value: T } | { ok: false; code: string; errors: string[] }): T {
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join(' | '));
  return (r as { ok: true; value: T }).value;
}
const bad = (r: { ok: boolean }) => r as unknown as { ok: false; code: string; errors: string[] };
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };
const lax = (input: unknown) => ({ ok: true as const, config: input as StoreConfig });

test('the whole version record is frozen: swapping config, version or source has no effect', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  must(await store.editDraft(A, SLUG, setHeading('Two')));
  must(await store.publish(A, SLUG));
  const v = must(await store.getVersion(A, SLUG, 1));
  const other = must(await store.getVersion(A, SLUG, 2));
  const servedBefore = JSON.stringify(await store.resolvePublished(SLUG));
  const historyBefore = JSON.stringify(must(await store.history(A, SLUG)));
  assert.equal(Object.isFrozen(v), true);
  assert.equal(Object.isFrozen(v.source), true);
  assert.throws(() => { (v as { config: StoreConfig }).config = other.config; }, TypeError);
  assert.throws(() => { (v as { version: number }).version = 99; }, TypeError);
  assert.throws(() => { (v.source as { kind: string }).kind = 'rollback'; }, TypeError);
  assert.throws(() => { (v as { note: string }).note = 'x'; }, TypeError);
  assert.equal(JSON.stringify(await store.resolvePublished(SLUG)), servedBefore);
  assert.equal(JSON.stringify(must(await store.history(A, SLUG))), historyBefore);
  assert.equal(must(await store.getVersion(A, SLUG, 1)).config.hero.heading, HEADING);
  // History summaries are copies: changing one changes nothing.
  const h = must(await store.history(A, SLUG));
  h.versions[0].note = 'edited';
  assert.notEqual(must(await store.history(A, SLUG)).versions[0].note, 'edited');
});

test('if the live snapshot no longer validates, the newest earlier valid version is served, then none', async () => {
  // A lax validator lets two versions in; the public resolver always applies the real storefront rules.
  const store = createSiteVersionStore({ validate: lax });
  must(await store.createSite(A, demoStore));
  must(await store.publish(A, SLUG)); // v1, valid
  must(await store.editDraft(A, SLUG, setHeading('Second')));
  must(await store.publish(A, SLUG)); // v2, valid
  must(await store.editDraft(A, SLUG, (d) => { d.products = []; }));
  assert.equal(must(await store.publish(A, SLUG)).version, 3); // v3 breaks the real rules
  const served = await store.resolvePublished(SLUG);
  assert.equal(served.status, 'live');
  assert.equal(served.status === 'live' && served.version, 2, 'falls back to v2, not none and not the broken v3');
  assert.equal(served.status === 'live' && served.config.hero.heading, 'Second');
  assert.deepEqual(must(await store.history(A, SLUG)).versions.map((v) => v.version), [3, 2, 1], 'history is untouched');
  // Only invalid versions exist: nothing is served.
  const only = createSiteVersionStore({ validate: lax });
  must(await only.createSite(A, demoStore));
  must(await only.editDraft(A, SLUG, (d) => { d.products = []; }));
  must(await only.publish(A, SLUG));
  assert.deepEqual(await only.resolvePublished(SLUG), { status: 'none' });
  // Paused still wins over the fallback.
  must(await store.pause(A, SLUG));
  assert.deepEqual(await store.resolvePublished(SLUG), { status: 'paused' });
});

test('rollback is still validated, and a rules change gives a clear message instead of "fix these"', async () => {
  let strict = false;
  const store = createSiteVersionStore({ validate: (i) => {
    const base = validateStoreConfig(i);
    if (base.ok && strict && base.config.hero.heading.length > 20) return { ok: false as const, errors: ['hero.heading: text 1-20 chars'] };
    return base;
  } });
  await seedDemoSites(store); // v1 has a heading longer than 20 characters
  must(await store.editDraft(A, SLUG, setHeading('Short one')));
  must(await store.publish(A, SLUG)); // v2
  strict = true;
  const r = bad(await store.rollback(A, SLUG, 1));
  assert.equal(r.code, 'invalid');
  assert.match(r.errors[0], /Version 1 no longer meets the current store rules/);
  assert.doesNotMatch(r.errors.join(' '), /Fix these/);
  assert.equal(must(await store.history(A, SLUG)).liveVersion, 2);
  const served = await store.resolvePublished(SLUG);
  assert.equal(served.status === 'live' && served.config.hero.heading, 'Short one');
  // A plain publish that fails still says what to fix.
  strict = false;
  must(await store.editDraft(A, SLUG, setHeading('A heading well over twenty characters')));
  strict = true;
  assert.match(bad(await store.publish(A, SLUG)).errors[0], /Fix these/);
});

test('publishing with no unpublished changes is a no-op, not a duplicate version', async () => {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  const r = must(await store.publish(A, SLUG, { note: 'again' }));
  assert.equal(r.unchanged, true);
  assert.equal(r.version, 1);
  let h = must(await store.history(A, SLUG));
  assert.equal(h.versions.length, 1);
  assert.equal(h.events.length, 1);
  must(await store.editDraft(A, SLUG, setHeading('Two')));
  assert.equal(must(await store.publish(A, SLUG)).version, 2);
  assert.equal(must(await store.publish(A, SLUG)).unchanged, true);
  // Editing back to the live value is also "no changes".
  must(await store.editDraft(A, SLUG, setHeading('Three')));
  must(await store.editDraft(A, SLUG, setHeading('Two')));
  assert.equal(must(await store.publish(A, SLUG)).unchanged, true);
  h = must(await store.history(A, SLUG));
  assert.deepEqual(h.versions.map((v) => v.version), [2, 1]);
});

test('two concurrent publishes: exactly one goes live and the other is a conflict', async () => {
  const store = createSiteVersionStore({ beforeCommit: async () => { await new Promise((r) => setTimeout(r, 5)); } });
  await seedDemoSites(store);
  must(await store.editDraft(A, SLUG, setHeading('Racing')));
  const results = await Promise.all([store.publish(A, SLUG, { note: 'one' }), store.publish(A, SLUG, { note: 'two' })]);
  const oks = results.filter((r) => r.ok);
  const conflicts = results.filter((r) => !r.ok && r.code === 'conflict');
  assert.equal(oks.length, 1);
  assert.equal(conflicts.length, 1);
  const h = must(await store.history(A, SLUG));
  assert.deepEqual(h.versions.map((v) => v.version), [2, 1]);
  const served = await store.resolvePublished(SLUG);
  assert.equal(served.status === 'live' && served.version, 2);
});

test('store address length follows the database rule: 42 accepted, 43 and 63 refused (validator and site store)', async () => {
  const withSlug = (slug: string) => ({ ...structuredClone(demoStore), slug }) as StoreConfig;
  const ok42 = 'a'.repeat(42);
  assert.equal(validateStoreConfig(withSlug(ok42)).ok, true);
  const store = createSiteVersionStore();
  must(await store.createSite(A, withSlug(ok42)));
  for (const n of [43, 63]) {
    const slug = 'a'.repeat(n);
    const v = validateStoreConfig(withSlug(slug));
    assert.equal(v.ok, false, `validator ${n}`);
    assert.ok(!v.ok && v.errors.some((e) => e.includes('3-42')), `validator message ${n}`);
    const r = bad(await store.createSite(A, withSlug(slug)));
    assert.equal(r.ok, false, `store ${n}`);
    assert.ok(r.errors[0].includes('3 to 42'), `store message ${n}`);
  }
});
