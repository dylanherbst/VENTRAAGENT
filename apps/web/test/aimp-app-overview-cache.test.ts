// AMP-108: review fixes for the Business Overview cache. (1) the shared cache is keyed by runtime AND workspace context, (2) the store
// status, business name and numbers come from one pass, (3) a source that stays down is backed off (injected clock), (4) one
// workspace + business can be invalidated, (5) every record is bounded.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createApprovalsHealth, createRuntimeOverviewDeps, createSourceBackoff, invalidateSharedOverview, loadBusinessOverview, loadCachedBusinessOverview,
  OVERVIEW_BACKOFF_BASE_MS, OVERVIEW_BACKOFF_MAX_MS, OVERVIEW_MAX_WORKSPACE_CACHES, OVERVIEW_REFRESH_AFTER_MS, sharedOverviewCache, SourceBackoffError,
} from '../app/app/[business]/_server/overview.ts';
import type { OverviewContexts, OverviewRuntime } from '../app/app/[business]/_server/overview.ts';

const ctxFor = (ws: string): OverviewContexts => ({
  workspaceId: ws,
  productCtx: { workspaceId: ws, actorId: 'owner' },
  brandCtx: { workspaceId: ws },
  siteActor: { workspaceId: ws, userId: 'owner' },
  catalogueCtx: (businessId) => ({ workspaceId: ws, businessId, actorUserId: 'owner', idempotencyKey: `start:${businessId}` }),
});

const clock = (startIso: string) => {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by: number) => { ms += by; } };
};

/** One runtime that serves several workspaces: the brand name and the listing depend on the workspace the caller asks as. */
function fakeRuntime() {
  const state = { failCatalogue: false, catalogueReads: 0, siteStatus: 'live' as 'live' | 'paused', names: { 'ws-a': 'Alpha Studio', 'ws-b': 'Beta Studio' } as Record<string, string> };
  const rt: OverviewRuntime = {
    products: { listVersions: async () => [{ id: 'v1', status: 'approved' }] as never },
    brands: { kind: 'memory', list: async (ws: string, biz: string) => (biz === 'biz-1' && state.names[ws] ? ([{ status: 'approved', name: state.names[ws], businessId: biz }] as never) : []) } as never,
    catalogue: { listApprovedForBusiness: async (c) => {
      state.catalogueReads += 1;
      if (state.failCatalogue) throw new Error('catalogue is down');
      return (c.workspaceId === 'ws-a' ? [{ id: 'l1' }] : []) as never;
    } },
    sites: { resolvePublished: async () => (state.siteStatus === 'live'
      ? { status: 'live', version: 1, publishedAt: '2026-11-14T09:00:00.000Z', config: {} as never }
      : { status: 'paused', version: 1, config: {} as never }) as never },
    seeds: { has: (b) => b === 'biz-1' },
    productIds: { get: (b) => (b === 'biz-1' ? ['p1'] : undefined) },
    slugs: { get: (b) => (b === 'biz-1' ? 's1' : undefined) },
    businesses: { has: (b) => b === 'biz-1' },
  };
  return { rt, state };
}

// --- acceptance 1: two workspaces on one runtime ---

test('a different workspace on the same runtime never gets the first workspace\'s cache, name or numbers', async () => {
  const { rt } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const b = ctxFor('ws-b');
  const cacheA = sharedOverviewCache(rt, a, {}, c.now);
  const cacheB = sharedOverviewCache(rt, b, {}, c.now);
  assert.notEqual(cacheA, cacheB);
  assert.equal(sharedOverviewCache(rt, a, {}, c.now), cacheA); // the same workspace still shares one
  assert.equal(sharedOverviewCache(rt, b, {}, c.now), cacheB);

  const first = await loadCachedBusinessOverview(cacheA, rt, a, 'biz-1');
  const second = await loadCachedBusinessOverview(cacheB, rt, b, 'biz-1');
  assert.ok(first.found && second.found);
  if (!first.found || !second.found) return;
  assert.equal(first.businessName, 'Alpha Studio');
  assert.equal(second.businessName, 'Beta Studio');
  assert.equal(first.overview.workspaceId, 'ws-a');
  assert.equal(second.overview.workspaceId, 'ws-b');
  assert.equal(first.overview.launchProgress.done > second.overview.launchProgress.done, true); // ws-a has the listing, ws-b does not
  // Served again from each cache: still each its own.
  const again = await loadCachedBusinessOverview(cacheB, rt, b, 'biz-1');
  assert.ok(again.found);
  if (again.found) { assert.equal(again.overview.workspaceId, 'ws-b'); assert.equal(again.businessName, 'Beta Studio'); }
});

test('the workspace caches are bounded per runtime', () => {
  const { rt } = fakeRuntime();
  const first = sharedOverviewCache(rt, ctxFor('ws-0'), {});
  for (let i = 1; i <= OVERVIEW_MAX_WORKSPACE_CACHES; i += 1) sharedOverviewCache(rt, ctxFor(`ws-${i}`), {});
  assert.notEqual(sharedOverviewCache(rt, ctxFor('ws-0'), {}), first); // the oldest was dropped, so it is rebuilt, never grown without end
});

// --- acceptance 2: one pass for the store status, the name and the numbers ---

test('store status, business name and numbers come from the same read, so they never disagree', async () => {
  const { rt, state } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const cache = sharedOverviewCache(rt, a, {}, c.now);
  const first = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  assert.ok(first.found);
  if (!first.found) return;
  assert.equal(first.storeStatus, 'live');
  assert.equal(first.overview.flags.storePublished, true);

  // The store is paused and the brand renamed inside the refresh window: the page still shows the one pass it holds, all together.
  state.siteStatus = 'paused';
  state.names['ws-a'] = 'Renamed';
  c.advance(1_000);
  const within = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  assert.ok(within.found);
  if (!within.found) return;
  assert.equal(within.storeStatus, 'live');
  assert.equal(within.overview.flags.storePublished, true);
  assert.equal(within.businessName, 'Alpha Studio');

  // After the window, the next read brings the status, the name and the numbers up together.
  c.advance(OVERVIEW_REFRESH_AFTER_MS);
  const after = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  assert.ok(after.found);
  if (!after.found) return;
  assert.equal(after.storeStatus, 'paused');
  assert.equal(after.overview.flags.storePublished, false);
  assert.equal(after.businessName, 'Renamed');
});

test('when a re-read fails the older name and store status stay with the older numbers', async () => {
  const { rt, state } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const cache = sharedOverviewCache(rt, a, {}, c.now);
  await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  state.siteStatus = 'paused';
  state.names['ws-a'] = 'Renamed';
  state.failCatalogue = true;
  c.advance(OVERVIEW_REFRESH_AFTER_MS + 1);
  const failed = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  assert.ok(failed.found);
  if (!failed.found) return;
  assert.equal(failed.freshness?.refreshFailed, true);
  assert.equal(failed.storeStatus, 'live'); // belongs to the older numbers being shown
  assert.equal(failed.businessName, 'Alpha Studio');
  assert.equal(failed.overview.flags.storePublished, true);
});

test('the uncached read takes the name and status from its own pass and does not read the site a second time', async () => {
  const { rt } = fakeRuntime();
  let siteReads = 0;
  const counting: OverviewRuntime = { ...rt, sites: { resolvePublished: async (slug) => { siteReads += 1; return rt.sites.resolvePublished(slug); } } };
  const o = await loadBusinessOverview(counting, ctxFor('ws-a'), {}, 'biz-1', () => new Date('2026-11-14T10:00:00.000Z'));
  assert.ok(o.found);
  if (!o.found) return;
  assert.equal(o.businessName, 'Alpha Studio');
  assert.equal(o.storeStatus, 'live');
  assert.equal(siteReads, 1);
});

// --- acceptance 3: back-off while a source is down (injected clock) ---

test('back-off: waits 5s, 10s, 20s, 40s, then 60s at most; a skipped read is not another failure; the first success clears it', async () => {
  const c = clock('2026-11-14T10:00:00.000Z');
  const backoff = createSourceBackoff(c.now);
  const scope = { workspaceId: 'ws-a', businessId: 'biz-1' };
  let reads = 0;
  let down = true;
  const read = async () => { reads += 1; if (down) throw new Error('down'); return 'ok'; };
  await assert.rejects(backoff.guard('orders', scope, read), (e: unknown) => !(e instanceof SourceBackoffError)); // really read, really failed
  for (let i = 0; i < 5; i += 1) await assert.rejects(backoff.guard('orders', scope, read), SourceBackoffError); // refused, not read, not a new failure
  assert.equal(reads, 1);
  c.advance(OVERVIEW_BACKOFF_BASE_MS); // a refusal never lengthened the wait: it is still the base wait
  await assert.rejects(backoff.guard('orders', scope, read), (e: unknown) => !(e instanceof SourceBackoffError));
  assert.equal(reads, 2);
  down = false;
  c.advance(2 * OVERVIEW_BACKOFF_BASE_MS);
  assert.equal(await backoff.guard('orders', scope, read), 'ok');
});

test('back-off doubles up to the named maximum and the first success resets it', async () => {
  const c = clock('2026-11-14T10:00:00.000Z');
  const backoff = createSourceBackoff(c.now);
  const scope = { workspaceId: 'ws-a', businessId: 'biz-1' };
  let reads = 0;
  let down = true;
  const read = async () => { reads += 1; if (down) throw new Error('down'); return 'ok'; };
  const expected = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
  for (const wait of expected) {
    await assert.rejects(backoff.guard('seller', scope, read), (e: unknown) => !(e instanceof SourceBackoffError));
    const before = reads;
    c.advance(wait - 1);
    await assert.rejects(backoff.guard('seller', scope, read), SourceBackoffError); // one millisecond early: not read
    assert.equal(reads, before);
    c.advance(1); // the wait is over: the next call really reads (and fails again, doubling)
  }
  assert.equal(expected[expected.length - 1], OVERVIEW_BACKOFF_MAX_MS);
  down = false;
  assert.equal(await backoff.guard('seller', scope, read), 'ok');
  assert.equal(backoff.size(), 0);
  down = true;
  await assert.rejects(backoff.guard('seller', scope, read)); // a new failure starts again at the base wait
  const before = reads;
  c.advance(OVERVIEW_BACKOFF_BASE_MS);
  await assert.rejects(backoff.guard('seller', scope, read), (e: unknown) => !(e instanceof SourceBackoffError));
  assert.equal(reads, before + 1);
});

test('back-off is per source and per workspace + business: one down source or business does not hold back another', async () => {
  const c = clock('2026-11-14T10:00:00.000Z');
  const backoff = createSourceBackoff(c.now);
  const a = { workspaceId: 'ws-a', businessId: 'biz-1' };
  const b = { workspaceId: 'ws-b', businessId: 'biz-1' };
  await assert.rejects(backoff.guard('orders', a, async () => { throw new Error('down'); }));
  assert.equal(await backoff.guard('orders', b, async () => 'fine'), 'fine');
  assert.equal(await backoff.guard('seller', a, async () => 'fine'), 'fine');
  await assert.rejects(backoff.guard('orders', a, async () => 'never read'), SourceBackoffError);
});

test('back-off records are bounded', async () => {
  const c = clock('2026-11-14T10:00:00.000Z');
  const backoff = createSourceBackoff(c.now, { maxEntries: 3 });
  for (let i = 0; i < 10; i += 1) await assert.rejects(backoff.guard('orders', { workspaceId: 'ws-a', businessId: `biz-${i}` }, async () => { throw new Error('down'); }));
  assert.equal(backoff.size(), 3);
});

test('a source that stays down is not read on every request; the page keeps saying so and shows the real age', async () => {
  const { rt, state } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const cache = sharedOverviewCache(rt, a, {}, c.now);
  const load = async () => {
    const r = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
    assert.ok(r.found && r.freshness);
    if (!r.found || !r.freshness) throw new Error('not found');
    return { ...r, freshness: r.freshness };
  };
  await load();
  state.failCatalogue = true;
  const readsBefore = state.catalogueReads;

  c.advance(OVERVIEW_REFRESH_AFTER_MS + 1); // the saved copy has expired: one real try, which fails
  let r = await load();
  assert.equal(state.catalogueReads, readsBefore + 1);
  assert.equal(r.freshness.refreshFailed, true);

  // Many requests inside the wait: the source is not read again, and the page still says it could not be read, with the real age.
  for (let i = 0; i < 4; i += 1) {
    c.advance(1_000);
    r = await load();
    assert.equal(state.catalogueReads, readsBefore + 1);
    assert.equal(r.freshness.refreshFailed, true);
    assert.equal(r.freshness.refreshedAt, '2026-11-14T10:00:00.000Z');
    assert.equal(r.freshness.ageMs, OVERVIEW_REFRESH_AFTER_MS + 1 + (i + 1) * 1_000);
  }

  // The wait is over: one more real try (and the wait doubles); then it comes back and the first success clears the warning.
  c.advance(OVERVIEW_BACKOFF_BASE_MS);
  r = await load();
  assert.equal(state.catalogueReads, readsBefore + 2);
  assert.equal(r.freshness.refreshFailed, true);
  state.failCatalogue = false;
  c.advance(OVERVIEW_BACKOFF_BASE_MS); // still inside the doubled (10s) wait
  r = await load();
  assert.equal(state.catalogueReads, readsBefore + 2);
  assert.equal(r.freshness.refreshFailed, true);
  c.advance(OVERVIEW_BACKOFF_BASE_MS);
  r = await load();
  assert.equal(state.catalogueReads, readsBefore + 3);
  assert.equal(r.freshness.refreshFailed, false);
  assert.equal(r.freshness.ageMs, 0);
});

test('a down approvals source is not read inside its wait, and approvals still read as unknown, never as none', async () => {
  const { rt } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  let reads = 0;
  const extras = { approvals: async () => { reads += 1; throw new Error('automation is down'); } };
  const health = createApprovalsHealth();
  const deps = createRuntimeOverviewDeps(rt, ctxFor('ws-a'), extras, c.now, health, createSourceBackoff(c.now));
  const scope = { workspaceId: 'ws-a', businessId: 'biz-1' };
  const quiet = console.error; console.error = () => {};
  try {
    assert.deepEqual(await deps.automation.approvals(scope), []);
    assert.equal(health.failed.has('ws-a/biz-1'), true);
    c.advance(1_000);
    assert.deepEqual(await deps.automation.approvals(scope), []);
    assert.equal(reads, 1);
    assert.equal(health.failed.has('ws-a/biz-1'), true);
    c.advance(OVERVIEW_BACKOFF_BASE_MS);
    await deps.automation.approvals(scope);
    assert.equal(reads, 2);
  } finally { console.error = quiet; }
});

// --- acceptance 4: invalidate one workspace + business ---

test('invalidating one workspace + business drops only that saved copy', async () => {
  const { rt, state } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const b = ctxFor('ws-b');
  const cacheA = sharedOverviewCache(rt, a, {}, c.now);
  const cacheB = sharedOverviewCache(rt, b, {}, c.now);
  await loadCachedBusinessOverview(cacheA, rt, a, 'biz-1');
  await loadCachedBusinessOverview(cacheB, rt, b, 'biz-1');
  assert.equal(cacheA.size(), 1);
  assert.equal(cacheB.size(), 1);

  state.siteStatus = 'paused';
  state.names['ws-a'] = 'Renamed A';
  state.names['ws-b'] = 'Renamed B';
  c.advance(1_000); // inside the refresh window: both would normally still serve the saved copy
  invalidateSharedOverview(rt, 'ws-a', 'biz-1');
  assert.equal(cacheA.size(), 0);
  assert.equal(cacheB.size(), 1);

  const freshA = await loadCachedBusinessOverview(cacheA, rt, a, 'biz-1');
  const savedB = await loadCachedBusinessOverview(cacheB, rt, b, 'biz-1');
  assert.ok(freshA.found && savedB.found);
  if (!freshA.found || !savedB.found) return;
  assert.equal(freshA.businessName, 'Renamed A');
  assert.equal(freshA.storeStatus, 'paused');
  assert.equal(freshA.freshness?.ageMs, 0);
  assert.equal(savedB.businessName, 'Beta Studio'); // the other workspace kept its saved copy
  assert.equal(savedB.storeStatus, 'live');
});

test('invalidate never throws: an unknown runtime, workspace, business or a bad id is a quiet no-op', () => {
  const { rt } = fakeRuntime();
  assert.doesNotThrow(() => invalidateSharedOverview(rt, 'ws-nobody', 'biz-1'));
  sharedOverviewCache(rt, ctxFor('ws-a'), {});
  assert.doesNotThrow(() => invalidateSharedOverview(rt, 'ws-a', 'not a plain id!'));
  assert.doesNotThrow(() => invalidateSharedOverview(rt, 'ws-a', 'biz-never'));
});

// --- AMP-161: small races and context checks ---

test('AMP-161 concurrent callers that hit one failing source count ONE failure for the window, not one each', async () => {
  const c = clock('2026-11-14T10:00:00.000Z');
  const backoff = createSourceBackoff(c.now);
  const scope = { workspaceId: 'ws-a', businessId: 'biz-1' };
  const failing = async () => { await Promise.resolve(); throw new Error('down'); };
  const results = await Promise.allSettled([backoff.guard('orders', scope, failing), backoff.guard('orders', scope, failing), backoff.guard('orders', scope, failing)]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  // One failure means the first wait (5s); three counted failures would have meant 20s.
  c.advance(OVERVIEW_BACKOFF_BASE_MS);
  let tried = false;
  await backoff.guard('orders', scope, async () => { tried = true; return 1; });
  assert.equal(tried, true);
});

test('AMP-161 the name + store status pair is kept only for a read that was really stored', async () => {
  const { rt, state } = fakeRuntime();
  const c = clock('2026-11-14T10:00:00.000Z');
  const a = ctxFor('ws-a');
  const cache = sharedOverviewCache(rt, a, {}, c.now);
  // Hold the first read open, rename the business and invalidate while it runs: that read is served but never stored.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const read = rt.catalogue.listApprovedForBusiness;
  let held = false;
  rt.catalogue.listApprovedForBusiness = async (ctx, biz) => { if (!held) { held = true; await gate; } return read(ctx, biz); };
  const first = loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  while (!held) await new Promise((r) => setImmediate(r));
  state.names['ws-a'] = 'Later';
  invalidateSharedOverview(rt, 'ws-a', 'biz-1');
  release();
  const got = await first;
  assert.ok(got.found);
  // A later read from the saved copy must not show the name from the read that was never stored.
  const next = await loadCachedBusinessOverview(cache, rt, a, 'biz-1');
  assert.ok(next.found);
  if (next.found) assert.equal(next.businessName, 'Later');
});

test('AMP-161 the loader refuses a cache built for another workspace context or another runtime', async () => {
  const { rt } = fakeRuntime();
  const other = fakeRuntime().rt;
  const cacheA = sharedOverviewCache(rt, ctxFor('ws-a'), {});
  await assert.rejects(loadCachedBusinessOverview(cacheA, rt, ctxFor('ws-b'), 'biz-1'), /another workspace context/);
  await assert.rejects(loadCachedBusinessOverview(cacheA, other, ctxFor('ws-a'), 'biz-1'), /another workspace context/);
  const ok = await loadCachedBusinessOverview(cacheA, rt, ctxFor('ws-a'), 'biz-1');
  assert.ok(ok.found);
});
