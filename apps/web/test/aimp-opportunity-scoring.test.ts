import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringFactors, type Opportunity } from '../lib/aimp/contracts.ts';
import { scoreOpportunity, shortlist, weights } from '../lib/aimp/opportunity-scoring.ts';

const ev = [{ source: 'test', note: 'search volume', retrievedAt: '2026-11-12T00:00:00.000Z' }];
const make = (niche: string, s: number, o: Partial<Opportunity> = {}): Opportunity => ({
  blueprintId: 'bp', blueprintVersion: 1, niche, model: 'digital-templates',
  factors: Object.fromEntries(scoringFactors.map((f) => [f, { score: s, confidence: 'high', evidence: ev }])) as Opportunity['factors'],
  estimatedStartupCostMinor: 0, estimatedMonthlyCostMinor: 0, weeklyHours: 2, channels: ['pinterest'], uncertainty: [], ...o,
});

test('weights sum to 1', () => {
  assert.equal(Math.round(Object.values(weights).reduce((a, b) => a + b, 0) * 1000), 1000);
});
test('perfect and zero scores map to 100 and 0', () => {
  assert.equal(scoreOpportunity(make('a', 10)).score, 100);
  assert.equal(scoreOpportunity(make('a', 0)).score, 0);
});
test('confidence is the weakest factor', () => {
  const o = make('a', 5);
  o.factors.differentiation = { ...o.factors.differentiation, confidence: 'low' };
  assert.equal(scoreOpportunity(o).confidence, 'low');
});
test('missing demand evidence or invalid scores are excluded, never guessed', () => {
  const o = make('a', 8); o.factors.demand = { ...o.factors.demand, evidence: [] };
  assert.equal(scoreOpportunity(o).excludedReason, 'No demand evidence');
  assert.match(scoreOpportunity(make('b', 11)).excludedReason ?? '', /Invalid/);
});
test('shortlist returns top five, deterministic on ties', () => {
  const list = shortlist([make('z', 5), make('a', 5), make('m', 9), make('x', 1), make('y', 2), make('q', 3), make('bad', 12)]);
  assert.deepEqual(list.map((s) => s.opportunity.niche), ['m', 'a', 'z', 'q', 'y']);
});
