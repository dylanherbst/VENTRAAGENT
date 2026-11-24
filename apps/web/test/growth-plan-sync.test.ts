import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGrowthPlanRaw } from '../lib/growth-plan-sync.ts';

const plan = { version: 1, profileId: 'biz-1', title: 'Spring push', plan: 'Share two posts a week.', task: 'Review the follow-up list.', contactId: 'c1', conceptId: 'k1', mode: 'review-only', evidenceRevision: 2, updatedAt: '2026-11-04T00:00:00.000Z' };

test('a valid growth plan passes for its own business only', () => {
  checkGrowthPlanRaw(JSON.stringify(plan), 'biz-1');
  assert.throws(() => checkGrowthPlanRaw(JSON.stringify(plan), 'biz-2'));
});
test('invalid growth plans are rejected', () => {
  assert.throws(() => checkGrowthPlanRaw('nope', 'biz-1'));
  assert.throws(() => checkGrowthPlanRaw(JSON.stringify({ ...plan, mode: 'auto-send' }), 'biz-1'));
  assert.throws(() => checkGrowthPlanRaw(JSON.stringify({ ...plan, title: '' }), 'biz-1'));
  assert.throws(() => checkGrowthPlanRaw(JSON.stringify({ ...plan, evidenceRevision: 0 }), 'biz-1'));
});
