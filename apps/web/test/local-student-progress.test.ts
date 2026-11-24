import test from 'node:test';
import assert from 'node:assert/strict';
import { addStudent, blankTracker, completionFor, lessonCompletion, persistTracker, reconcileLessons, removeStudent, restoreTracker, studentLimit, studentProgressStorageKey, toggleLesson, validateTracker } from '../lib/local-student-progress.ts';
import type { ProgressTracker } from '../lib/local-student-progress.ts';

const P = 'p1', C = 'c1';
const NOW = '2026-11-03T00:00:00Z';
const mem = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; } }; };
const stu = (id: string, over = {}) => ({ id, name: 'Ana', enrolledOn: '2026-10-01', ...over });
const base = (): ProgressTracker => addStudent(addStudent(blankTracker(P, C), stu('s1')), stu('s2', { name: 'Ben', email: 'ben@example.com', note: 'hi' }));

test('valid tracker and validation limits', () => {
  assert.deepEqual(validateTracker(base()).problems, []);
  const t = base();
  const bad = (s: object) => validateTracker({ ...t, students: [{ ...t.students[0], ...s }] }).problems.length > 0;
  assert.ok(bad({ name: '' })); assert.ok(bad({ name: 'x'.repeat(121) })); assert.ok(!bad({ name: 'x'.repeat(120) }));
  assert.ok(bad({ email: 'nope' })); assert.ok(bad({ note: 'x'.repeat(501) })); assert.ok(!bad({ note: 'x'.repeat(500) }));
  assert.ok(bad({ enrolledOn: '2026-02-30' })); assert.ok(bad({ enrolledOn: 'yesterday' }));
});
test('duplicate ids and duplicate completed ids are rejected', () => {
  const t = base();
  assert.ok(validateTracker({ ...t, students: [t.students[0], t.students[0]] }).problems.length);
  assert.ok(validateTracker({ ...t, students: [{ ...t.students[0], completed: ['a', 'a'] }] }).problems.length);
});
test('200-student cap', () => {
  let t = blankTracker(P, C);
  for (let i = 0; i < studentLimit; i++) t = addStudent(t, stu(`s${i}`));
  assert.equal(t.students.length, 200);
  assert.throws(() => addStudent(t, stu('extra')), /200/);
  assert.ok(validateTracker({ ...t, students: [...t.students, { ...t.students[0], id: 'x' }] }).problems.length);
});
test('completion math including zero lessons', () => {
  const s = { completed: ['a', 'b', 'gone'] };
  assert.deepEqual(completionFor(s, ['a', 'b', 'c']), { done: 2, total: 3, percentLabel: '2 of 3 lessons' });
  const z = completionFor(s, []);
  assert.equal(z.total, 0); assert.equal(z.done, 0); assert.ok(!/%|\d of/.test(z.percentLabel));
});
test('lessonCompletion counts students per lesson', () => {
  let t = toggleLesson(base(), 's1', 'a'); t = toggleLesson(t, 's2', 'a'); t = toggleLesson(t, 's2', 'b');
  assert.deepEqual(lessonCompletion(t, ['a', 'b', 'c']), [{ lessonId: 'a', count: 2 }, { lessonId: 'b', count: 1 }, { lessonId: 'c', count: 0 }]);
});
test('reconcile surfaces removed lessons and keeps them', () => {
  const t = toggleLesson(toggleLesson(base(), 's1', 'a'), 's1', 'old');
  const r = reconcileLessons(t, ['a']);
  assert.equal(r.orphaned, 1); assert.equal(r.label, '1 recorded lesson no longer in the course');
  assert.ok(t.students[0].completed.includes('old'));
  assert.equal(reconcileLessons(t, ['a', 'old']).orphaned, 0);
});
test('toggle and add/remove are immutable', () => {
  const t = base(); const snap = JSON.stringify(t);
  const t2 = toggleLesson(t, 's1', 'a');
  assert.equal(JSON.stringify(t), snap); assert.deepEqual(t2.students[0].completed, ['a']);
  assert.deepEqual(toggleLesson(t2, 's1', 'a').students[0].completed, []);
  assert.equal(removeStudent(t, 's1').students.length, 1); assert.equal(t.students.length, 2);
  assert.throws(() => toggleLesson(t, 'nope', 'a'));
});
test('restore and compare-and-set persist', () => {
  const m = mem();
  assert.equal(restoreTracker(null, P), null);
  const raw1 = persistTracker(m, P, null, base(), NOW);
  const back = restoreTracker(raw1, P) as ProgressTracker;
  assert.equal(back.revision, 1); assert.equal(back.students.length, 2);
  assert.equal(m.d[studentProgressStorageKey(P)], raw1);
  assert.throws(() => persistTracker(m, P, null, back, NOW), /another tab/);
  const raw2 = persistTracker(m, P, raw1, back, NOW);
  assert.equal((restoreTracker(raw2, P) as ProgressTracker).revision, 2);
});
test('restore throws on invalid and never writes', () => {
  assert.throws(() => restoreTracker('{', P));
  assert.throws(() => restoreTracker('[]', P));
  assert.throws(() => restoreTracker(JSON.stringify(base()), 'other'));
  assert.throws(() => restoreTracker(JSON.stringify({ ...base(), students: [{ id: 's', name: '', enrolledOn: '2026-01-01', completed: [] }] }), P));
  const m = mem();
  assert.throws(() => persistTracker(m, P, null, { ...base(), students: [{ id: 's', name: '', enrolledOn: '2026-01-01', completed: [] }] }, NOW));
  assert.deepEqual(m.d, {});
});
