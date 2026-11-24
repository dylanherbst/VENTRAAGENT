import assert from 'node:assert/strict';
import test from 'node:test';
import { createFunnelStore, funnelView } from '../lib/aimp/funnel/funnel.ts';

const now = new Date('2026-11-22T10:00:00Z');
const S = (n: number) => `session_${String(n).padStart(10, '0')}`;

test('one visit per session per day, per business; bad input is ignored', () => {
  const f = createFunnelStore();
  assert.equal(f.record('b1', 'visit', S(1), now), true);
  assert.equal(f.record('b1', 'visit', S(1), now), false);
  f.record('b1', 'visit', S(2), now);
  f.record('b1', 'checkout_click', S(2), now);
  f.record('b2', 'visit', S(3), now);
  assert.equal(f.record('b1', 'visit', 'short', now), false);
  assert.equal(f.record('b1', 'paid' as never, S(4), now), false);
  assert.deepEqual(f.counts('b1', 30, now), { visit: 2, checkout_click: 1 });
  assert.deepEqual(f.counts('b2', 30, now), { visit: 1, checkout_click: 0 });
  f.record('b1', 'visit', S(5), new Date('2026-09-01T00:00:00Z'));
  assert.equal(f.counts('b1', 30, now).visit, 2, 'old visits fall out of the window');
});

test('funnel view says where people drop off, in plain words', () => {
  assert.match(funnelView({ visits: 0, checkoutClicks: 0, paidOrders: 0 }).biggestDrop, /No visits yet/);
  assert.match(funnelView({ visits: 50, checkoutClicks: 0, paidOrders: 0 }).biggestDrop, /nobody has pressed Buy/);
  assert.match(funnelView({ visits: 50, checkoutClicks: 5, paidOrders: 0 }).biggestDrop, /nobody has paid/);
  const v = funnelView({ visits: 100, checkoutClicks: 10, paidOrders: 5 });
  assert.equal(v.clickRate, 10); assert.equal(v.payRate, 50);
  assert.match(v.biggestDrop, /before pressing Buy \(90%/);
});
