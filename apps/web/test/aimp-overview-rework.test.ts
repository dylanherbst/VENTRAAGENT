import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBusinessOverview, collectOverviewSnapshot, getBusinessOverview, overviewHref, OverviewError, STALE_AFTER_MS,
} from '../lib/aimp/overview/index.ts';
import type { OverviewDeps, OverviewScope } from '../lib/aimp/overview/index.ts';
import { createDemoOverviewDeps, DEMO_OVERVIEW_NOW, demoRowsFromSnapshot, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const NOW = DEMO_OVERVIEW_NOW;
const now = () => NOW;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const SCOPE = { workspaceId: 'demo-workspace', businessId: 'demo-business' };
const liveDeps = (opts: { asOf?: string | null } = {}) => createDemoOverviewDeps(demoRowsFromSnapshot(demoSnapshot('live')), now, opts);

test('data_stale is reachable through getBusinessOverview when the source data is old, and lastUpdatedAt is the data time', async () => {
  const old = iso(-STALE_AFTER_MS - 1);
  const o = await getBusinessOverview(liveDeps({ asOf: old }), SCOPE);
  assert.equal(o.state, 'data_stale');
  assert.equal(o.flags.stale, true);
  assert.equal(o.summary.lastUpdatedAt, old);
  assert.equal((await collectOverviewSnapshot(liveDeps({ asOf: old }), SCOPE)).collectedAt, old);
  // Exactly at the threshold, and a fresh copy, are not stale.
  assert.equal((await getBusinessOverview(liveDeps({ asOf: iso(-STALE_AFTER_MS) }), SCOPE)).state, 'live');
  assert.equal((await getBusinessOverview(liveDeps({ asOf: iso(-1000) }), SCOPE)).summary.lastUpdatedAt, iso(-1000));
});

test('freshness falls back to now when absent, null, unreadable or in the future', async () => {
  for (const asOf of [undefined, null, 'garbage', iso(60_000)]) {
    const o = await getBusinessOverview(liveDeps(asOf === undefined ? {} : { asOf }), SCOPE);
    assert.equal(o.state, 'live');
    assert.equal(o.summary.lastUpdatedAt, NOW.toISOString());
  }
});

test('freshness is asked with the full scope, and the other five unscoped-record deps get it too', async () => {
  const seen: Record<string, unknown[]> = {};
  const base = liveDeps();
  const spy = <T>(name: string, read: (s: OverviewScope) => Promise<T>) => async (s: OverviewScope) => { (seen[name] ??= []).push(s); return read(s); };
  const spied: OverviewDeps = {
    ...base,
    seller: { readiness: spy('seller', base.seller.readiness) },
    store: { get: spy('store', base.store.get) },
    steps: { get: spy('steps', base.steps.get) },
    automation: { approvals: spy('approvals', base.automation.approvals), activity: spy('activity', base.automation.activity) },
    freshness: { asOf: spy('freshness', async () => null) },
  };
  const other = { workspaceId: 'demo-workspace', businessId: 'someone-else' };
  for (const scope of [SCOPE, other]) await collectOverviewSnapshot(spied, scope);
  for (const name of ['seller', 'store', 'steps', 'approvals', 'activity', 'freshness']) {
    assert.deepEqual(seen[name], [SCOPE, other], `${name} must receive workspaceId and businessId`);
  }
});

test('summary.delivery leaves out deliveries of refunded orders, in any state', () => {
  const s = demoSnapshot('live');
  // ord_4 is refunded; give it a delivery in each non-revoked state and count only the three real deliveries.
  for (const status of ['queued', 'failed', 'needs_review', 'delivered'] as const) {
    const o = buildBusinessOverview({ ...s, deliveries: s.deliveries.map((d) => (d.orderId === 'ord_4' ? { ...d, status } : d)) }, NOW);
    assert.deepEqual(o.summary.delivery, { delivered: 3, pending: 0, failed: 0 }, status);
    assert.ok(!o.needsYou.some((n) => n.id === 'delivery:ord_4'), status);
  }
});

test('a partial refund counts only against a paid order in the snapshot', () => {
  const s = demoSnapshot('live'); // ord_1..3 paid, ord_4 refunded
  const ev = (eventId: string, orderId: string) => ({ eventId, kind: 'partial_refund' as const, orderId, amountMinor: 250, needsOwner: false, at: iso(-1000) });
  const o = buildBusinessOverview({ ...s, moneyEvents: [ev('e_known', 'ord_1'), ev('e_unknown', 'ord_missing'), ev('e_refunded', 'ord_4')] }, NOW);
  assert.deepEqual(o.summary.refunds, [{ currency: 'AUD', amountMinor: 1200 + 250 }]);
});

test('hrefs: a hostile business id is refused and record ids are encoded', () => {
  for (const bad of ['../x', 'a/b', 'a?b', '..', '.', '', 'a b', 'x#y', '%2e%2e', 'a'.repeat(101)]) {
    assert.throws(() => overviewHref(bad, 'orders'), OverviewError, bad);
    assert.throws(() => buildBusinessOverview({ ...demoSnapshot('live'), businessId: bad }, NOW), OverviewError, bad);
  }
  assert.equal(overviewHref('biz_1', 'orders', 'ord/../x?y'), '/app/biz_1/orders/ord%2F..%2Fx%3Fy');
  assert.equal(overviewHref('biz_1', 'orders', '..'), '/app/biz_1/orders/_');
  // Through the builder: an order id with a slash cannot add a path segment.
  const s = demoSnapshot('degraded_checkout');
  s.orders = s.orders.map((o) => (o.id === 'ord_2' ? { ...o, id: 'ord/2?x' } : o));
  s.deliveries = s.deliveries.map((d) => (d.orderId === 'ord_2' ? { ...d, orderId: 'ord/2?x' } : d));
  const item = buildBusinessOverview(s, NOW).needsYou.find((n) => n.category === 'delivery');
  assert.equal(item?.href, '/app/demo-business/orders/ord%2F2%3Fx');
});

test('collect refuses a scope with a hostile id before any read', async () => {
  let reads = 0;
  const base = liveDeps();
  const deps: OverviewDeps = { ...base, orders: { list: async (s) => { reads += 1; return base.orders.list(s); } } };
  for (const bad of ['..', '.', '../x']) await assert.rejects(collectOverviewSnapshot(deps, { workspaceId: 'ws', businessId: bad }), OverviewError);
  assert.equal(reads, 0);
});

test('an approval with an unreadable expiry does not throw and still asks the owner', () => {
  const s = demoSnapshot('live');
  const a = s.approvals[0];
  for (const expiresAt of [Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1]) {
    const o = buildBusinessOverview({ ...s, approvals: [{ ...a, expiresAt }] }, NOW);
    const item = o.needsYou.find((n) => n.id === 'approval:apr_1');
    assert.ok(item);
    assert.equal(item.impact.includes('Invalid'), false);
    if (Number.isNaN(expiresAt)) assert.match(item?.impact ?? '', /will run out if you wait/);
  }
});
