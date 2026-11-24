// AMP-092: Business Overview money display and sums (H01).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessOverview, currencyDigits, formatMoney, formatMoneyList, isMinorAmount } from '../lib/aimp/overview/index.ts';
import type { OverviewMoneyEvent, OverviewOrder, OverviewSnapshot } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const NOW = DEMO_OVERVIEW_NOW;
const MIN = 60_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const sum = (s: OverviewSnapshot) => buildBusinessOverview(s, NOW).summary;
const order = (id: string, amountMinor: number, currency: string, status: OverviewOrder['status'] = 'paid'): OverviewOrder =>
  ({ id, title: id, status, amountMinor, currency, createdAt: iso(-5 * MIN), paidAt: iso(-4 * MIN) });
const refund = (eventId: string, orderId: string, amountMinor: number | null): OverviewMoneyEvent =>
  ({ eventId, kind: 'partial_refund', orderId, amountMinor, needsOwner: false, at: iso(-MIN) });
const snap = (orders: OverviewOrder[], moneyEvents: OverviewMoneyEvent[] = []): OverviewSnapshot =>
  ({ ...demoSnapshot('zero_orders'), currency: 'AUD', orders, deliveries: [], moneyEvents });

test('only currencies with sales are listed: USD-only sales in an AUD business show no AUD entry', () => {
  const s = sum(snap([order('a', 1000, 'USD'), order('b', 500, 'USD')], [refund('e1', 'a', 200)]));
  assert.deepEqual(s.grossSales, [{ currency: 'USD', amountMinor: 1500 }]);
  assert.deepEqual(s.refunds, [{ currency: 'USD', amountMinor: 200 }]);
});

test('sales but no refunds: refunds show an explicit zero only in the currencies that have sales', () => {
  const s = sum(snap([order('a', 1000, 'USD')]));
  assert.deepEqual(s.refunds, [{ currency: 'USD', amountMinor: 0 }]);
  const two = sum(snap([order('a', 1000, 'USD'), order('b', 900, 'EUR')]));
  assert.deepEqual(two.refunds, [{ currency: 'EUR', amountMinor: 0 }, { currency: 'USD', amountMinor: 0 }]);
});

test('no sales at all: one honest zero in the business currency (H01 contract), for sales and refunds', () => {
  const s = sum(snap([order('p', 900, 'USD', 'pending')]));
  assert.deepEqual(s.grossSales, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.equal(s.orders, 0);
});

test('currency decimals follow the currency: JPY and KRW have none, KWD has three, USD and AUD two', () => {
  assert.equal(currencyDigits('JPY'), 0);
  assert.equal(currencyDigits('KRW'), 0);
  assert.equal(currencyDigits('KWD'), 3);
  assert.equal(currencyDigits('USD'), 2);
  assert.equal(formatMoney({ amountMinor: 500, currency: 'JPY' }), 'JPY 500');
  assert.equal(formatMoney({ amountMinor: 1234567, currency: 'KRW' }), 'KRW 1234567');
  assert.equal(formatMoney({ amountMinor: -300, currency: 'JPY' }), '-JPY 300');
  assert.equal(formatMoney({ amountMinor: 1500, currency: 'KWD' }), 'KWD 1.500');
  assert.equal(formatMoney({ amountMinor: 1250, currency: 'USD' }), 'US$12.50');
  assert.equal(formatMoney({ amountMinor: 1200, currency: 'AUD' }), 'A$12');
  assert.equal(formatMoney({ amountMinor: 5, currency: 'USD' }), 'US$0.05');
  assert.equal(formatMoneyList([{ amountMinor: 500, currency: 'JPY' }, { amountMinor: 1250, currency: 'USD' }]), 'JPY 500 + US$12.50');
});

test('formatMoney shows a plain placeholder for an amount that is not whole minor units', () => {
  for (const bad of [10.5, NaN, Infinity, -Infinity]) assert.equal(formatMoney({ amountMinor: bad, currency: 'USD' }), 'amount unavailable', String(bad));
  assert.equal(formatMoney({ amountMinor: 1250, currency: 'USD' }), 'US$12.50');
  assert.equal(formatMoney({ amountMinor: 0, currency: 'AUD' }), 'A$0');
});

test('two sales currencies with a refund in only one: both entries present, the other is an explicit zero', () => {
  const s = sum(snap([order('a', 1000, 'AUD'), order('b', 700, 'USD')], [refund('e1', 'b', 200)]));
  assert.deepEqual(s.grossSales, [{ currency: 'AUD', amountMinor: 1000 }, { currency: 'USD', amountMinor: 700 }]);
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 0 }, { currency: 'USD', amountMinor: 200 }]);
});

test('a partial refund for an unknown order or an already fully refunded order is not counted', () => {
  const s = sum(snap([order('a', 1000, 'AUD'), order('f', 500, 'AUD', 'refunded')], [refund('e1', 'nope', 100), refund('e2', 'f', 100)]));
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 500 }]); // only the fully refunded order itself
  assert.equal(s.invalidAmounts, 0);
});

test('a paid order with an invalid amount is counted in orders, left out of totals and counted in invalidAmounts', () => {
  const s = sum(snap([order('a', 1000, 'AUD'), order('bad', 1.5, 'AUD')]));
  assert.equal(s.orders, 2);
  assert.deepEqual(s.grossSales, [{ currency: 'AUD', amountMinor: 1000 }]);
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.equal(s.invalidAmounts, 1);
});

test('a currency code Intl does not accept falls back to two decimals instead of throwing', () => {
  assert.equal(formatMoney({ amountMinor: 1250, currency: 'not a code' }), 'not a code 12.50');
});

test('isMinorAmount accepts only safe integers', () => {
  for (const ok of [0, 1, 1200, -5]) assert.equal(isMinorAmount(ok), true, String(ok));
  for (const bad of [1.5, NaN, Infinity, -Infinity, 2 ** 60, '12', null, undefined]) assert.equal(isMinorAmount(bad), false, String(bad));
});

test('an order amount that is not whole minor units is never summed, and is counted', () => {
  for (const bad of [10.5, NaN, Infinity, -Infinity, -100, 2 ** 60]) {
    const s = sum(snap([order('good', 1000, 'AUD'), order('bad', bad, 'AUD')]));
    assert.deepEqual(s.grossSales, [{ currency: 'AUD', amountMinor: 1000 }], String(bad));
    assert.equal(s.invalidAmounts, 1, String(bad));
    assert.equal(s.orders, 2, String(bad)); // the order was paid; only its amount is unusable
  }
  assert.equal(sum(snap([order('good', 1000, 'AUD')])).invalidAmounts, 0);
});

test('a refund event amount that is not whole non-negative minor units is never summed, and is counted', () => {
  for (const bad of [10.5, NaN, Infinity, -Infinity, -50]) {
    const s = sum(snap([order('a', 1000, 'AUD')], [refund('e1', 'a', 100), refund('e2', 'a', bad)]));
    assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 100 }], String(bad));
    assert.equal(s.invalidAmounts, 1, String(bad));
  }
  // A null amount is "unknown", skipped as before, and is not an invalid amount.
  assert.equal(sum(snap([order('a', 1000, 'AUD')], [refund('e1', 'a', null)])).invalidAmounts, 0);
});

test('an order with an invalid amount takes no partial refund', () => {
  const s = sum(snap([order('a', 10.5, 'AUD')], [refund('e1', 'a', 100)]));
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 0 }]);
});

test('a single partial refund larger than the order is capped at the order amount', () => {
  const s = sum(snap([order('a', 1000, 'AUD')], [refund('e1', 'a', 5000)]));
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 1000 }]);
  assert.deepEqual(s.grossSales, [{ currency: 'AUD', amountMinor: 1000 }]); // net is exactly zero, never negative
});

test('cumulative partial refunds for one order are capped at the order amount; other orders are unaffected', () => {
  const s = sum(snap(
    [order('a', 1000, 'AUD'), order('b', 800, 'AUD')],
    [refund('e1', 'a', 600), refund('e2', 'a', 600), refund('e3', 'a', 600), refund('e4', 'b', 300)],
  ));
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 1000 + 300 }]);
  const net = s.grossSales[0].amountMinor - s.refunds[0].amountMinor;
  assert.equal(net, 1800 - 1300);
});

test('a partial refund that exactly uses the order amount is allowed, and a replayed event still counts once', () => {
  const s = sum(snap([order('a', 1000, 'AUD')], [refund('e1', 'a', 400), refund('e1', 'a', 400), refund('e2', 'a', 600)]));
  assert.deepEqual(s.refunds, [{ currency: 'AUD', amountMinor: 1000 }]);
});
