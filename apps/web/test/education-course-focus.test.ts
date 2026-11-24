import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignPreviewProgressCourse,
  persistEducationPreviewProgress,
  persistPreviewProgressAlignedToCourse,
  previewProgressRestoreErrorMessage,
  restoreEducationPreviewProgress,
  saveEducationCourseDraft,
  setPreviewActiveLesson,
  togglePreviewLessonComplete,
} from '../lib/local-education-course.ts';

const profileId = 'local-business';
const lessonA = { id: 'lesson-a', title: 'A', content: 'a', durationMinutes: '' };
const lessonB = { id: 'lesson-b', title: 'B', content: 'b', durationMinutes: '' };
const input = { title: 'Course', summary: 'Summary', lessons: [lessonA, lessonB] };
const draft = saveEducationCourseDraft(input, { id: 'course-1', profileId });

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('corrupt preview progress message does not claim another tab', () => {
  const message = previewProgressRestoreErrorMessage(new SyntaxError('Unexpected token'));
  assert.match(message, /unreadable/i);
  assert.match(message, /Reset preview progress/i);
  assert.doesNotMatch(message, /another tab/i);
});

test('persistPreviewProgressAlignedToCourse prunes removed lesson ids in storage on course save', () => {
  const storage = fakeStorage();
  let progress = alignPreviewProgressCourse(null, draft);
  progress = togglePreviewLessonComplete(progress, draft, 'lesson-a', true);
  progress = setPreviewActiveLesson(progress, draft, 'lesson-b');
  persistEducationPreviewProgress(storage, profileId, null, progress);
  const trimmed = saveEducationCourseDraft({ ...input, lessons: [lessonB] }, { id: draft.id, profileId });
  const { raw, progress: aligned } = persistPreviewProgressAlignedToCourse(storage, profileId, trimmed);
  assert.ok(raw);
  const stored = restoreEducationPreviewProgress(raw, profileId)!;
  assert.deepEqual(stored.completedLessonIds, []);
  assert.equal(stored.activeLessonId, 'lesson-b');
  assert.deepEqual(aligned.completedLessonIds, []);
});
