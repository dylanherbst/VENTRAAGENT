// AMP-091: the REAL adapters over the REAL in-memory seller and fulfilment stores, plus the snapshot cache. No mock adapters.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFulfilmentStore } from '../lib/aimp/fulfilment/store.ts';
import { createInMemorySellerStore } from '../lib/aimp/sellers/store.ts';
import type { StripeAccountSnapshot } from '../lib/aimp/sellers/types.ts';
import {
  buildBusinessOverview, collectOverviewSnapshot, createAbsentVisitsSource, createFulfilmentSource, createOverviewCache, createSellerSource,
  createVisitsSource, OverviewError, STALE_AFTER_MS,
} from '../lib/aimp/overview/index.ts';
import type { OverviewDeps } from '../lib/aimp/overview/index.ts';
import { createDemoOverviewDeps, demoRowsFromSnapshot, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const A = { workspaceId: 'ws_1', businessId: 'biz_a' };
const B = { workspaceId: 'ws_1', businessId: 'biz_b' };
const OTHER_WS = { workspaceId: 'ws_2', businessId: 'biz_a' };
const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const readySnap = (id: string): StripeAccountSnapshot => ({
  id, charges_enabled: true, payouts_enabled: true, details_submitted: true,
  requirements: { currently_due: [], past_due: [], disabled_reason: null }, capabilities: { card_payments: 'active', transfers: 'active' },
});
const restrictedSnap = (id: string): StripeAccountSnapshot => ({
  id, charges_enabled: false, payouts_enabled: false, details_submitted: true,
  requirements: { currently_due: ['external_account'], past_due: ['external_account'], disabled_reason: 'requirements.past_due' }, capabilities: {},
});

async function addDelivery(store: ReturnType<typeof createMemoryFulfilmentStore>, scope: { workspaceId: string; businessId: string }, orderId: string, at: string) {
  await store.createForOrder(
    { id: `ful_${orderId}`, orderId, orderItemId: `item_${orderId}`, ...scope, storeSlug: 'shop', productId: 'prod_1', productVersion: 1, paidEventId: `evt_${orderId}`, maxAttempts: 3, createdAt: at },
    { id: `ent_${orderId}`, fulfilmentId: `ful_${orderId}`, orderId, orderItemId: `item_${orderId}`, ...scope, storeSlug: 'shop', productId: 'prod_1', productVersion: 1, buyerEmail: 'buyer@example.test', createdAt: at },
  );
}

test('seller source: real store, per business, other workspace and other business read as not connected', async () => {
  const store = createInMemorySellerStore();
  store.register({ ...A, stripeAccountId: 'acct_a', snapshot: readySnap('acct_a'), lastEventCreated: 1 });
  store.register({ ...B, stripeAccountId: 'acct_b', snapshot: readySnap('acct_b'), lastEventCreated: 1 });
  store.register({ workspaceId: 'ws_1', businessId: 'biz_c', stripeAccountId: 'acct_c', snapshot: restrictedSnap('acct_c'), lastEventCreated: 1 });
  const src = createSellerSource(store);
  assert.equal((await src.readiness(A)).state, 'ready');
  assert.equal((await src.readiness(A)).canAcceptPayments, true);
  assert.equal((await src.readiness(B)).state, 'ready');
  assert.equal((await src.readiness({ workspaceId: 'ws_1', businessId: 'biz_c' })).state, 'restricted');
  assert.equal((await src.readiness(OTHER_WS)).state, 'not_connected');
  assert.equal((await src.readiness({ workspaceId: 'ws_1', businessId: 'biz_none' })).state, 'not_connected');
  // A webhook that changes A does not touch B.
  store.applyAccountUpdated({ id: 'evt_1', type: 'account.updated', account: 'acct_a', created: 5, data: { object: restrictedSnap('acct_a') } });
  assert.equal((await src.readiness(A)).state, 'restricted');
  assert.equal((await src.readiness(B)).state, 'ready', 'B was ready and A changed: B is untouched');
  assert.equal((await src.readiness({ workspaceId: 'ws_1', businessId: 'biz_c' })).state, 'restricted');
  assert.equal((await src.readiness(OTHER_WS)).state, 'not_connected');
});

test('fulfilment source: deliveries and money events are scoped to one business and one workspace', async () => {
  const store = createMemoryFulfilmentStore();
  await addDelivery(store, A, 'ord_a1', iso(T0));
  await addDelivery(store, B, 'ord_b1', iso(T0));
  await addDelivery(store, { workspaceId: 'ws_2', businessId: 'biz_a' }, 'ord_w2', iso(T0));
  const ev = (eventId: string, s: { workspaceId: string; businessId: string }, orderId: string, kind: 'refund' | 'dispute') => store.recordMoneyEvent({
    eventId, type: 'charge.refunded', kind, ...s, orderId, amountMinor: 1200, needsOwner: kind === 'dispute', outcome: 'needs_owner', note: null, at: iso(T0),
  });
  await ev('mev_a', A, 'ord_a1', 'dispute');
  await ev('mev_b', B, 'ord_b1', 'refund');
  await ev('mev_w2', OTHER_WS, 'ord_w2', 'refund');
  const src = createFulfilmentSource(store);

  const a = await src.list(A);
  assert.deepEqual(a.map((d) => d.orderId), ['ord_a1']);
  assert.equal(a[0].status, 'queued');
  assert.equal(a[0].maxAttempts, 3);
  assert.equal(a[0].lastError, null);
  assert.deepEqual((await src.list(B)).map((d) => d.orderId), ['ord_b1']);
  assert.deepEqual((await src.list(OTHER_WS)).map((d) => d.orderId), ['ord_w2']);
  assert.deepEqual((await src.list({ workspaceId: 'ws_3', businessId: 'biz_a' })), []);

  const ma = await src.moneyEvents(A);
  assert.deepEqual(ma.map((e) => [e.eventId, e.kind, e.needsOwner, e.amountMinor]), [['mev_a', 'dispute', true, 1200]]);
  assert.deepEqual((await src.moneyEvents(B)).map((e) => e.eventId), ['mev_b']);
  assert.deepEqual((await src.moneyEvents(OTHER_WS)).map((e) => e.eventId), ['mev_w2']);
  // No buyer email or other private field is copied.
  assert.ok(!JSON.stringify(a).includes('buyer@example.test'));
});

test('visits: absent source is unknown, never zero; a real reader is validated', async () => {
  assert.equal(await createAbsentVisitsSource().visits(A), null);
  const seen: unknown[] = [];
  const src = createVisitsSource(async (s) => { seen.push(s); return s.businessId === 'biz_a' ? 42 : null; });
  assert.equal(await src.visits(A), 42);
  assert.equal(await src.visits(B), null);
  assert.deepEqual(seen[0], A);
  for (const bad of [-1, 1.5, Number.NaN, Infinity, undefined, '7' as unknown as number]) {
    assert.equal(await createVisitsSource(async () => bad as number).visits(A), null);
  }
  assert.equal(await createVisitsSource(async () => 0).visits(A), 0, 'a real zero stays a zero');
});

function wiredDeps(now: () => Date, opts: { visits?: boolean } = {}) {
  const sellers = createInMemorySellerStore();
  const fulfilment = createMemoryFulfilmentStore();
  const live = demoSnapshot('live');
  const scope = { workspaceId: live.workspaceId, businessId: live.businessId };
  const base = createDemoOverviewDeps(demoRowsFromSnapshot(live), now, { analytics: false });
  const deps: OverviewDeps = {
    ...base, seller: createSellerSource(sellers), fulfilment: createFulfilmentSource(fulfilment),
    ...(opts.visits === false ? {} : { analytics: createAbsentVisitsSource() }),
  };
  return { deps, sellers, fulfilment, scope };
}

test('collect over the real adapters: payments read from the seller store, visits unknown, other business unseen', async () => {
  const { deps, sellers, fulfilment, scope } = wiredDeps(() => new Date(T0));
  const other = { workspaceId: scope.workspaceId, businessId: 'biz_other' };
  sellers.register({ ...scope, stripeAccountId: 'acct_x', snapshot: readySnap('acct_x'), lastEventCreated: 1 });
  await addDelivery(fulfilment, scope, 'ord_mine', iso(T0));
  await addDelivery(fulfilment, other, 'ord_theirs', iso(T0));
  const snap = await collectOverviewSnapshot(deps, scope);
  assert.equal(snap.seller.state, 'ready');
  assert.deepEqual(snap.deliveries.map((d) => d.orderId), ['ord_mine']);
  assert.equal(snap.analytics, null);
  const o = buildBusinessOverview(snap, new Date(T0));
  assert.deepEqual(o.summary.visits, { known: false });
  assert.equal(o.flags.checkoutDegraded, false);
  const theirs = await collectOverviewSnapshot(deps, other);
  assert.equal(theirs.seller.state, 'not_connected');
  assert.deepEqual(theirs.deliveries.map((d) => d.orderId), ['ord_theirs']);
});

test('cache: builds once, serves from cache, exposes refreshedAt, goes stale, refresh re-reads', async () => {
  let t = T0;
  const { deps, sellers, scope } = wiredDeps(() => new Date(t));
  let reads = 0;
  const counting: OverviewDeps = { ...deps, seller: { readiness: async (s) => { reads += 1; return deps.seller.readiness(s); } } };
  const cache = createOverviewCache({ deps: counting, staleAfterMs: 10 * 60_000 });

  const first = await cache.get(scope);
  assert.equal(first.fromCache, false);
  assert.equal(first.refreshedAt, iso(T0));
  assert.equal(first.stale, false);
  assert.equal(first.overview.state, 'degraded_checkout');
  assert.equal(first.overview.summary.lastUpdatedAt, iso(T0));

  // Payments become ready, but the cache still serves the old picture until refreshed.
  sellers.register({ ...scope, stripeAccountId: 'acct_x', snapshot: readySnap('acct_x'), lastEventCreated: 1 });
  t = T0 + 5 * 60_000;
  const second = await cache.get(scope);
  assert.equal(second.fromCache, true);
  assert.equal(reads, 1);
  assert.equal(second.refreshedAt, iso(T0));
  assert.equal(second.ageMs, 5 * 60_000);
  assert.equal(second.stale, false);
  assert.equal(second.overview.state, 'degraded_checkout');

  // Past the configured age: data_stale appears (and wins over degraded_checkout by precedence).
  t = T0 + 10 * 60_000 + 1;
  const old = await cache.get(scope);
  assert.equal(old.stale, true);
  assert.equal(old.overview.flags.stale, true);
  assert.equal(old.overview.state, 'data_stale');
  assert.equal(reads, 1);

  const fresh = await cache.refresh(scope);
  assert.equal(reads, 2);
  assert.equal(fresh.refreshedAt, iso(t));
  assert.equal(fresh.stale, false);
  assert.notEqual(fresh.overview.state, 'data_stale');
  assert.equal(fresh.overview.flags.checkoutDegraded, false);
});

test('cache: the default stale age is the read model default; an old snapshot at default age is still fresh under a longer age', async () => {
  let t = T0;
  const { deps, scope } = wiredDeps(() => new Date(t));
  const def = createOverviewCache({ deps });
  const long = createOverviewCache({ deps, staleAfterMs: 60 * 60_000 });
  await def.get(scope); await long.get(scope);
  t = T0 + STALE_AFTER_MS + 1;
  assert.equal((await def.get(scope)).overview.state, 'data_stale');
  assert.equal((await long.get(scope)).stale, false);
});

test('cache: keyed per business (A and B do not share an entry), invalidate drops one', async () => {
  const { deps, scope } = wiredDeps(() => new Date(T0));
  const cache = createOverviewCache({ deps });
  const other = { workspaceId: scope.workspaceId, businessId: 'biz_other' };
  const a = await cache.get(scope);
  const b = await cache.get(other);
  assert.equal(cache.size(), 2);
  assert.equal(a.overview.businessId, scope.businessId);
  assert.equal(b.overview.businessId, 'biz_other');
  assert.notEqual(b.overview.state, a.overview.state);
  assert.ok(b.overview.needsYou.every((n) => n.href.startsWith('/app/biz_other')));
  cache.invalidate(other);
  assert.equal(cache.size(), 1);
  assert.equal((await cache.get(scope)).fromCache, true);
  assert.equal((await cache.get(other)).fromCache, false);
});

test('cache: concurrent first reads share one build; a failed first build is not cached; bad scope and options are refused', async () => {
  const { deps, scope } = wiredDeps(() => new Date(T0));
  let reads = 0; let fail = true;
  const flaky: OverviewDeps = { ...deps, seller: { readiness: async (s) => { reads += 1; if (fail) throw new Error('down'); return deps.seller.readiness(s); } } };
  const cache = createOverviewCache({ deps: flaky });
  await assert.rejects(cache.get(scope), /down/);
  assert.equal(cache.size(), 0);
  fail = false; reads = 0;
  const [x, y] = await Promise.all([cache.get(scope), cache.get(scope)]);
  assert.equal(reads, 1);
  assert.equal(x.refreshedAt, y.refreshedAt);
  await assert.rejects(cache.get({ workspaceId: 'ws_1', businessId: '../x' }), OverviewError);
  await assert.rejects(cache.get({ workspaceId: '', businessId: 'b' }), OverviewError);
  assert.throws(() => createOverviewCache({ deps, staleAfterMs: 0 }));
  assert.throws(() => createOverviewCache({ deps, refreshAfterMs: -1 }));
});

test('cache: auto refresh after refreshAfterMs; a failed auto refresh keeps serving the old snapshot, a failed explicit refresh throws', async () => {
  let t = T0; let fail = false;
  const { deps, scope } = wiredDeps(() => new Date(t));
  const flaky: OverviewDeps = { ...deps, seller: { readiness: async (s) => { if (fail) throw new Error('down'); return deps.seller.readiness(s); } } };
  const cache = createOverviewCache({ deps: flaky, staleAfterMs: 20 * 60_000, refreshAfterMs: 5 * 60_000 });
  await cache.get(scope);
  t = T0 + 6 * 60_000;
  const re = await cache.get(scope);
  assert.equal(re.fromCache, false);
  assert.equal(re.refreshedAt, iso(t));
  fail = true;
  t += 6 * 60_000;
  const kept = await cache.get(scope);
  assert.equal(kept.fromCache, true);
  assert.equal(kept.refreshedAt, iso(T0 + 6 * 60_000));
  await assert.rejects(cache.refresh(scope), /down/);
  t += 20 * 60_000;
  assert.equal((await cache.get(scope)).overview.state, 'data_stale');
});

test('cache: a failed auto refresh under a longer staleAfterMs is marked refreshFailed, and the marker clears on the next good read', async () => {
  let t = T0; let fail = false;
  const { deps, scope } = wiredDeps(() => new Date(t));
  const flaky: OverviewDeps = { ...deps, seller: { readiness: async (s) => { if (fail) throw new Error('secret@example.test down'); return deps.seller.readiness(s); } } };
  const cache = createOverviewCache({ deps: flaky, staleAfterMs: 60 * 60_000, refreshAfterMs: 5 * 60_000 });
  const first = await cache.get(scope);
  assert.equal(first.refreshFailed, false);
  assert.equal(first.lastRefreshErrorAt, null);
  fail = true;
  t = T0 + 6 * 60_000;
  const kept = await cache.get(scope);
  assert.equal(kept.fromCache, true);
  assert.equal(kept.stale, false, 'not stale yet, so the marker is the only signal');
  assert.equal(kept.refreshFailed, true);
  assert.equal(kept.lastRefreshErrorAt, iso(t));
  assert.ok(!JSON.stringify(kept).includes('secret@example.test'), 'no error text is carried');
  fail = false;
  t += 60_000;
  const ok = await cache.get(scope);
  assert.equal(ok.fromCache, false);
  assert.equal(ok.refreshFailed, false);
  assert.equal(ok.lastRefreshErrorAt, null);
  assert.equal((await cache.get(scope)).refreshFailed, false);
});

test('cache: an in-flight load that started before invalidate() or refresh() does not overwrite newer state', async () => {
  let t = T0;
  const { deps, sellers, scope } = wiredDeps(() => new Date(t));
  let release!: () => void; let hold = true;
  const gate = new Promise<void>((r) => { release = r; });
  const slow: OverviewDeps = { ...deps, seller: { readiness: async (s) => { const r = await deps.seller.readiness(s); if (hold) await gate; return r; } } };
  const cache = createOverviewCache({ deps: slow });

  // invalidate during a load: the late result is not stored.
  const pending = cache.get(scope);
  await Promise.resolve();
  cache.invalidate(scope);
  release();
  await pending;
  assert.equal(cache.size(), 0, 'the invalidated in-flight load did not repopulate the cache');
  hold = false;

  // refresh during a load: the newer refresh wins even though the older load finishes last.
  hold = true;
  const gate2 = new Promise<void>((r) => { release = r; });
  const slow2: OverviewDeps = { ...deps, seller: { readiness: async (s) => { const r = await deps.seller.readiness(s); if (hold) { hold = false; await gate2; } return r; } } };
  const cache2 = createOverviewCache({ deps: slow2 });
  const older = cache2.get(scope); // reads the not_connected picture, then waits
  await Promise.resolve();
  sellers.register({ ...scope, stripeAccountId: 'acct_x', snapshot: readySnap('acct_x'), lastEventCreated: 1 });
  t = T0 + 1000;
  const newer = await cache2.refresh(scope); // starts a fresh read (hold already false), sees ready
  assert.equal(newer.overview.flags.checkoutDegraded, false);
  release();
  await older;
  const served = await cache2.get(scope);
  assert.equal(served.fromCache, true);
  assert.equal(served.refreshedAt, iso(T0 + 1000), 'the newer refresh is what the cache holds');
  assert.equal(served.overview.flags.checkoutDegraded, false);
});

test('build: staleAfterMs option is optional and defaults to the old behaviour', () => {
  const snap = { ...demoSnapshot('live'), collectedAt: iso(T0) };
  assert.equal(buildBusinessOverview(snap, new Date(T0 + STALE_AFTER_MS)).flags.stale, false);
  assert.equal(buildBusinessOverview(snap, new Date(T0 + STALE_AFTER_MS + 1)).flags.stale, true);
  assert.equal(buildBusinessOverview(snap, new Date(T0 + 1000), { staleAfterMs: 500 }).flags.stale, true);
});
