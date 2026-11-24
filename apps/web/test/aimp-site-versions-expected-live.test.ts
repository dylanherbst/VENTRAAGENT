// AMP-145: site-version store compare-and-set on the live version (rollback/pause expectedLive) and the stored "check passed" flag.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteVersionStore, demoActorA, demoActorB } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };

async function twoVersions() {
  const s = createSiteVersionStore();
  assert.equal((await s.createSite(A, demoStore)).ok, true);
  assert.equal((await s.publish(A, SLUG)).ok, true);
  assert.equal((await s.editDraft(A, SLUG, setHeading('Second'))).ok, true);
  assert.equal((await s.publish(A, SLUG)).ok, true);
  return s;
}
const live = async (s: Awaited<ReturnType<typeof twoVersions>>) => { const h = await s.history(A, SLUG); return h.ok ? { v: h.value.liveVersion, paused: h.value.paused, n: h.value.versions.length } : null; };

test('AMP-145: rollback with expectedLive equal to the live version works', async () => {
  const s = await twoVersions();
  const r = await s.rollback(A, SLUG, 1, { expectedLive: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(await live(s), { v: 3, paused: false, n: 3 });
});

test('AMP-145: rollback with a different expectedLive answers conflict and changes nothing', async () => {
  const s = await twoVersions();
  const r = await s.rollback(A, SLUG, 1, { expectedLive: 1 });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.code, 'conflict'); assert.match(r.errors.join(' '), /Version 2 is live now, not version 1/); }
  assert.deepEqual(await live(s), { v: 2, paused: false, n: 2 });
});

test('AMP-145: pause with a different expectedLive answers conflict and does not pause', async () => {
  const s = await twoVersions();
  const r = await s.pause(A, SLUG, { expectedLive: 1 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'conflict');
  assert.deepEqual(await live(s), { v: 2, paused: false, n: 2 });
  assert.equal((await s.resolvePublished(SLUG)).status, 'live');
});

test('AMP-145: pause with the matching expectedLive pauses', async () => {
  const s = await twoVersions();
  assert.equal((await s.pause(A, SLUG, { expectedLive: 2 })).ok, true);
  assert.equal((await s.resolvePublished(SLUG)).status, 'paused');
});

test('AMP-145: expectedLive with nothing published is a conflict; a non-integer expectedLive is invalid', async () => {
  const s = createSiteVersionStore();
  await s.createSite(A, demoStore);
  const p = await s.pause(A, SLUG, { expectedLive: 1 });
  assert.ok(!p.ok && p.code === 'conflict');
  const bad = await s.pause(A, SLUG, { expectedLive: 1.5 });
  assert.ok(!bad.ok && bad.code === 'invalid');
  await s.publish(A, SLUG);
  const bad2 = await s.rollback(A, SLUG, 1, { expectedLive: Number.NaN });
  assert.ok(!bad2.ok && bad2.code === 'invalid');
});

test('AMP-145: callers without expectedLive behave as before', async () => {
  const s = await twoVersions();
  assert.equal((await s.rollback(A, SLUG, 1)).ok, true);
  assert.equal((await s.pause(A, SLUG)).ok, true);
  assert.equal((await s.unpause(A, SLUG)).ok, true);
});

test('AMP-145: markChecked is stored per version, shows as checkedOk in history, and is idempotent', async () => {
  const s = await twoVersions();
  let h = await s.history(A, SLUG);
  assert.ok(h.ok && h.value.versions.every((v) => v.checkedOk === undefined));
  assert.equal((await s.markChecked(A, SLUG, 2)).ok, true);
  assert.equal((await s.markChecked(A, SLUG, 2)).ok, true);
  h = await s.history(A, SLUG);
  assert.ok(h.ok);
  if (h.ok) {
    assert.equal(h.value.versions.find((v) => v.version === 2)?.checkedOk, true);
    assert.equal(h.value.versions.find((v) => v.version === 1)?.checkedOk, undefined);
  }
  // an unchanged publish returns the live summary with the flag
  const again = await s.publish(A, SLUG);
  assert.ok(again.ok && again.value.unchanged === true && again.value.checkedOk === true);
  // a rollback copy is a new version and is NOT marked
  const rb = await s.rollback(A, SLUG, 1);
  assert.ok(rb.ok && rb.value.checkedOk === undefined);
});

test('AMP-145: markChecked refuses an old (not live) version and a paused-nothing store, and flags nothing', async () => {
  const s = await twoVersions(); // version 2 is live, version 1 is old
  const old = await s.markChecked(A, SLUG, 1);
  assert.ok(!old.ok && old.code === 'conflict');
  if (!old.ok) assert.match(old.errors.join(' '), /Version 2 is live now, not version 1/);
  const h = await s.history(A, SLUG);
  assert.ok(h.ok && h.value.versions.every((v) => v.checkedOk === undefined));
  // nothing live at all
  const empty = createSiteVersionStore();
  await empty.createSite(A, demoStore);
  const none = await empty.markChecked(A, SLUG, 1);
  assert.ok(!none.ok && (none.code === 'not_found' || none.code === 'conflict'));
});

test('AMP-145: markChecked refuses an unknown version and another workspace', async () => {
  const s = await twoVersions();
  const nf = await s.markChecked(A, SLUG, 9);
  assert.ok(!nf.ok && nf.code === 'not_found');
  const other = await s.markChecked(demoActorB, SLUG, 2);
  assert.ok(!other.ok && other.code === 'denied');
  const h = await s.history(A, SLUG);
  assert.ok(h.ok && h.value.versions.every((v) => v.checkedOk === undefined));
});
