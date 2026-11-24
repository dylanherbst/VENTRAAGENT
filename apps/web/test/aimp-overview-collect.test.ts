import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessOverview, collectOverviewSnapshot, getBusinessOverview, OverviewError } from '../lib/aimp/overview/index.ts';
import type { OverviewDeps } from '../lib/aimp/overview/index.ts';
import { createDemoOverviewDeps, DEMO_OVERVIEW_NOW, demoRowsFromSnapshot, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const A = { workspaceId: 'ws_1', businessId: 'biz_a' };
const B = { workspaceId: 'ws_1', businessId: 'biz_b' };
const OTHER_WS = { workspaceId: 'ws_2', businessId: 'biz_a' };
const now = () => DEMO_OVERVIEW_NOW;

function twoBusinesses(leakWholeWorkspace = false) {
  // Business A is a busy live store with a failed delivery; business B (same workspace) is brand new.
  const a = { ...demoSnapshot('degraded_checkout'), ...A, store: { ...demoSnapshot('live').store, url: 'https://a.example.test' } };
  const b = { ...demoSnapshot('new_setup'), ...B };
  const rows = demoRowsFromSnapshot(a);
  demoRowsFromSnapshot(b, rows);
  // Same order ids in both businesses to prove records are matched by tenant, not by id.
  rows.orders.push({ ...a.orders[0], ...B, id: 'ord_b_only', status: 'pending', paidAt: null });
  rows.leakWholeWorkspace = leakWholeWorkspace;
  return { a, b, rows, deps: createDemoOverviewDeps(rows, now) };
}

test('collect returns this business only: B sees nothing of A', async () => {
  const { deps } = twoBusinesses();
  const snap = await collectOverviewSnapshot(deps, B);
  assert.equal(snap.businessId, 'biz_b');
  assert.deepEqual(snap.orders.map((o) => o.id), ['ord_b_only']);
  assert.equal(snap.deliveries.length, 0);
  assert.equal(snap.moneyEvents.length, 0);
  assert.equal(snap.approvals.length, 0);
  assert.equal(snap.store.url, null);
  assert.equal(snap.seller.state, 'not_connected');
  const o = buildBusinessOverview(snap, now());
  assert.equal(o.businessId, 'biz_b');
  assert.ok(!o.needsYou.some((n) => n.id.startsWith('approval:') || n.id.startsWith('delivery:') || n.id === 'seller:restricted'));
  assert.ok(!JSON.stringify(o).includes('a.example.test'));
  assert.ok(o.needsYou.every((n) => n.href.startsWith('/app/biz_b')));
});

test('collect isolates even when a dependency lists the whole workspace', async () => {
  const { deps } = twoBusinesses(true);
  const snapA = await collectOverviewSnapshot(deps, A);
  const snapB = await collectOverviewSnapshot(deps, B);
  assert.ok(snapA.orders.every((o) => o.id !== 'ord_b_only'));
  assert.deepEqual(snapB.orders.map((o) => o.id), ['ord_b_only']);
  assert.equal(snapB.deliveries.length, 0);
  assert.equal(snapA.deliveries.length, 2);
});

test('another workspace with the same business id sees nothing', async () => {
  const { deps } = twoBusinesses();
  const snap = await collectOverviewSnapshot(deps, OTHER_WS);
  assert.equal(snap.orders.length + snap.deliveries.length + snap.approvals.length, 0);
});

test('every read passes workspaceId and businessId', async () => {
  const { deps } = twoBusinesses();
  const seen: unknown[] = [];
  const spy = <T>(name: string, v: T) => async (s: unknown) => { seen.push([name, s]); return v; };
  const spied: OverviewDeps = {
    orders: { list: spy('orders', []) }, fulfilment: { list: spy('fulfilment', []), moneyEvents: spy('money', []) },
    seller: { readiness: spy('seller', (await deps.seller.readiness(A))) }, store: { get: spy('store', await deps.store.get(A)) },
    steps: { get: spy('steps', await deps.steps.get(A)) }, automation: { approvals: spy('approvals', []), activity: spy('activity', []) },
    analytics: { visits: spy('analytics', null) }, business: { currency: spy('currency', 'AUD') }, now,
  };
  await collectOverviewSnapshot(spied, A);
  assert.equal(seen.length, 10);
  for (const [, s] of seen as [string, unknown][]) assert.deepEqual(s, A);
});

test('no analytics dep, or a dep with no data, means unknown visits', async () => {
  const { rows } = twoBusinesses();
  const none = await getBusinessOverview(createDemoOverviewDeps(rows, now, { analytics: false }), A);
  assert.deepEqual(none.summary.visits, { known: false });
  const empty = await getBusinessOverview(createDemoOverviewDeps(rows, now), A);
  assert.deepEqual(empty.summary.visits, { known: false });
  rows.perBusiness['ws_1/biz_a'].visits = 0;
  const zero = await getBusinessOverview(createDemoOverviewDeps(rows, now), A);
  assert.deepEqual(zero.summary.visits, { known: true, value: 0 });
});

test('getBusinessOverview: one call returns summary, ranked needs-you, progress and brief for the scope', async () => {
  const { deps } = twoBusinesses();
  const o = await getBusinessOverview(deps, A);
  assert.equal(o.state, 'degraded_checkout');
  assert.equal(o.needsYou[0].action, 'Send Stripe the missing details');
  assert.ok(o.dailyBrief.lines.length > 0 && o.launchProgress.total === 7);
  assert.equal(o.summary.lastUpdatedAt, DEMO_OVERVIEW_NOW.toISOString());
});

test('invalid scope is refused before any read, and a failing read fails the whole collect', async () => {
  const { deps } = twoBusinesses();
  let reads = 0;
  const counting: OverviewDeps = { ...deps, orders: { list: async (s) => { reads += 1; return deps.orders.list(s); } } };
  for (const bad of [{ workspaceId: '', businessId: 'x' }, { workspaceId: 'x', businessId: '' }, { workspaceId: 'a b', businessId: 'x' }]) {
    await assert.rejects(collectOverviewSnapshot(counting, bad), OverviewError);
  }
  assert.equal(reads, 0);
  const broken: OverviewDeps = { ...deps, seller: { readiness: async () => { throw new Error('boom'); } } };
  await assert.rejects(collectOverviewSnapshot(broken, A), /boom/);
});
