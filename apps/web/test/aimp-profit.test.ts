import assert from 'node:assert/strict';
import test from 'node:test';
import { profit } from '../lib/aimp/preview/profit.ts';

test('fees, plan and break-even add up', () => {
  const r = profit({ priceMinor: 900, salesPerMonth: 20, planMinor: 7900, gstRegistered: false });
  assert.equal(r.grossMinor, 18000);
  assert.equal(r.cardFeesMinor, 20 * (Math.round(900 * 0.0165) + 30));
  assert.equal(r.profitMinor, 18000 - r.cardFeesMinor - 7900);
  assert.equal(r.breakEvenSales, Math.ceil(7900 / r.perSaleMinor));
});
test('GST-registered sellers remit 1/11 of sales', () => {
  assert.equal(profit({ priceMinor: 1100, salesPerMonth: 10, planMinor: 0, gstRegistered: true }).gstMinor, 1000);
});
test('no sales means the plan is a loss, never a made-up profit', () => {
  assert.equal(profit({ priceMinor: 900, salesPerMonth: 0, planMinor: 7900, gstRegistered: false }).profitMinor, -7900);
});
