import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { educationApiNotConnected, describeEducationApiBoundary } from '../lib/education-api-contract.ts';
import {
  alignPreviewProgressCourse,
  courseDraftFromInput,
  editEducationCourseDraft,
  educationCourseDraftAllowlistKeys,
  educationCourseStorageKey,
  educationLearnerLessonAllowlistKeys,
  educationPreviewProgressStorageKey,
  persistEducationCourseDraft,
  persistEducationPreviewProgress,
  persistPreviewProgressAlignedToCourse,
  previewProgressCount,
  projectLessonsForLearnerPreview,
  reorderEducationLessons,
  restoreEducationCourseDraft,
  restoreEducationPreviewProgress,
  saveEducationCourseDraft,
  setPreviewActiveLesson,
  togglePreviewLessonComplete,
} from '../lib/local-education-course.ts';

const profile = {
  ...blankProfile(),
  name: 'Field school',
  audience: 'Creators',
  expertise: 'Design',
  goal: 'Teach',
};
const lessonA = { id: 'lesson-a', title: 'Notice', content: 'Start small.', durationMinutes: '' };
const lessonB = { id: 'lesson-b', title: 'Try', content: 'Run an experiment.', durationMinutes: '15' };
const input = {
  title: 'Small experiments',
  summary: 'A short text course for trying ideas gently.',
  lessons: [lessonA, lessonB],
};
const draft = saveEducationCourseDraft(input, { id: 'course-1', profileId: profile.id });

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('learner projection allowlist excludes draft metadata', () => {
  assert.deepEqual(educationLearnerLessonAllowlistKeys(), ['id', 'title', 'content', 'durationMinutes', 'quiz']);
  const projection = projectLessonsForLearnerPreview(draft)[0];
  assert.equal(Object.keys(projection).length, 3);
  assert.equal(projection.title, 'Notice');
  assert.ok(!('profileId' in projection));
  assert.ok(!('quizDraft' in projection));
  const withQuiz = saveEducationCourseDraft(
    {
      ...input,
      lessons: [
        {
          ...lessonA,
          quizDraft: {
            questions: [
              {
                id: 'q1',
                prompt: 'Check',
                correctOptionId: 'o1',
                authorNotes: 'secret grading note',
                options: [
                  { id: 'o1', text: 'Yes' },
                  { id: 'o2', text: 'No' },
                ],
              },
            ],
          },
        },
      ],
    },
    { id: 'course-quiz-proj', profileId: profile.id },
  );
  const quizLesson = projectLessonsForLearnerPreview(withQuiz)[0];
  assert.deepEqual(Object.keys(quizLesson).sort(), ['content', 'id', 'quiz', 'title']);
  assert.ok(quizLesson.quiz);
  assert.deepEqual(Object.keys(quizLesson.quiz!.questions[0]).sort(), ['id', 'options', 'prompt']);
  assert.ok(!JSON.stringify(quizLesson).includes('secret grading note'));
  assert.ok(!JSON.stringify(quizLesson).includes('correctOptionId'));
});

test('save, restore, reorder and duration validation', () => {
  const withDuration = restoreEducationCourseDraft(JSON.stringify(draft), profile.id)!;
  assert.equal(withDuration.lessons[1].durationMinutes, 15);
  assert.deepEqual(editEducationCourseDraft(withDuration).lessons[1].durationMinutes, '15');
  assert.throws(() => saveEducationCourseDraft({ ...input, lessons: [{ ...lessonA, durationMinutes: '0' }] }, { id: 'c', profileId: profile.id }));
  assert.throws(() => saveEducationCourseDraft({ ...input, lessons: [{ ...lessonA, durationMinutes: 'abc' }] }, { id: 'c', profileId: profile.id }));
  const reordered = reorderEducationLessons(['a', 'b', 'c'], 'b', -1);
  assert.deepEqual(reordered, ['b', 'a', 'c']);
  assert.throws(() => saveEducationCourseDraft({ ...input, title: '' }, { id: 'c', profileId: profile.id }));
  assert.throws(() => saveEducationCourseDraft({ ...input, lessons: [] }, { id: 'c', profileId: profile.id }));
});

test('restore rejects corrupt, mismatched and oversize payloads without mutating storage', () => {
  assert.equal(restoreEducationCourseDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, profileId: 'other' }), ' '.repeat(128001)]) {
    assert.throws(() => restoreEducationCourseDraft(raw, profile.id));
  }
  const sanitized = restoreEducationCourseDraft(JSON.stringify({ ...draft, admin: true, lessons: [{ ...draft.lessons[0], secret: 'x' }, draft.lessons[1]] }), profile.id)!;
  assert.equal(sanitized.title, draft.title);
  assert.equal(sanitized.lessons.length, 2);
  assert.deepEqual([...educationCourseDraftAllowlistKeys()].sort(), ['id', 'lessons', 'profileId', 'summary', 'title', 'updatedAt', 'version'].sort());
});

test('course draft persist uses optimistic concurrency', () => {
  const storage = fakeStorage();
  const key = educationCourseStorageKey(profile.id);
  const raw = persistEducationCourseDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistEducationCourseDraft(storage, profile.id, null, draft));
  const edited = saveEducationCourseDraft({ ...input, title: 'Renamed course' }, { id: draft.id, profileId: profile.id });
  const raw2 = persistEducationCourseDraft(storage, profile.id, raw, edited);
  assert.match(restoreEducationCourseDraft(raw2, profile.id)!.title, /Renamed/);
});

test('preview progress is stored separately and aligns removed lessons on read and course save', () => {
  const storage = fakeStorage();
  let progress = alignPreviewProgressCourse(null, draft);
  progress = togglePreviewLessonComplete(progress, draft, 'lesson-a', true);
  progress = setPreviewActiveLesson(progress, draft, 'lesson-b');
  const raw = persistEducationPreviewProgress(storage, profile.id, null, progress);
  const restored = restoreEducationPreviewProgress(raw, profile.id)!;
  assert.deepEqual(restored.completedLessonIds, ['lesson-a']);
  assert.equal(restored.activeLessonId, 'lesson-b');
  const trimmedDraft = saveEducationCourseDraft(
    { ...input, lessons: [lessonB] },
    { id: draft.id, profileId: profile.id },
  );
  const aligned = alignPreviewProgressCourse(restored, trimmedDraft);
  assert.deepEqual(aligned.completedLessonIds, []);
  assert.deepEqual(restored.completedLessonIds, ['lesson-a']);
  const persisted = persistPreviewProgressAlignedToCourse(storage, profile.id, trimmedDraft);
  assert.deepEqual(persisted.progress.completedLessonIds, []);
  assert.deepEqual(restoreEducationPreviewProgress(persisted.raw, profile.id)!.completedLessonIds, []);
  assert.equal(previewProgressCount(trimmedDraft, aligned).total, 1);
  assert.equal(educationPreviewProgressStorageKey(profile.id), `launchpad.education-preview-progress.v1.${profile.id}`);
  assert.throws(() => persistEducationPreviewProgress(storage, profile.id, null, progress));
});

test('courseDraftFromInput matches save for the same identity', () => {
  const fromInput = courseDraftFromInput(input, { id: draft.id, profileId: profile.id });
  assert.equal(fromInput.title, draft.title);
  assert.equal(fromInput.lessons.length, 2);
});

test('education API contract stub stays honest', () => {
  const stub = educationApiNotConnected();
  assert.equal(stub.configured, false);
  assert.match(stub.error, /not connected/i);
  assert.match(describeEducationApiBoundary(), /education-api-contract/);
});
