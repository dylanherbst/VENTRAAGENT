import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortalPreview, UNREADABLE } from '../lib/learner-portal-preview.ts';
import { addStudent, blankTracker, toggleLesson } from '../lib/local-student-progress.ts';
import type { EducationCourseDraft } from '../lib/local-education-course.ts';

const course = (): EducationCourseDraft => ({
  version: 1, id: 'c1', profileId: 'p1', updatedAt: '2026-11-01T00:00:00Z', title: 'Intro', summary: 'S',
  lessons: [
    { id: 'l1', title: 'One', content: 'A', durationMinutes: 5, quizDraft: { questions: [{ id: 'q1', prompt: 'Which?', options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }], correctOptionId: 'o1', authorNotes: 'SECRET-AUTHOR-NOTE' }] } },
    { id: 'l2', title: 'Two', content: 'B' },
    { id: 'l3', title: 'Three', content: 'C' },
  ],
});
const tracker = () => {
  let t = addStudent(blankTracker('p1', 'c1'), { id: 's1', name: 'Ana', email: 'ana@example.com', enrolledOn: '2026-10-01', note: 'PRIVATE-NOTE' });
  t = addStudent(t, { id: 's2', name: 'Ben', enrolledOn: '2026-10-02' });
  return toggleLesson(toggleLesson(t, 's1', 'l1'), 's2', 'l2');
};

test('preview shows the picked learner only, with the next lesson and counts', () => {
  const p = buildPortalPreview({ course: course(), tracker: tracker(), studentId: 's1' });
  assert.equal(p.course.status, 'ok');
  assert.equal(p.view?.studentName, 'Ana');
  assert.equal(p.view?.progressLabel, '1 of 3 lessons');
  assert.equal(p.view?.nextLessonTitle, 'Two');
  assert.deepEqual(p.view?.lessons.map(l => [l.number, l.done, l.current]), [[1, true, false], [2, false, true], [3, false, false]]);
  assert.equal(p.view?.allDone, false);
});
test('nothing private reaches the preview: answers, author notes, emails, notes, other students', () => {
  const json = JSON.stringify(buildPortalPreview({ course: course(), tracker: tracker(), studentId: 's1' }));
  for (const leak of ['correctOptionId', 'authorNotes', 'SECRET-AUTHOR-NOTE', 'ana@example.com', 'PRIVATE-NOTE']) assert.ok(!json.includes(leak), leak);
  assert.ok(json.includes('Which?') && json.includes('Yes'), 'quiz questions and options are shown');
  const view = JSON.stringify(buildPortalPreview({ course: course(), tracker: tracker(), studentId: 's2' }).view);
  assert.ok(!view.includes('Ana'), 'another student is not in the view');
});
test('all lessons done', () => {
  let t = tracker(); for (const l of ['l1', 'l2', 'l3']) if (!t.students[0].completed.includes(l)) t = toggleLesson(t, 's1', l);
  const v = buildPortalPreview({ course: course(), tracker: t, studentId: 's1' }).view!;
  assert.equal(v.allDone, true); assert.equal(v.nextLessonTitle, null); assert.equal(v.progressLabel, '3 of 3 lessons');
});
test('course with no lessons never reports completion', () => {
  const c = { ...course(), lessons: [] };
  const v = buildPortalPreview({ course: c, tracker: tracker(), studentId: 's1' }).view!;
  assert.equal(v.allDone, false); assert.equal(v.progressLabel, 'No lessons yet');
});
test('lessons deleted from the course are not counted', () => {
  let t = tracker(); t = toggleLesson(t, 's1', 'gone');
  assert.equal(buildPortalPreview({ course: course(), tracker: t, studentId: 's1' }).view?.progressLabel, '1 of 3 lessons');
});
test('missing, unreadable and mismatched parts are reported separately', () => {
  assert.equal(buildPortalPreview({ course: null, tracker: null, studentId: null }).course.status, 'none');
  assert.equal(buildPortalPreview({ course: UNREADABLE, tracker: tracker(), studentId: 's1' }).course.status, 'unreadable');
  assert.equal(buildPortalPreview({ course: UNREADABLE, tracker: tracker(), studentId: 's1' }).view, null);
  assert.equal(buildPortalPreview({ course: course(), tracker: UNREADABLE, studentId: 's1' }).students.status, 'unreadable');
  assert.equal(buildPortalPreview({ course: course(), tracker: null, studentId: null }).students.status, 'none');
  const other = buildPortalPreview({ course: { ...course(), id: 'other' }, tracker: tracker(), studentId: 's1' });
  assert.equal(other.students.status, 'other-course'); assert.equal(other.view, null);
});
test('unknown student id gives no view; list holds names only', () => {
  const p = buildPortalPreview({ course: course(), tracker: tracker(), studentId: 'nope' });
  assert.equal(p.view, null);
  assert.deepEqual(p.students, { status: 'ok', list: [{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Ben' }] });
});
