import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignPreviewProgressCourse,
  persistEducationPreviewProgress,
  persistPreviewProgressAlignedToCourse,
  resetStoredPreviewProgress,
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

test('resetStoredPreviewProgress rejects stale observed corrupt raw when storage was repaired', () => {
  const storage = fakeStorage();
  let progress = alignPreviewProgressCourse(null, draft);
  progress = togglePreviewLessonComplete(progress, draft, 'lesson-a', true);
  const validRaw = persistEducationPreviewProgress(storage, profileId, null, progress);
  const staleCorruptObserved = '{';
  assert.throws(
    () => resetStoredPreviewProgress(storage, profileId, staleCorruptObserved, draft),
    /another tab/i,
  );
  assert.equal(storage.getItem(`launchpad.education-preview-progress.v1.${profileId}`), validRaw);
  const stillValid = restoreEducationPreviewProgress(validRaw, profileId)!;
  assert.deepEqual(stillValid.completedLessonIds, ['lesson-a']);
});

test('resetStoredPreviewProgress clears progress when observed raw matches storage', () => {
  const storage = fakeStorage();
  const corruptObserved = '{';
  storage.setItem(`launchpad.education-preview-progress.v1.${profileId}`, corruptObserved);
  const { raw, progress } = resetStoredPreviewProgress(storage, profileId, corruptObserved, draft);
  assert.notEqual(raw, corruptObserved);
  assert.deepEqual(progress.completedLessonIds, []);
});

test('persistPreviewProgressAlignedToCourse rejects progress changed between read and write', () => {
  const storage = fakeStorage();
  let progress = alignPreviewProgressCourse(null, draft);
  progress = setPreviewActiveLesson(progress, draft, 'lesson-b');
  const staleRaw = persistEducationPreviewProgress(storage, profileId, null, progress);
  const raced = togglePreviewLessonComplete(progress, draft, 'lesson-a', true);
  persistEducationPreviewProgress(storage, profileId, staleRaw, raced);
  const key = `launchpad.education-preview-progress.v1.${profileId}`;
  let reads = 0;
  const racingStorage = {
    getItem: (itemKey: string) => {
      if (itemKey !== key) return storage.getItem(itemKey);
      reads += 1;
      return reads === 1 ? staleRaw : storage.getItem(itemKey);
    },
    setItem: storage.setItem.bind(storage),
  };
  assert.throws(() => persistPreviewProgressAlignedToCourse(racingStorage, profileId, draft), /another tab/i);
});
