// AMP-145 (D03): the publish check uses the store's expectedLive on its undo paths and reads/writes the "passed" flag through the store.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteVersionStore, demoActorA, type SiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';
import {
  createPageLoader, publishWithCheck,
  type PublishCheckDeps, type PublishSiteApi, type PublishWithCheckDeps,
} from '../lib/aimp/publish-check/index.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const BIZ = 'biz-a';
const BROKEN = 'This page is broken';
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };

async function setup(publishFirst = true) {
  const versions = createSiteVersionStore();
  assert.equal((await versions.createSite(A, demoStore)).ok, true);
  if (publishFirst) assert.equal((await versions.publish(A, SLUG)).ok, true);
  return versions;
}
function checkDeps(versions: PublishSiteApi, flake: { on: boolean } = { on: false }): PublishCheckDeps {
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  return {
    resolveLive: (slug) => versions.resolvePublished(slug),
    loadPage: async (slug, ref) => {
      const r = await versions.resolvePublished(slug);
      const broken = r.status === 'live' && r.config.hero.heading === BROKEN;
      if (ref.page === 'home' && (flake.on || broken)) return { ok: false, reason: 'it threw while rendering.' };
      return base(slug, ref);
    },
    checkout: { canStart: async () => ({ ok: true }) },
    checkoutAvailable: true,
  };
}
const run = (d: PublishWithCheckDeps) => publishWithCheck(d, { actor: A, businessId: BIZ, storeSlug: SLUG });
/** A brand-new api object over the same store: a new "process" with no in-memory record. */
const fresh = (v: SiteVersionStore, over: Partial<PublishSiteApi> = {}): PublishSiteApi => ({
  publish: v.publish.bind(v), rollback: v.rollback.bind(v), pause: v.pause.bind(v), history: v.history.bind(v),
  resolvePublished: v.resolvePublished.bind(v), getVersion: v.getVersion.bind(v), markChecked: v.markChecked.bind(v), ...over,
});

test('AMP-145: a pass is recorded in the store and survives a new publish-check instance over the same store', async () => {
  const store = await setup(false);
  const flake = { on: false };
  const v1 = fresh(store);
  const first = await run({ versions: v1, check: checkDeps(v1, flake) });
  assert.equal(first.ok, true);
  const h = await store.history(A, SLUG);
  assert.ok(h.ok && h.value.versions.find((v) => v.version === 1)?.checkedOk === true, 'flag stored on the version');

  // "Restart": new api object, new check deps, no shared memory. The same unchanged draft now flakes.
  flake.on = true;
  const v2 = fresh(store);
  const again = await run({ versions: v2, check: checkDeps(v2, flake) });
  assert.equal(again.ok, false);
  if (!again.ok) { assert.equal(again.outcome, 'unchanged_check_failed'); assert.equal(again.version, 1); }
  const after = await store.history(A, SLUG);
  assert.ok(after.ok && after.value.liveVersion === 1 && after.value.paused === false, 'healthy version left live');
});

test('AMP-145: a version that never passed (marked, failing twice) is still undone from a fresh instance', async () => {
  const store = await setup(true);
  await store.editDraft(A, SLUG, setHeading(BROKEN));
  // a dead run published version 2 and recorded nothing
  assert.equal((await store.publish(A, SLUG, { note: '[publish-check]' })).ok, true);
  const v = fresh(store);
  const r = await run({ versions: v, check: checkDeps(v) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'rolled_back');
});

test('AMP-145: if the store cannot record the pass, the in-memory fallback still protects it', async () => {
  const store = await setup(false);
  const flake = { on: false };
  const v = fresh(store, { markChecked: async () => ({ ok: false as const, code: 'failed' as const, errors: ['column missing'] }) });
  const d = { versions: v, check: checkDeps(v, flake) };
  assert.equal((await run(d)).ok, true);
  flake.on = true;
  const again = await run(d);
  assert.ok(!again.ok && again.outcome === 'unchanged_check_failed');
  const h = await store.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 1 && !h.value.paused);
});

test('AMP-145: a store refusal other than "failed" (or a throw) keeps the in-memory pass but is reported through onWarning', async () => {
  for (const mode of ['denied', 'not_found', 'invalid', 'conflict', 'throw'] as const) {
    const store = await setup(false);
    const flake = { on: false };
    const v = fresh(store, {
      markChecked: async () => {
        if (mode === 'throw') throw new Error('secret internal detail');
        return { ok: false as const, code: mode, errors: ['nope'] };
      },
    });
    const warnings: string[] = [];
    const d = { versions: v, check: checkDeps(v, flake), onWarning: (m: string) => { warnings.push(m); } };
    const first = await run(d);
    assert.equal(first.ok, true, `${mode}: outcome unchanged`);
    assert.equal(warnings.length, 1, `${mode}: one visible warning`);
    assert.ok(!warnings[0].includes('secret internal detail'), 'no raw error text');
    flake.on = true; // the in-memory pass still protects the healthy version
    const again = await run(d);
    assert.ok(!again.ok && again.outcome === 'unchanged_check_failed', `${mode}: pass kept in memory`);
  }
});

test('AMP-145: no markChecked, or a "failed" answer, falls back silently (no warning)', async () => {
  for (const over of [{ markChecked: undefined }, { markChecked: async () => ({ ok: false as const, code: 'failed' as const, errors: ['x'] }) }]) {
    const store = await setup(false);
    const v = fresh(store, over);
    const warnings: string[] = [];
    assert.equal((await run({ versions: v, check: checkDeps(v), onWarning: (m) => { warnings.push(m); } })).ok, true);
    assert.deepEqual(warnings, []);
  }
});

test('AMP-145: marking a non-live version is refused by the store, and a throwing onWarning does not change the outcome', async () => {
  const store = await setup(false);
  const v = fresh(store, { markChecked: async (actor, slug) => store.markChecked(actor, slug, 99) });
  const warnings: string[] = [];
  const r = await run({ versions: v, check: checkDeps(v), onWarning: (m) => { warnings.push(m); throw new Error('hook broke'); } });
  assert.equal(r.ok, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not_found/);
  // the real path (marks the live version it just published) still records the pass
  const store2 = await setup(false);
  const v2 = fresh(store2);
  assert.equal((await run({ versions: v2, check: checkDeps(v2) })).ok, true);
  const h = await store2.history(A, SLUG);
  assert.ok(h.ok && h.value.versions.find((x) => x.version === 1)?.checkedOk === true);
  // an old version cannot be marked: the store answers conflict
  await store2.editDraft(A, SLUG, setHeading('Two'));
  await store2.publish(A, SLUG);
  const old = await store2.markChecked(A, SLUG, 1);
  assert.ok(!old.ok && old.code === 'conflict');
});

test('AMP-145: rollback conflict: another process publishes after the last read, so nothing is undone', async () => {
  const store = await setup(true);
  await store.editDraft(A, SLUG, setHeading(BROKEN));
  const seen: Array<number | undefined> = [];
  const v = fresh(store, {
    rollback: async (actor, slug, to, o) => {
      seen.push(o?.expectedLive);
      // another process publishes a new version just before the rollback lands
      await store.editDraft(actor, slug, setHeading('Other process'));
      assert.equal((await store.publish(actor, slug)).ok, true);
      return store.rollback(actor, slug, to, o);
    },
  });
  const r = await run({ versions: v, check: checkDeps(v) });
  assert.deepEqual(seen, [2], 'rollback carried expectedLive = the version this run published');
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'rollback_failed'); assert.match(r.message, /another version went live/); }
  const h = await store.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 3 && h.value.versions.length === 3, 'the other process\'s version is untouched, no rollback copy');
});

test('AMP-145: pause conflict: another process publishes after the last read, so the store is not paused', async () => {
  const store = await setup(false);
  await store.editDraft(A, SLUG, setHeading(BROKEN));
  const seen: Array<number | undefined> = [];
  const v = fresh(store, {
    pause: async (actor, slug, o) => {
      seen.push(o?.expectedLive);
      await store.editDraft(actor, slug, setHeading('Other process'));
      assert.equal((await store.publish(actor, slug)).ok, true);
      return store.pause(actor, slug, o);
    },
  });
  const r = await run({ versions: v, check: checkDeps(v) });
  assert.deepEqual(seen, [1]);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'rollback_failed'); assert.match(r.message, /another version went live/); }
  const h = await store.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 2 && h.value.paused === false);
  assert.equal((await store.resolvePublished(SLUG)).status, 'live');
});
