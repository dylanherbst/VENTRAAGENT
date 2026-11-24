import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBusinessOverview, formatMoney, MAX_NEEDS_YOU, overviewStates, STALE_AFTER_MS, STUCK_DELIVERY_MS,
} from '../lib/aimp/overview/index.ts';
import type { OverviewSnapshot } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoExpired, demoNotConnected, demoReady, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const NOW = DEMO_OVERVIEW_NOW;
const MIN = 60_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const build = (s: OverviewSnapshot) => buildBusinessOverview(s, NOW);
const ids = (o: ReturnType<typeof build>) => o.needsYou.map((n) => n.id);

test('every fixture state is reached by its own snapshot', () => {
  for (const st of overviewStates) assert.equal(build(demoSnapshot(st)).state, st);
});

test('new setup: not published, launch progress from persisted steps, next step is the setup item', () => {
  const o = build(demoSnapshot('new_setup'));
  assert.equal(o.flags.storePublished, false);
  assert.equal(o.summary.storeUrl, null);
  assert.deepEqual(o.launchProgress.steps.map((x) => x.id), ['idea', 'brand', 'product', 'catalogue', 'store', 'payments', 'first_order']);
  assert.equal(o.launchProgress.done, 2);
  assert.equal(o.launchProgress.total, 7);
  assert.equal(o.launchProgress.nextStep?.id, 'product');
  assert.ok(ids(o).includes('setup:product'));
  // Payments before publishing is a setup step, not a checkout emergency.
  const pay = o.needsYou.find((n) => n.id === 'seller:not_connected');
  assert.equal(pay?.category, 'setup');
  assert.match(o.dailyBrief.lines[0].text, /not live yet\. 2 of 7/);
});

test('live: sums, delivery counts and no needs-you noise from a healthy business', () => {
  const o = build(demoSnapshot('live'));
  assert.equal(o.state, 'live');
  assert.equal(o.summary.orders, 4);
  assert.deepEqual(o.summary.grossSales, [{ currency: 'AUD', amountMinor: 1200 * 3 + 1900 }]);
  assert.deepEqual(o.summary.refunds, [{ currency: 'AUD', amountMinor: 1200 }]);
  assert.deepEqual(o.summary.delivery, { delivered: 3, pending: 0, failed: 0 });
  // Only the pending approval needs the owner.
  assert.deepEqual(o.needsYou.map((n) => [n.category, n.id]), [['approval', 'approval:apr_1']]);
  assert.equal(o.launchProgress.done, 7);
  assert.equal(o.launchProgress.nextStep, null);
});

test('zero orders: published and ready, with explicit zero totals in the business currency', () => {
  const o = build(demoSnapshot('zero_orders'));
  assert.equal(o.state, 'zero_orders');
  assert.equal(o.summary.orders, 0);
  assert.deepEqual(o.summary.grossSales, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.deepEqual(o.summary.refunds, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.equal(o.launchProgress.nextStep?.id, 'first_order');
  assert.equal(o.needsYou.length, 0);
  assert.match(o.dailyBrief.lines.map((l) => l.text).join(' '), /No orders yet/);
  assert.match(o.dailyBrief.lines.map((l) => l.text).join(' '), /Nothing needs you right now/);
});

test('data stale: older than the threshold, and exactly at the threshold is still fresh', () => {
  const live = demoSnapshot('live');
  assert.equal(build({ ...live, collectedAt: iso(-STALE_AFTER_MS) }).state, 'live');
  const stale = build({ ...live, collectedAt: iso(-STALE_AFTER_MS - 1) });
  assert.equal(stale.state, 'data_stale');
  assert.equal(stale.flags.stale, true);
  assert.equal(stale.summary.lastUpdatedAt, iso(-STALE_AFTER_MS - 1));
  assert.match(stale.dailyBrief.lines[0].text, /may be out of date/);
  assert.equal(build({ ...live, collectedAt: 'not a date' }).state, 'data_stale');
});

test('stale does not hide a checkout problem: the flag and the needs-you item remain', () => {
  const s = { ...demoSnapshot('degraded_checkout'), collectedAt: iso(-3 * 60 * MIN) };
  const o = build(s);
  assert.equal(o.state, 'data_stale');
  assert.equal(o.flags.checkoutDegraded, true);
  assert.equal(o.needsYou[0].category, 'checkout');
});

test('degraded checkout: expired payment state gives a concrete action, ranked first, with its destination', () => {
  const o = build(demoSnapshot('degraded_checkout'));
  assert.equal(o.state, 'degraded_checkout');
  const first = o.needsYou[0];
  assert.equal(first.category, 'checkout');
  assert.equal(first.severity, 'critical');
  assert.equal(first.action, 'Send Stripe the missing details');
  assert.equal(first.href, '/app/demo-business/payments');
  assert.match(first.impact, /buyers cannot pay/);
  assert.match(first.impact, /a bank account for payouts/);
  assert.equal(first.source.kind, 'seller');
});

test('a failed delivery produces a concrete action on the order', () => {
  const o = build(demoSnapshot('degraded_checkout'));
  const d = o.needsYou.find((n) => n.id === 'delivery:ord_2');
  assert.ok(d);
  assert.equal(d.category, 'delivery');
  assert.equal(d.severity, 'critical');
  assert.equal(d.action, 'Open the order and fix the delivery');
  assert.equal(d.href, '/app/demo-business/orders/ord_2');
  assert.match(d.impact, /product file is missing/);
  assert.deepEqual(o.summary.delivery, { delivered: 1, pending: 0, failed: 1 });
});

test('ranking: checkout, delivery, money, approval, blocker, setup; then severity; then id', () => {
  const s = demoSnapshot('degraded_checkout');
  s.store = { ...s.store, lastPublishFailed: true };
  s.moneyEvents = [{ eventId: 'evt_b', kind: 'dispute', orderId: 'ord_1', amountMinor: null, needsOwner: true, at: iso(-MIN) }];
  s.steps = { ...s.steps, catalogueApproved: false };
  s.activity = [{
    id: 'act_1', at: NOW.getTime(), source: 'job', status: 'failed', label: 'Failed', title: 'Product generation failed', detail: 'The AI provider did not answer.',
    area: 'product-generation', needsOwner: true, nextAction: 'Retry the job', nextRetryAt: null, approvalId: null, jobId: 'job_1',
  }];
  const o = build(s);
  assert.deepEqual(o.needsYou.map((n) => n.category), ['checkout', 'delivery', 'money', 'approval', 'blocker', 'blocker', 'setup']);
  assert.deepEqual(o.needsYou.map((n) => n.rank), [1, 2, 3, 4, 5, 6, 7]);
  const blockers = o.needsYou.filter((n) => n.category === 'blocker');
  assert.deepEqual(blockers.map((n) => n.id), ['activity:act_1', 'store:publish_failed']); // same severity: id order
  assert.equal(blockers[0].href, '/app/demo-business/products');
});

test('ranking tiebreak is deterministic: severity, then id, whatever order the input arrives in', () => {
  const s = demoSnapshot('live');
  s.approvals = [];
  const stuck = (id: string) => ({ id, title: 'Planner', status: 'paid' as const, amountMinor: 500, currency: 'AUD', createdAt: iso(-3 * 60 * MIN), paidAt: iso(-3 * 60 * MIN) });
  s.orders = [stuck('ord_z'), stuck('ord_a'), stuck('ord_m')];
  s.deliveries = [];
  const forward = ids(build(s));
  const reversed = ids(build({ ...s, orders: [...s.orders].reverse() }));
  assert.deepEqual(forward, ['delivery:ord_a', 'delivery:ord_m', 'delivery:ord_z']);
  assert.deepEqual(reversed, forward);
  // A failed (retryable) delivery ranks below a delivery the owner has to fix, even with a smaller id.
  s.deliveries = [
    { orderId: 'ord_a', status: 'failed', attempts: 1, maxAttempts: 3, lastError: 'email_failed', updatedAt: iso(-MIN) },
    { orderId: 'ord_z', status: 'needs_review', attempts: 3, maxAttempts: 3, lastError: 'file_changed', updatedAt: iso(-MIN) },
  ];
  assert.deepEqual(ids(build(s)).slice(0, 2), ['delivery:ord_z', 'delivery:ord_a']);
});

test('a paid order with no delivery record is pending, and stuck only after the threshold', () => {
  const s = demoSnapshot('live');
  s.approvals = [];
  const paidAt = (agoMs: number) => ({ id: 'ord_new', title: 'Planner', status: 'paid' as const, amountMinor: 500, currency: 'AUD', createdAt: iso(-agoMs), paidAt: iso(-agoMs) });
  s.orders = [paidAt(STUCK_DELIVERY_MS)];
  s.deliveries = [];
  let o = build(s);
  assert.equal(o.summary.delivery.pending, 1);
  assert.equal(o.needsYou.length, 0);
  s.orders = [paidAt(STUCK_DELIVERY_MS + 1)];
  o = build(s);
  assert.deepEqual(ids(o), ['delivery:ord_new']);
});

test('refunded orders do not raise delivery items', () => {
  const s = demoSnapshot('live');
  s.approvals = [];
  s.deliveries = [
    ...s.deliveries.filter((d) => d.orderId !== 'ord_4'),
    { orderId: 'ord_4', status: 'needs_review', attempts: 3, maxAttempts: 3, lastError: 'file_missing', updatedAt: iso(-MIN) },
  ];
  assert.equal(build(s).needsYou.length, 0);
});

test('seller states map to checkout when published and to setup when not', () => {
  const published = demoSnapshot('zero_orders');
  for (const [seller, sev, label] of [
    [demoNotConnected(), 'high', 'Connect Stripe'],
    [demoExpired(), 'critical', 'Send Stripe the missing details'],
  ] as const) {
    const o = build({ ...published, seller });
    assert.equal(o.needsYou[0].category, 'checkout');
    assert.equal(o.needsYou[0].severity, sev);
    assert.equal(o.needsYou[0].action, label);
    assert.equal(o.state, 'degraded_checkout');
  }
  assert.equal(build({ ...published, seller: demoReady() }).needsYou.length, 0);
});

test('an expired or already decided approval is not asked for', () => {
  const s = demoSnapshot('live');
  const [a] = s.approvals;
  s.approvals = [{ ...a, id: 'old', expiresAt: NOW.getTime() }, { ...a, id: 'done', status: 'approved' }];
  assert.equal(build(s).needsYou.length, 0);
});

test('currency and refund sums: per currency, refunded orders once, partial refunds once per event', () => {
  const s = demoSnapshot('zero_orders');
  const o = (id: string, amountMinor: number, currency: string, status: 'paid' | 'refunded' | 'pending') => ({ id, title: id, status, amountMinor, currency, createdAt: iso(-5 * MIN), paidAt: status === 'pending' ? null : iso(-4 * MIN) });
  s.orders = [o('a', 1000, 'AUD', 'paid'), o('b', 2500, 'AUD', 'refunded'), o('c', 700, 'USD', 'paid'), o('d', 9999, 'AUD', 'pending')];
  s.deliveries = [];
  s.moneyEvents = [
    { eventId: 'e1', kind: 'partial_refund', orderId: 'a', amountMinor: 300, needsOwner: true, at: iso(-MIN) },
    { eventId: 'e1', kind: 'partial_refund', orderId: 'a', amountMinor: 300, needsOwner: true, at: iso(-MIN) }, // replayed event
    { eventId: 'e2', kind: 'partial_refund', orderId: 'c', amountMinor: 200, needsOwner: false, at: iso(-MIN) },
    { eventId: 'e3', kind: 'partial_refund', orderId: 'b', amountMinor: 100, needsOwner: false, at: iso(-MIN) }, // order already fully refunded
    { eventId: 'e4', kind: 'refund', orderId: 'b', amountMinor: 2500, needsOwner: false, at: iso(-MIN) }, // full refund event: the order status counts it
  ];
  const sum = build(s).summary;
  assert.equal(sum.orders, 3); // pending is not an order yet
  assert.deepEqual(sum.grossSales, [{ currency: 'AUD', amountMinor: 3500 }, { currency: 'USD', amountMinor: 700 }]);
  assert.deepEqual(sum.refunds, [{ currency: 'AUD', amountMinor: 2800 }, { currency: 'USD', amountMinor: 200 }]);
});

test('money formatting', () => {
  assert.equal(formatMoney({ amountMinor: 1250, currency: 'AUD' }), 'A$12.50');
  assert.equal(formatMoney({ amountMinor: 1200, currency: 'AUD' }), 'A$12');
  assert.equal(formatMoney({ amountMinor: 5, currency: 'USD' }), 'US$0.05');
  assert.equal(formatMoney({ amountMinor: -300, currency: 'AUD' }), '-A$3');
  assert.equal(formatMoney({ amountMinor: 500, currency: 'JPY' }), 'JPY 500'); // AMP-092: JPY has no minor unit, so 500 is five hundred yen, not 5
});

test('missing analytics is unknown, never zero; a source with zero visits is a known zero', () => {
  const s = demoSnapshot('live');
  assert.deepEqual(build({ ...s, analytics: null }).summary.visits, { known: false });
  assert.deepEqual(build({ ...s, analytics: { visits: 0 } }).summary.visits, { known: true, value: 0 });
  assert.deepEqual(build({ ...s, analytics: { visits: 42 } }).summary.visits, { known: true, value: 42 });
  const brief = (a: OverviewSnapshot['analytics']) => build({ ...s, analytics: a }).dailyBrief.lines.map((l) => l.text).join(' ');
  assert.match(brief(null), /Visits are not tracked yet, so traffic is unknown/);
  assert.match(brief({ visits: 42 }), /42 visits recorded/);
});

test('the overview is bounded and deterministic', () => {
  const s = demoSnapshot('live');
  s.approvals = Array.from({ length: 20 }, (_, i) => ({ ...demoSnapshot('live').approvals[0], id: `apr_${String(i).padStart(2, '0')}` }));
  s.activity = Array.from({ length: 30 }, (_, i) => ({ ...demoSnapshot('live').activity[0], id: `act_${i}`, at: NOW.getTime() - i * MIN }));
  const a = build(s);
  assert.equal(a.needsYou.length, MAX_NEEDS_YOU);
  assert.equal(a.needsYouTotal, 20);
  assert.equal(a.recentActivity.length, 10);
  assert.equal(a.recentActivity[0].id, 'act_0');
  assert.ok(a.dailyBrief.lines.length <= 6);
  assert.deepEqual(build(s), a);
  assert.equal(a.generatedAt, NOW.toISOString());
});

test('daily brief lines link to their records and every link is under the business', () => {
  for (const st of overviewStates) {
    const o = build(demoSnapshot(st));
    for (const l of o.dailyBrief.lines) {
      assert.ok(l.text.length > 0 && l.links.length > 0);
      for (const k of l.links) assert.ok(k.href.startsWith('/app/demo-business'), k.href);
    }
    for (const n of o.needsYou) assert.ok(n.href.startsWith('/app/demo-business'), n.href);
    for (const x of o.launchProgress.steps) assert.ok(x.href.startsWith('/app/demo-business'), x.href);
  }
  const top = build(demoSnapshot('degraded_checkout'));
  const first = top.dailyBrief.lines.at(-1);
  assert.ok(first?.text.startsWith('First thing to do: Payments are switched off'));
  assert.deepEqual(first?.links[0], { kind: 'needs_you', id: top.needsYou[0].id, href: top.needsYou[0].href });
});
