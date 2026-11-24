// AMP-093 (H01): the Business Overview page reads seller readiness, fulfilment and money events through the AMP-091 adapters when
// the runtime carries the stores, reads through one shared cache keyed per business, and says in plain words when the numbers were
// last updated, when they are old, when a refresh failed and when a total may be too low.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimeOverviewDeps, loadCachedBusinessOverview, OVERVIEW_BACKOFF_MAX_MS, OVERVIEW_REFRESH_AFTER_MS, OVERVIEW_SOURCES, overviewSources, sharedOverviewCache,
} from '../app/app/[business]/_server/overview.ts';
import type { OverviewContexts, OverviewRuntime } from '../app/app/[business]/_server/overview.ts';
import { agoWords, buildOverviewViewModel } from '../app/app/[business]/view-model.ts';
import { buildBusinessOverview } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const WS = 'demo-workspace';
const ctx: OverviewContexts = {
  workspaceId: WS,
  productCtx: { workspaceId: WS, actorId: 'demo-owner' },
  brandCtx: { workspaceId: WS },
  siteActor: { workspaceId: WS, userId: 'demo-owner' },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: 'demo-owner', idempotencyKey: `start:${businessId}` }),
};

/** A runtime-shaped fake. `live` businesses have a brand, an approved product, a listing and a published site. */
function fakeRuntime(live: string[], known: string[] = live) {
  const state = { failSteps: false, catalogueReads: 0 };
  const rt: OverviewRuntime = {
    products: { listVersions: async (_c, productId) => [{ id: `v-${productId}`, status: 'approved' }] as never },
    brands: { kind: 'memory', list: async (ws: string, biz: string) => (ws === WS && live.includes(biz) ? ([{ status: 'approved', name: `Name ${biz}`, businessId: biz }] as never) : []) } as never,
    catalogue: { listApprovedForBusiness: async (_c, biz) => {
      state.catalogueReads += 1;
      if (state.failSteps) throw new Error('catalogue is down');
      return (live.includes(biz) ? [{ id: 'l1' }] : []) as never;
    } },
    sites: { resolvePublished: async () => ({ status: 'live', version: 1, publishedAt: '2026-11-14T09:00:00.000Z', config: {} as never }) },
    seeds: { has: (b) => known.includes(b) },
    productIds: { get: (b) => (live.includes(b) ? [`p-${b}`] : undefined) },
    slugs: { get: (b) => (live.includes(b) ? `s-${b}` : undefined) },
    businesses: { has: (b) => known.includes(b) },
  };
  return { rt, state };
}

const clock = (startIso: string) => {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by: number) => { ms += by; } };
};

// --- acceptance 1: real adapters when the stores are present, stubs when absent ---

test('with no seller or fulfilment store the old stubs answer, and the sources say so', async () => {
  const { rt } = fakeRuntime(['biz-a']);
  const deps = createRuntimeOverviewDeps(rt, ctx, {}, () => new Date('2026-11-14T10:00:00.000Z'));
  const scope = { workspaceId: WS, businessId: 'biz-a' };
  assert.equal((await deps.seller.readiness(scope)).state, 'not_connected');
  assert.deepEqual(await deps.fulfilment.list(scope), []);
  assert.deepEqual(await deps.fulfilment.moneyEvents(scope), []);
  assert.equal(await deps.analytics?.visits(scope), null); // unknown, never 0
  const sources = overviewSources(rt);
  assert.equal(sources.seller, 'absent (not connected)');
  assert.equal(sources.fulfilment, 'absent');
  assert.equal(sources.moneyEvents, 'absent');
  assert.equal(sources.analytics, 'absent');
  assert.deepEqual(OVERVIEW_SOURCES, sources);
});

test('with the stores present the AMP-091 adapters read them, for this workspace and business only', async () => {
  const { rt } = fakeRuntime(['biz-a', 'biz-b']);
  const sellerReads: string[] = [];
  const fulfilmentReads: string[] = [];
  const event = (businessId: string, workspaceId = WS) => ({
    eventId: `e-${workspaceId}-${businessId}`, kind: 'refund', orderId: `o-${businessId}`, amountMinor: 500, needsOwner: true, at: '2026-11-14T09:30:00.000Z', workspaceId, businessId,
  });
  const wired: OverviewRuntime = {
    ...rt,
    sellers: { get: (ws, biz) => { sellerReads.push(`${ws}/${biz}`); return null; } },
    fulfilment: {
      list: async (ws) => { fulfilmentReads.push(`list:${ws}`); return []; },
      listMoneyEvents: async (ws) => { fulfilmentReads.push(`money:${ws}`); return [event('biz-a'), event('biz-b'), event('biz-a', 'other-workspace')] as never; },
    },
  };
  const deps = createRuntimeOverviewDeps(wired, ctx, {}, () => new Date('2026-11-14T10:00:00.000Z'));
  const scope = { workspaceId: WS, businessId: 'biz-a' };
  assert.equal((await deps.seller.readiness(scope)).state, 'not_connected'); // no account on file: still honest
  assert.deepEqual(sellerReads, [`${WS}/biz-a`]);
  assert.deepEqual(await deps.fulfilment.list(scope), []);
  assert.deepEqual((await deps.fulfilment.moneyEvents(scope)).map((e) => e.eventId), [`e-${WS}-biz-a`]);
  assert.deepEqual(fulfilmentReads, [`list:${WS}`, `money:${WS}`]);
  const sources = overviewSources(wired);
  assert.equal(sources.seller, 'wired');
  assert.equal(sources.fulfilment, 'wired');
  assert.equal(sources.moneyEvents, 'wired');
  assert.equal(sources.analytics, 'absent');
  // Only one store present: only that source is called real.
  assert.equal(overviewSources({ sellers: wired.sellers }).fulfilment, 'absent');
  assert.equal(overviewSources({ fulfilment: wired.fulfilment }).seller, 'absent (not connected)');
});

// --- acceptance 2: one cache, no cross-business leak, real age, refresh failed ---

test('one shared cache per runtime; each business gets only its own snapshot; an unknown business is never cached', async () => {
  const { rt } = fakeRuntime(['biz-a'], ['biz-a', 'biz-b']);
  const c = clock('2026-11-14T10:00:00.000Z');
  const cache = sharedOverviewCache(rt, ctx, {}, c.now);
  assert.equal(sharedOverviewCache(rt, ctx, {}, c.now), cache);
  const a = await loadCachedBusinessOverview(cache, rt, ctx, 'biz-a');
  const b = await loadCachedBusinessOverview(cache, rt, ctx, 'biz-b');
  assert.ok(a.found && b.found);
  if (!a.found || !b.found) return;
  assert.equal(a.overview.businessId, 'biz-a');
  assert.equal(b.overview.businessId, 'biz-b');
  assert.equal(a.overview.flags.storePublished, true);
  assert.equal(b.overview.flags.storePublished, false);
  assert.equal(b.overview.state, 'new_setup');
  assert.equal(a.businessName, 'Name biz-a');
  assert.equal(b.businessName, null);
  assert.equal(cache.size(), 2);
  // Served again from the cache: still each its own.
  const a2 = await loadCachedBusinessOverview(cache, rt, ctx, 'biz-a');
  const b2 = await loadCachedBusinessOverview(cache, rt, ctx, 'biz-b');
  assert.ok(a2.found && b2.found);
  if (!a2.found || !b2.found) return;
  assert.equal(a2.overview.businessId, 'biz-a');
  assert.equal(a2.overview.launchProgress.done, a.overview.launchProgress.done);
  assert.equal(b2.overview.businessId, 'biz-b');
  assert.notEqual(b2.overview.launchProgress.done, a2.overview.launchProgress.done);
  assert.deepEqual(await loadCachedBusinessOverview(cache, rt, ctx, 'never-seen'), { found: false });
  assert.equal(cache.size(), 2);
  // A different runtime never gets the first runtime's cache.
  const other = fakeRuntime(['biz-a']);
  assert.notEqual(sharedOverviewCache(other.rt, ctx, {}, c.now), cache);
});

test('the page reads from the cache, re-reads after a short while, and reports a failed refresh with the real age', async () => {
  const { rt, state } = fakeRuntime(['biz-a']);
  const c = clock('2026-11-14T10:00:00.000Z');
  const cache = sharedOverviewCache(rt, ctx, {}, c.now);
  const load = async () => {
    const r = await loadCachedBusinessOverview(cache, rt, ctx, 'biz-a');
    assert.ok(r.found && r.freshness);
    if (!r.found || !r.freshness) throw new Error('not found');
    return { ...r, freshness: r.freshness };
  };

  const first = await load();
  assert.deepEqual(first.freshness, { refreshedAt: '2026-11-14T10:00:00.000Z', ageMs: 0, stale: false, refreshFailed: false });
  const readsAfterFirst = state.catalogueReads;

  // Inside the refresh window: served from the cache, nothing is read again.
  c.advance(1_000);
  const second = await load();
  assert.equal(state.catalogueReads, readsAfterFirst);
  assert.equal(second.freshness.ageMs, 1_000);

  // Past the window with a source down: the older numbers are served and the failure is reported, though they are not old yet.
  state.failSteps = true;
  c.advance(OVERVIEW_REFRESH_AFTER_MS);
  const failed = await load();
  assert.equal(failed.freshness.refreshFailed, true);
  assert.equal(failed.freshness.stale, false);
  assert.equal(failed.freshness.refreshedAt, '2026-11-14T10:00:00.000Z');
  const vmFailed = buildOverviewViewModel({ overview: failed.overview, businessName: failed.businessName, freshness: failed.freshness });
  assert.deepEqual(vmFailed.banners.filter((x) => x.id === 'refresh_failed' || x.id === 'stale').map((x) => x.id), ['refresh_failed']);
  assert.equal(vmFailed.updatedWords, 'Just now · 2026-11-14 10:00 UTC');

  // Still failing 20 minutes later: now also stale, from the real age.
  c.advance(20 * 60_000);
  const old = await load();
  assert.equal(old.freshness.refreshFailed, true);
  assert.equal(old.freshness.stale, true);
  const vmOld = buildOverviewViewModel({ overview: old.overview, businessName: old.businessName, freshness: old.freshness });
  const banner = vmOld.banners.find((x) => x.id === 'refresh_failed');
  assert.ok(banner);
  assert.match(banner.text, /Last updated 20 minutes ago \(2026-11-14 10:00 UTC\)\. They may be out of date\./);
  assert.equal(vmOld.updatedText, 'Updated 20 minutes ago');

  // The source comes back: it is tried again once its back-off wait has passed, then fresh numbers and no warning.
  state.failSteps = false;
  c.advance(OVERVIEW_BACKOFF_MAX_MS);
  const back = await load();
  assert.equal(back.freshness.refreshFailed, false);
  assert.equal(back.freshness.stale, false);
  assert.equal(back.freshness.ageMs, 0);
  const vmBack = buildOverviewViewModel({ overview: back.overview, businessName: back.businessName, freshness: back.freshness });
  assert.deepEqual(vmBack.banners.filter((x) => x.id === 'refresh_failed' || x.id === 'stale'), []);
});

test('a first read that fails is an error, not an empty overview, and is not cached', async () => {
  const { rt, state } = fakeRuntime(['biz-a']);
  const cache = sharedOverviewCache(rt, ctx, {}, () => new Date('2026-11-14T10:00:00.000Z'));
  state.failSteps = true;
  await assert.rejects(loadCachedBusinessOverview(cache, rt, ctx, 'biz-a'));
  assert.equal(cache.size(), 0);
});

// --- view model wording ---

const liveOverview = () => buildBusinessOverview({ ...demoSnapshot('live'), businessId: 'biz-x' }, DEMO_OVERVIEW_NOW);
const fresh = (over: Partial<{ ageMs: number; stale: boolean; refreshFailed: boolean }> = {}) => ({ refreshedAt: '2026-11-14T10:00:00.000Z', ageMs: 0, stale: false, refreshFailed: false, ...over });

test('how long ago is said in plain words, and a broken age is never "just now"', () => {
  assert.equal(agoWords(0), 'just now');
  assert.equal(agoWords(59_999), 'just now');
  assert.equal(agoWords(60_000), '1 minute ago');
  assert.equal(agoWords(14 * 60_000), '14 minutes ago');
  assert.equal(agoWords(60 * 60_000), 'about 1 hour ago');
  assert.equal(agoWords(5 * 3_600_000), 'about 5 hours ago');
  assert.equal(agoWords(24 * 3_600_000), 'about 1 day ago');
  assert.equal(agoWords(3 * 24 * 3_600_000), 'about 3 days ago');
  assert.equal(agoWords(Number.NaN), 'at an unknown time');
  assert.equal(agoWords(-5), 'at an unknown time');
});

test('last updated: plain words plus the exact time; without cache details only the exact time', () => {
  const o = liveOverview();
  const vm = buildOverviewViewModel({ overview: o, freshness: fresh({ ageMs: 3 * 60_000 }) });
  assert.equal(vm.updatedText, 'Updated 3 minutes ago');
  assert.equal(vm.updatedWords, '3 minutes ago · 2026-11-14 10:00 UTC');
  assert.deepEqual(vm.banners.filter((x) => x.id === 'stale' || x.id === 'refresh_failed'), []);
  const plain = buildOverviewViewModel({ overview: o });
  assert.match(plain.updatedText, /^Updated \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.equal(`Updated ${plain.updatedWords}`, plain.updatedText);
});

test('stale from the real age shows the out-of-date warning even when the overview itself did not flag it', () => {
  const o = liveOverview();
  assert.equal(o.flags.stale, false);
  const vm = buildOverviewViewModel({ overview: o, freshness: fresh({ ageMs: 20 * 60_000, stale: true }) });
  const banner = vm.banners.find((x) => x.id === 'stale');
  assert.ok(banner);
  assert.equal(banner.title, 'These numbers may be out of date');
  assert.match(banner.text, /^Last updated 20 minutes ago \(2026-11-14 10:00 UTC\)\. Check again/);
  assert.ok(vm.tiles.filter((t) => !t.unknown).every((t) => t.note.endsWith('May be out of date.')));
});

test('"could not refresh" shows when the refresh failed even if the numbers are not old', () => {
  const vm = buildOverviewViewModel({ overview: liveOverview(), freshness: fresh({ ageMs: 30_000, refreshFailed: true }) });
  const banner = vm.banners.find((x) => x.id === 'refresh_failed');
  assert.ok(banner);
  assert.equal(banner.title, 'We could not refresh your numbers');
  assert.equal(banner.tone, 'warn');
  assert.match(banner.text, /Last updated just now/);
  assert.doesNotMatch(banner.text, /may be out of date/);
  assert.equal(vm.banners.some((x) => x.id === 'stale'), false);
});

test('a plain warning shows when amounts were left out of the totals, and not otherwise', () => {
  const o = liveOverview();
  assert.equal(buildOverviewViewModel({ overview: o }).banners.some((x) => x.id === 'invalid_amounts'), o.summary.invalidAmounts > 0);
  const withBad = (n: number) => buildOverviewViewModel({ overview: { ...o, summary: { ...o.summary, invalidAmounts: n } } }).banners.find((x) => x.id === 'invalid_amounts');
  assert.equal(withBad(0), undefined);
  const one = withBad(1);
  assert.ok(one);
  assert.equal(one.title, 'Your totals may be too low');
  assert.match(one.text, /^We could not read 1 amount, so we left it out\. Gross sales or refunds may be lower than the real figure\.$/);
  const two = withBad(2);
  assert.ok(two);
  assert.match(two.text, /^We could not read 2 amounts, so we left them out\./);
});
