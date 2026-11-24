import assert from 'node:assert/strict';
import test from 'node:test';
import type { Deal } from '../lib/local-crm-pipeline.ts';
import { dealsWithoutValue, describeReport, lostValue, monthlyBreakdown, openPipelineValue, totalsByStage, winRate, wonValue } from '../lib/sales-report.ts';

let n = 0;
const d = (o: Partial<Deal>): Deal => ({ version: 1, id: `d${++n}`, profileId: 'p', contactId: 'c', title: 't', stage: 'new', valueMinor: 1000, currency: 'AUD', updatedAt: '2026-05-10T00:00:00.000Z', ...o });

test('totals per stage and currency, never across currencies', () => {
  const deals = [d({ valueMinor: 1050 }), d({ valueMinor: 250 }), d({ valueMinor: 999, currency: 'USD' }), d({ stage: 'won', valueMinor: 5000 })];
  const t = totalsByStage(deals);
  assert.equal(t.length, 5);
  assert.deepEqual(t[0].value, { AUD: 1300, USD: 999 });
  assert.equal(t[0].count, 3);
  assert.deepEqual(wonValue(deals), { AUD: 5000 });
  assert.deepEqual(openPipelineValue(deals), { AUD: 1300, USD: 999 });
  assert.deepEqual(lostValue(deals), {});
});

test('open pipeline excludes won and lost', () => {
  const deals = [d({ stage: 'proposal', valueMinor: 100 }), d({ stage: 'lost', valueMinor: 900 }), d({ stage: 'won', valueMinor: 800 })];
  assert.deepEqual(openPipelineValue(deals), { AUD: 100 });
  assert.deepEqual(lostValue(deals), { AUD: 900 });
});

test('win rate edge cases', () => {
  assert.equal(winRate([]), null);
  assert.equal(winRate([d({ stage: 'new' })]), null);
  assert.equal(winRate([d({ stage: 'won' }), d({ stage: 'won' })]), 1);
  assert.equal(winRate([d({ stage: 'won' }), d({ stage: 'lost' }), d({ stage: 'lost' }), d({ stage: 'lost' })]), 0.25);
});

test('empty input', () => {
  assert.deepEqual(describeReport([]), ['No deals saved yet.']);
  assert.deepEqual(monthlyBreakdown([]), []);
  assert.ok(totalsByStage([]).every(r => r.count === 0));
});

test('deals without value are counted but add no money', () => {
  const deals = [d({ valueMinor: null }), d({ valueMinor: null, stage: 'won' }), d({ valueMinor: 100 })];
  assert.equal(dealsWithoutValue(deals), 2);
  assert.deepEqual(totalsByStage(deals)[0].value, { AUD: 100 });
  assert.deepEqual(wonValue(deals), {});
  assert.ok(describeReport(deals).some(s => s.startsWith('2 deals have no value')));
});

test('months use the UTC month of updatedAt, boundaries are exact', () => {
  const deals = [
    d({ updatedAt: '2026-01-31T23:59:59.999Z' }),
    d({ updatedAt: '2026-02-01T00:00:00.000Z' }),
    d({ updatedAt: '2026-02-28T23:59:59Z', stage: 'won' }),
    d({ updatedAt: '2025-12-31T23:30:00Z', stage: 'lost' }),
  ];
  const m = monthlyBreakdown(deals);
  assert.deepEqual(m.map(r => [r.month, r.count]), [['2025-12', 1], ['2026-01', 1], ['2026-02', 2]]);
  assert.equal(m[2].won, 1);
  assert.equal(m[0].lost, 1);
});

test('describeReport states money per currency in minor units', () => {
  const s = describeReport([d({ valueMinor: 12345 }), d({ currency: 'USD', valueMinor: 5 })]).join(' ');
  assert.match(s, /AUD 123\.45/);
  assert.match(s, /USD 0\.05/);
});
