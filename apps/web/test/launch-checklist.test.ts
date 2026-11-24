import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChecklistToProfile, checklistFromProfile, restoreChecklist } from '../lib/launch-checklist.ts';
import { blankProfile } from '../lib/onboarding.ts';

const profile = (completed: string[]) => JSON.stringify({ ...blankProfile(), name: 'Sample Studio', audience: 'Locals', goal: 'First customers', expertise: 'Coaching', completed });

test('checklist is read from the saved profile', () => {
  assert.deepEqual(JSON.parse(checklistFromProfile(profile(['a', 'b', 'a']))!), { version: 1, completed: ['a', 'b'] });
  assert.equal(checklistFromProfile(null), null);
  assert.equal(checklistFromProfile('{bad'), null);
});
test('restoreChecklist rejects bad shapes', () => {
  assert.throws(() => restoreChecklist(null));
  assert.throws(() => restoreChecklist('{bad'));
  assert.throws(() => restoreChecklist(JSON.stringify({ version: 2, completed: [] })));
  assert.throws(() => restoreChecklist(JSON.stringify({ version: 1, completed: [1] })));
  assert.throws(() => restoreChecklist(JSON.stringify({ version: 1, completed: ['a', 'a'] })));
  assert.throws(() => restoreChecklist(JSON.stringify({ version: 1, completed: Array.from({ length: 101 }, (_, i) => `s${i}`) })));
  assert.deepEqual(restoreChecklist(JSON.stringify({ version: 1, completed: ['a'] })), { version: 1, completed: ['a'] });
});
test('applying keeps other profile fields', () => {
  const out = JSON.parse(applyChecklistToProfile(profile(['a']), JSON.stringify({ version: 1, completed: ['x', 'y'] })));
  assert.deepEqual(out.completed, ['x', 'y']);
  assert.equal(out.name, 'Sample Studio');
  assert.throws(() => applyChecklistToProfile(null, JSON.stringify({ version: 1, completed: [] })));
  assert.throws(() => applyChecklistToProfile(profile([]), '{}'));
});
