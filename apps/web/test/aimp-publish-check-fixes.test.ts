// AMP-098 (D03): publish check fixes. Real site-versions store; failures injected through thin wrappers. No network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteVersionStore, demoActorA, type SiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';
import {
  PUBLISH_MARK, createPageLoader, publishWithCheck, runPublishCheck,
  type PublishCheckDeps, type PublishSiteApi, type PublishWithCheckDeps,
} from '../lib/aimp/publish-check/index.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const BIZ = 'biz-a';
const BROKEN = 'This page is broken';
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };
const sellable: StoreConfig = { ...structuredClone(demoStore), demo: false, merchant: { chargesEnabled: true } };

async function setup(opts: { publishFirst?: boolean; config?: StoreConfig } = {}) {
  const versions = createSiteVersionStore();
  assert.equal((await versions.createSite(A, opts.config ?? demoStore)).ok, true);
  if (opts.publishFirst !== false) assert.equal((await versions.publish(A, SLUG)).ok, true);
  return versions;
}
const heading = async (v: SiteVersionStore) => { const r = await v.resolvePublished(SLUG); return r.status === 'live' ? r.config.hero.heading : r.status; };

function checkDeps(versions: PublishSiteApi, over: Partial<PublishCheckDeps> = {}): PublishCheckDeps {
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  return {
    resolveLive: (slug) => versions.resolvePublished(slug),
    loadPage: async (slug, ref) => {
      const r = await versions.resolvePublished(slug);
      if (r.status === 'live' && r.config.hero.heading === BROKEN && ref.page === 'home') return { ok: false, reason: 'it threw while rendering.' };
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

// 1. crash between a failed check and its rollback
test('AMP-098 #1: a retry after a crash before the rollback still rolls the broken version back', async () => {
  const versions = await setup();
  const original = await heading(versions);
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  // The dead run published version 2 (marked as ours), saw it fail, and crashed before undoing it.
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true);
  assert.equal(await heading(versions), BROKEN);
  const r = await run({ versions, check: checkDeps(versions) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.rolledBackTo, 1);
  assert.equal(await heading(versions), original, 'the broken version is no longer live');
});

test('AMP-098 #1: a retry after a crash on a FIRST publish pauses the store instead of leaving it live', async () => {
  const versions = await setup({ publishFirst: false });
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  assert.equal((await versions.publish(A, SLUG, { note: PUBLISH_MARK })).ok, true);
  const r = await run({ versions, check: checkDeps(versions) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'unpublished');
  assert.equal(await heading(versions), 'paused');
});

test('AMP-098 #1: a broken live version that was NOT published by the check is still left alone', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  await versions.publish(A, SLUG, { note: 'by hand' });
  const r = await run({ versions, check: checkDeps(versions) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.outcome, 'unchanged_check_failed');
  assert.equal(await heading(versions), BROKEN);
});

// 2. one publish per store at a time, and the rollback refuses when something else is live
test('AMP-098 #2: two overlapping publishes of one store run one after the other and the rollback cannot wipe the second', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  let entered!: () => void;
  const inCheck = new Promise<void>((res) => { entered = res; });
  const slow = checkDeps(versions);
  const inner = slow.loadPage;
  let first = true;
  slow.loadPage = async (s, ref) => { if (first) { first = false; entered(); await gate; } return inner(s, ref); };
  const p1 = run({ versions, check: slow });
  await inCheck; // publish 1 is live (broken) and being checked
  await versions.editDraft(A, SLUG, setHeading('Second publish'));
  const p2 = run({ versions, check: checkDeps(versions) }); // must wait for publish 1 to finish
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.outcome, 'rolled_back');
  assert.equal(r2.ok, true);
  assert.equal(await heading(versions), 'Second publish');
});

test('AMP-098 #2: if another version went live during the check, the rollback refuses and says so', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const base = checkDeps(versions);
  const inner = base.loadPage;
  let once = true;
  // A publish that bypasses this module (another process) lands while the check runs.
  base.loadPage = async (s, ref) => {
    if (once && ref.page === 'home') { once = false; await versions.editDraft(A, SLUG, setHeading('Someone else')); await versions.publish(A, SLUG); return { ok: false, reason: 'it threw while rendering.' }; }
    return inner(s, ref);
  };
  const r = await run({ versions, check: base });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rollback_failed');
  assert.match(r.message, /another version went live/);
  assert.equal(await heading(versions), 'Someone else', 'the newer version was not touched');
});

// 3. throwing rollback, pause and resolve
test('AMP-098 #3: a rollback that throws is a recorded rollback_failed, not a throw, with no raw error text', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const api = wrap(versions, { rollback: async () => { throw new Error('db password=hunter2'); } });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rollback_failed');
  assert.match(r.message, /may still be live/);
  assert.equal(JSON.stringify(r).includes('hunter2'), false);
  assert.ok((r.rollbackErrors ?? []).length > 0);
});

test('AMP-098 #3: a pause that throws on a first publish is a recorded rollback_failed', async () => {
  const versions = await setup({ publishFirst: false });
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const api = wrap(versions, { pause: async () => { throw new Error('boom'); } });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'rollback_failed'); assert.match(r.message, /may still be live/); }
});

test('AMP-098 #3: a resolve that throws after the rollback is a recorded rollback_failed', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  let rolled = false;
  const api = wrap(versions, {
    rollback: async (...a) => { const r = await versions.rollback(...a); rolled = true; return r; },
    resolvePublished: async (s) => { if (rolled) throw new Error('cache down'); return versions.resolvePublished(s); },
  });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'rollback_failed'); assert.match(r.message, /may still be live/); }
});

test('AMP-098 #3: a history that throws before publishing changes nothing and is retryable', async () => {
  const versions = await setup();
  const api = wrap(versions, { history: async () => { throw new Error('down'); } });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.outcome, 'not_published'); assert.equal(r.retryable, true); }
});

// 4. served content equals the previous version
test('AMP-098 #4: after a rollback the served content must equal the previous version, not only be live', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const api = wrap(versions, {
    resolvePublished: async (s) => {
      const r = await versions.resolvePublished(s);
      // Once the rollback copy is live, serve other content under it (status still "live", right version number).
      return r.status === 'live' && r.version === 3 ? { ...r, config: { ...r.config, hero: { ...r.config.hero, heading: 'Tampered' } } } : r;
    },
  });
  const r = await run({ versions: api, check: checkDeps(api) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.outcome, 'rollback_failed');
  assert.match((r.rollbackErrors ?? []).join(' '), /not the same as version 1/);
});

// 5 / 7. checkout probe and business check
test('AMP-098 #5: checkout built and the probe fails -> failed; no probe connected -> failed, never passed', async () => {
  const versions = await setup({ config: sellable });
  const d = checkDeps(versions);
  const base = { workspaceId: A.workspaceId, businessId: BIZ, storeSlug: SLUG, versionId: 1 };
  const noProbe = await runPublishCheck({ ...d, checkout: undefined as never }, base);
  assert.equal(noProbe.ok, false);
  if (!noProbe.ok) assert.ok(noProbe.failed.some((f) => f.check === 'checkout'));
  const failing = await runPublishCheck({ ...d, checkout: { canStart: async () => ({ ok: false, reason: 'nope.' }) } }, base);
  assert.equal(failing.ok, false);
});

test('AMP-098 #5: a skipped checkout is reported as skipped and never as a passed checkout check', async () => {
  const versions = await setup(); // demo store: checkout not tested
  const r = await runPublishCheck(checkDeps(versions), { workspaceId: A.workspaceId, businessId: BIZ, storeSlug: SLUG, versionId: 1 });
  assert.equal(r.ok, true);
  assert.ok(r.skipped.some((s) => s.check === 'checkout'));
  assert.equal(r.checks.some((c) => c.check.startsWith('checkout')), false);
});

test('AMP-098 #7: the business is checked even when the checkout probe is skipped', async () => {
  const versions = await setup(); // demo store: checkout skipped
  const seen: string[] = [];
  const d = checkDeps(versions, { checkout: { canStart: async () => ({ ok: true }), checkStore: async (i) => { seen.push(`${i.workspaceId}/${i.businessId}/${i.storeSlug}`); return i.businessId === BIZ ? { ok: true } : { ok: false, reason: 'the store address belongs to a different business.' }; } } });
  const base = { workspaceId: A.workspaceId, storeSlug: SLUG, versionId: 1 };
  const good = await runPublishCheck(d, { ...base, businessId: BIZ });
  assert.equal(good.ok, true);
  assert.ok(good.checks.some((c) => c.check === 'business'));
  assert.ok(good.skipped.some((s) => s.check === 'checkout'));
  const bad = await runPublishCheck(d, { ...base, businessId: 'biz-b' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.failed.some((f) => f.check === 'business'));
  assert.equal(seen.length, 2);
});

test('AMP-098 #7: a probe without a store check reports the business as skipped, not passed', async () => {
  const versions = await setup();
  const r = await runPublishCheck(checkDeps(versions), { workspaceId: A.workspaceId, businessId: BIZ, storeSlug: SLUG, versionId: 1 });
  assert.ok(r.skipped.some((s) => s.check === 'business'));
  assert.equal(r.checks.some((c) => c.check === 'business'), false);
});

// 6. retryable failures
test('AMP-098 #6: a conflict or "try again" from the store is retryable, a refusal is not', async () => {
  const versions = await setup();
  const conflict = wrap(versions, { publish: async () => ({ ok: false, code: 'conflict', errors: ['The store changed while publishing. Try again.'] }) });
  const r1 = await run({ versions: conflict, check: checkDeps(conflict) });
  assert.equal(r1.ok, false);
  if (!r1.ok) { assert.equal(r1.outcome, 'not_published'); assert.equal(r1.retryable, true); }
  const failedCode = wrap(versions, { publish: async () => ({ ok: false, code: 'failed', errors: ['Please try again.'] }) });
  const r2 = await run({ versions: failedCode, check: checkDeps(failedCode) });
  if (!r2.ok) assert.equal(r2.retryable, true);
  const denied = wrap(versions, { publish: async () => ({ ok: false, code: 'denied', errors: ['No access.'] }) });
  const r3 = await run({ versions: denied, check: checkDeps(denied) });
  if (!r3.ok) assert.equal(r3.retryable, false);
});

test('AMP-098 #6: a failed publish keeps the structured failed and checks lists', async () => {
  const versions = await setup();
  await versions.editDraft(A, SLUG, setHeading(BROKEN));
  const r = await run({ versions, check: checkDeps(versions) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failed[0].check, 'page:home');
  assert.ok(r.checks.some((c) => c.check === 'live-version'));
  assert.ok(Array.isArray(r.skipped));
  assert.equal(r.retryable, false);
});
