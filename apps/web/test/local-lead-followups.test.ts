import test from 'node:test';
import assert from 'node:assert/strict';
import { addFollowUp, blankFollowUps, followUpCounts, followUpState, followupLimit, missingContacts, persistFollowUps, removeFollowUp, restoreFollowUps, toggleFollowUp, validateFollowUps } from '../lib/local-lead-followups.ts';

const P = 'p1';
const NOW = '2026-11-03T00:00:00Z';
const mem = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; } }; };
const base = () => addFollowUp(addFollowUp(blankFollowUps(P), { id: 't1', contactId: 'c1', title: ' Call Ana ', dueOn: '2026-11-02' }), { id: 't2', contactId: 'c2', title: 'Send quote by hand', assignee: 'Sam', dueOn: '2026-11-10', note: 'n' });

test('valid list, trimming and validation limits', () => {
  assert.deepEqual(validateFollowUps(base()).problems, []);
  assert.equal(base().tasks[0].title, 'Call Ana');
  const l = base();
  const bad = (o: object) => validateFollowUps({ ...l, tasks: [{ ...l.tasks[0], ...o }] }).problems.length > 0;
  assert.ok(bad({ title: '' })); assert.ok(bad({ title: 'x'.repeat(161) })); assert.ok(!bad({ title: 'x'.repeat(160) }));
  assert.ok(bad({ dueOn: '2026-02-30' })); assert.ok(bad({ contactId: '' })); assert.ok(bad({ assignee: 'x'.repeat(81) })); assert.ok(bad({ note: 'x'.repeat(501) })); assert.ok(bad({ done: 'no' }));
  assert.ok(validateFollowUps({ ...l, tasks: [l.tasks[0], l.tasks[0]] }).problems.length);
});
test('cap', () => {
  let l = blankFollowUps(P);
  for (let i = 0; i < followupLimit; i++) l = addFollowUp(l, { id: `t${i}`, contactId: 'c', title: 'x' });
  assert.throws(() => addFollowUp(l, { id: 'z', contactId: 'c', title: 'x' }), /Up to 300/);
});
test('toggle, remove, states and counts use calendar dates', () => {
  let l = base();
  assert.equal(followUpState(l.tasks[0], '2026-11-03'), 'overdue');
  assert.equal(followUpState(l.tasks[0], '2026-11-02'), 'due-today');
  assert.equal(followUpState(l.tasks[1], '2026-11-03'), 'upcoming');
  assert.equal(followUpState({ done: false }, '2026-11-03'), 'no-date');
  l = toggleFollowUp(l, 't1');
  assert.equal(followUpState(l.tasks[0], '2026-11-03'), 'done');
  assert.deepEqual(followUpCounts(l, '2026-11-03'), { done: 1, overdue: 0, 'due-today': 0, upcoming: 1, 'no-date': 0 });
  assert.throws(() => toggleFollowUp(l, 'nope'), /not found/);
  assert.equal(removeFollowUp(l, 't1').tasks.length, 1);
});
test('missing contacts are reported, not deleted', () => {
  assert.deepEqual(missingContacts(base(), ['c1']).map(t => t.id), ['t2']);
  assert.equal(base().tasks.length, 2);
});
test('restore is strict and null when empty', () => {
  assert.equal(restoreFollowUps(null, P), null);
  assert.throws(() => restoreFollowUps('nope', P), /Nothing was overwritten/);
  assert.throws(() => restoreFollowUps('[]', P), /Nothing was overwritten/);
  assert.throws(() => restoreFollowUps(JSON.stringify(base()), 'other'), /Nothing was overwritten/);
  assert.throws(() => restoreFollowUps('x'.repeat(120001), P), /too large/);
  assert.deepEqual(restoreFollowUps(JSON.stringify(base()), P)?.tasks.length, 2);
});
test('persist bumps revision, round-trips and refuses stale writes', () => {
  const s = mem();
  const raw = persistFollowUps(s, P, null, base(), NOW);
  assert.equal(restoreFollowUps(raw, P)?.revision, 1);
  const raw2 = persistFollowUps(s, P, raw, restoreFollowUps(raw, P)!, NOW);
  assert.equal(restoreFollowUps(raw2, P)?.revision, 2);
  assert.throws(() => persistFollowUps(s, P, raw, base(), NOW), /another tab/);
  assert.throws(() => persistFollowUps(mem(), P, null, { ...base(), profileId: 'x' }, NOW), /another profile/);
  assert.throws(() => persistFollowUps(mem(), P, null, base(), 'bad'), /time/);
});
