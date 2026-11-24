// AMP-101 (D03): publish check second fixes. Real site-versions store; failures injected through thin wrappers. No network, no real sleeps.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteVersionStore, demoActorA, type SiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';
import {
  PUBLISH_MARK, createPageLoader, publishWithCheck,
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
const heading = async (v: SiteVersionStore) => { const r = await v.resolvePublished(SLUG); return r.status === 'live' ? r.config.hero.heading : r.status; };

/** Check deps whose home page fails while `flake.on` is true or the heading is BROKEN. */
function checkDeps(versions: PublishSiteApi, flake: { on: boolean; calls?: number } = { on: false }, over: Partial<PublishCheckDeps> = {}): PublishCheckDeps {
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  return {
    resolveLive: (slug) => versions.resolvePublished(slug),
    loadPage: async (slug, ref) => {
      const r = await versions.resolvePublished(slug);
      const broken = r.status === 'live' && r.config.hero.heading === BROKEN;
      if (ref.page === 'home') { flake.calls = (flake.calls ?? 0) + 1; if (flake.on || broken) return { ok: false, reason: 'it threw while rendering.' }; }
      return base(slug, ref);
    },
    checkout: { canStart: async () => ({ ok: true }) },
    checkoutAvailable: true,
    ...over,
  };
}
const run = (d: PublishWithCheckDeps) => publishWithCheck(d, { actor: A, businessId: BIZ, storeSlug: SLUG });
const wrap = (v: SiteVersionStore, over: Partial<PublishSiteApi>): PublishSiteApi => ({
  publish: v.publish.bind(v), rollback: v.rollback.bind(v), pause: v.pause.bind(v), history: v.history.bind(v),
  resolvePublished: v.resolvePublished.bind(v), getVersion: v.getVersion.bind(v), ...over,
});

// 1. a version that passed is never undone by a later passing failure
test('AMP-101 #1: a FIRST version that passed is not paused when a later check of the unchanged draft flakes', async () => {
  const versions = await setup(false);
  const flake = { on: false };
  const d = { versions, check: checkDeps(versions, flake) };
  const first = await run(d);
  assert.equal(first.ok, true);
  flake.on = true; // provider outage / page-load flake
  const again = await run(d);
  assert.equal(again.ok, false);
  if (!again.ok) { assert.equal(again.outcome, 'unchanged_check_failed'); assert.equal(again.version, 1); }
  const h = await versions.history(A, SLUG);
  assert.ok(h.ok && h.value.paused === false && h.value.liveVersion === 1, 'still live, not paused');
  assert.equal((await versions.resolvePublished(SLUG)).status, 'live');
});

test('AMP-101 #1: a LATER version that passed is not rolled back when a later check of the unchanged draft flakes', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Second'));
  const flake = { on: false };
  const d = { versions, check: checkDeps(versions, flake) };
  const first = await run(d);
  assert.equal(first.ok, true);
  flake.on = true;
  const again = await run(d);
  assert.equal(again.ok, false);
  if (!again.ok) { assert.equal(again.outcome, 'unchanged_check_failed'); assert.equal(again.version, 2); }
  assert.equal(await heading(versions), 'Second');
  const h = await versions.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 2 && h.value.versions.length === 2, 'no rollback copy was created');
});

test('AMP-101 #1: an unfinished version (crash before the undo) that passes the confirming re-run is kept, not undone', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Second'));
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true); // the dead run's version 2
  const flake = { on: true, calls: 0 };
  const check = checkDeps(versions, flake);
  const inner = check.loadPage;
  let homeCalls = 0;
  check.loadPage = async (s, ref) => { if (ref.page === 'home') { homeCalls++; if (homeCalls > 1) return { ok: true }; } return inner(s, ref); }; // fails once, then recovers
  const r = await run({ versions, check });
  assert.equal(r.ok, true);
  assert.equal(await heading(versions), 'Second');
  assert.equal(homeCalls, 2, 'the check ran again to confirm');
});

test('AMP-101 #1: an unfinished version that fails the confirming re-run too is still undone', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true);
  const flake = { on: false, calls: 0 };
  const r = await run({ versions, check: checkDeps(versions, flake) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'rolled_back');
  assert.ok((flake.calls ?? 0) >= 2, 'the check ran again to confirm before undoing');
});

// 2. a probe that never settles cannot block the store forever
test('AMP-101 #2: a never-settling probe times out with a recorded result and the next publish of the store runs', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Stuck'));
  const never = checkDeps(versions, { on: false }, { checkout: { canStart: async () => ({ ok: true }), checkStore: () => new Promise(() => undefined) } });
  const t0 = Date.now();
  const r1 = await run({ versions, check: never, queueTimeoutMs: 40 });
  assert.equal(r1.ok, false);
  if (!r1.ok) { assert.equal(r1.outcome, 'timed_out'); assert.match(r1.message, /may or may not have changed/); }
  await versions.editDraft(A, SLUG, setHeading('After the stuck one'));
  const r2 = await run({ versions, check: checkDeps(versions), queueTimeoutMs: 1000 });
  assert.equal(r2.ok, true);
  assert.equal(await heading(versions), 'After the stuck one');
  assert.ok(Date.now() - t0 < 2000, 'no real long wait');
});

test('AMP-101 #2: a publish queued behind a stuck one starts once the stuck one has timed out', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Stuck'));
  const stuck = checkDeps(versions, { on: false }, { loadPage: () => new Promise(() => undefined) });
  const p1 = run({ versions, check: stuck, queueTimeoutMs: 40 });
  const p2 = run({ versions, check: checkDeps(versions), queueTimeoutMs: 1000 }); // queued behind p1; draft is unchanged
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.outcome, 'timed_out');
  assert.equal(r2.ok, true);
});

// 3. rollback target comes from history
// Note: in the real store the history-based target and `version - 1` coincide; the wrapped-history test below is the one that proves the history read.
test('AMP-101 #3: with a rollback copy in between, the undo goes back to the rollback copy that was live, and the content matches (smoke; the wrapped-history test is the proof)', async () => {
  const versions = await setup(); // v1 "original"
  const original = await heading(versions);
  await versions.editDraft(A, SLUG, setHeading('Second'));
  assert.equal((await versions.publish(A, SLUG)).ok, true); // v2
  assert.equal((await versions.rollback(A, SLUG, 1)).ok, true); // v3 = copy of v1, live
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true); // v4, crashed before undo
  const r = await run({ versions, check: checkDeps(versions) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.rolledBackTo, 3, 'the rollback copy was live, so that is what comes back');
  assert.equal(await heading(versions), original);
});

test('AMP-101 #3: the target is read from history events, not computed as version - 1', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading('Second'));
  assert.equal((await versions.publish(A, SLUG)).ok, true); // v2
  await versions.editDraft(A, SLUG, setHeading('Third'));
  assert.equal((await versions.publish(A, SLUG)).ok, true); // v3
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true); // v4
  // History says v2 (not v3) was live right before v4: drop the v3 go-live event.
  const api = wrap(versions, {
    history: async (...a) => {
      const h = await versions.history(...a);
      return h.ok ? { ok: true, value: { ...h.value, events: h.value.events.filter((e) => e.version !== 3) } } as typeof h : h;
    },
  });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.rolledBackTo, 2);
  assert.equal(await heading(versions), 'Second');
});

// 4. an abandoned (timed out) run never touches the store again
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };
const gateOf = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
/** Versions wrapper that records every store-changing call. */
function logged(v: SiteVersionStore, over: Partial<PublishSiteApi> = {}) {
  const calls: string[] = [];
  const api = wrap(v, {
    publish: async (...a) => { calls.push('publish'); return v.publish(...a); },
    rollback: async (...a) => { calls.push('rollback'); return v.rollback(...a); },
    pause: async (...a) => { calls.push('pause'); return v.pause(...a); },
    ...over,
  });
  return { api, calls };
}

test('AMP-101 fix #4a: a check that fails only after the timeout and a second live publish does not undo anything', async () => {
  const versions = await setup(); // v1
  await versions.editDraft(A, SLUG, setHeading('Stuck'));
  const gate = gateOf();
  const { api, calls } = logged(versions);
  const slow = checkDeps(api);
  const inner = slow.loadPage;
  let held = false;
  slow.loadPage = async (s, ref) => { if (!held && ref.page === 'home') { held = true; await gate.p; return { ok: false, reason: 'it threw while rendering.' }; } return inner(s, ref); };
  const r1 = await run({ versions: api, check: slow, queueTimeoutMs: 40 });
  assert.equal(r1.ok, false);
  if (!r1.ok) { assert.equal(r1.outcome, 'timed_out'); assert.equal(r1.version, 2, 'the timeout result names the version that went live'); }
  await versions.editDraft(A, SLUG, setHeading('Second'));
  const r2 = await run({ versions, check: checkDeps(versions), queueTimeoutMs: 1000 });
  assert.equal(r2.ok, true);
  const before = calls.length;
  gate.open(); // the abandoned run's check now resolves as FAILED
  await flush();
  assert.equal(calls.length, before, 'no publish, rollback or pause after the timeout');
  assert.equal(calls.includes('rollback') || calls.includes('pause'), false);
  assert.equal(await heading(versions), 'Second');
  const h = await versions.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 3 && h.value.versions.length === 3);
});

test('AMP-101 fix #4b: the timeout fires during the getVersion read before a rollback: no rollback happens afterwards', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const gate = gateOf();
  const reached = gateOf();
  const { api, calls } = logged(versions, { getVersion: async (...a) => { reached.open(); await gate.p; return versions.getVersion(...a); } });
  const p1 = run({ versions: api, check: checkDeps(api), queueTimeoutMs: 60 });
  await reached.p; // the run is inside getVersion, about to roll back
  const r1 = await p1;
  assert.equal(r1.ok, false);
  if (!r1.ok) { assert.equal(r1.outcome, 'timed_out'); assert.equal(r1.version, 2); }
  await versions.editDraft(A, SLUG, setHeading('Second'));
  const r2 = await run({ versions, check: checkDeps(versions), queueTimeoutMs: 1000 });
  assert.equal(r2.ok, true);
  gate.open();
  await flush();
  assert.equal(calls.includes('rollback'), false, 'the abandoned run did not roll back');
  assert.equal(calls.includes('pause'), false);
  assert.equal(await heading(versions), 'Second');
});

test('AMP-101 fix #4c: the timeout fires while publish is in flight: no check runs and nothing is undone afterwards', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const gate = gateOf();
  const reached = gateOf();
  const { api, calls } = logged(versions, { publish: async (...a) => { reached.open(); await gate.p; return versions.publish(...a); } });
  const flake = { on: false, calls: 0 };
  const p1 = run({ versions: api, check: checkDeps(api, flake), queueTimeoutMs: 40 });
  await reached.p;
  const r1 = await p1;
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.outcome, 'timed_out');
  gate.open(); // publish lands after the caller was told it timed out
  await flush();
  assert.equal(flake.calls, 0, 'the check was not started for an abandoned run');
  assert.equal(calls.includes('rollback') || calls.includes('pause'), false);
  const h = await versions.history(A, SLUG);
  assert.ok(h.ok && h.value.liveVersion === 2 && h.value.paused === false, 'the published version was left alone; the result told the owner to look');
});
