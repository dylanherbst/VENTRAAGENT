import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import {
  educationLearnerQuizOptionAllowlistKeys,
  educationLearnerQuizQuestionAllowlistKeys,
  mergeImportedLessonsPreservingQuizzes,
  normalizeLessonQuizDraft,
  projectQuizForLearnerPreview,
  quizBearingLessonsDroppedOnReplaceImport,
} from '../lib/local-education-lesson-quiz.ts';
import {
  editEducationCourseDraft,
  persistEducationCourseDraft,
  projectLessonsForLearnerPreview,
  restoreEducationCourseDraft,
  saveEducationCourseDraft,
} from '../lib/local-education-course.ts';
import {
  approveOfferForCurriculumPlanning,
  blankCreatorWorkflow,
  generateSuggestedOutline,
  importOutlineToCourseStorage,
  persistCreatorWorkflow,
  saveSuggestedOutlineToWorkflow,
  syncInterviewToWorkflow,
} from '../lib/local-education-creator-workflow.ts';

const profile = {
  ...blankProfile(),
  expertise: 'Teaching',
  audience: 'Creators',
  goal: 'Launch',
  educationOffer: 'Course',
};

const validQuizInput = {
  questions: [
    {
      id: 'q1',
      prompt: 'What is a habit loop?',
      correctOptionId: 'o-correct',
      authorNotes: 'Internal only',
      options: [
        { id: 'o-correct', text: 'Cue, routine, reward' },
        { id: 'o-wrong', text: 'Start, middle, end' },
      ],
    },
  ],
};

test('legacy course draft without quiz restores unchanged', () => {
  const lessonA = { id: 'lesson-a', title: 'Notice', content: 'Start small.', durationMinutes: '' };
  const input = {
    title: 'Small experiments',
    summary: 'A short text course.',
    lessons: [lessonA],
  };
  const draft = saveEducationCourseDraft(input, { id: 'course-1', profileId: profile.id });
  const raw = JSON.stringify(draft);
  const restored = restoreEducationCourseDraft(raw, profile.id)!;
  assert.equal(restored.lessons[0].quizDraft, undefined);
  assert.equal(projectLessonsForLearnerPreview(restored)[0].quiz, undefined);
});

test('quiz validation enforces limits and uniqueness', () => {
  assert.equal(normalizeLessonQuizDraft({ questions: [] }, 'Lesson 1'), undefined);
  const tooMany = {
    questions: Array.from({ length: 6 }, (_, i) => ({
      ...validQuizInput.questions[0],
      id: `q-${i}`,
    })),
  };
  assert.throws(() => normalizeLessonQuizDraft(tooMany, 'Lesson 1'));
  const dupQuestion = {
    questions: [
      validQuizInput.questions[0],
      { ...validQuizInput.questions[0], prompt: 'Other' },
    ],
  };
  assert.throws(() => normalizeLessonQuizDraft(dupQuestion, 'Lesson 1'));
  const badCorrect = {
    questions: [
      {
        ...validQuizInput.questions[0],
        correctOptionId: 'missing',
      },
    ],
  };
  assert.throws(() => normalizeLessonQuizDraft(badCorrect, 'Lesson 1'));
});

test('learner projection hides grading metadata and author notes', () => {
  const normalized = normalizeLessonQuizDraft(validQuizInput, 'Lesson 1')!;
  const projection = projectQuizForLearnerPreview(normalized)!;
  assert.deepEqual(educationLearnerQuizQuestionAllowlistKeys(), ['id', 'prompt', 'options']);
  assert.deepEqual(educationLearnerQuizOptionAllowlistKeys(), ['id', 'text']);
  const question = projection.questions[0];
  assert.ok(!('correctOptionId' in question));
  assert.ok(!('authorNotes' in question));
  assert.ok(!JSON.stringify(projection).includes('Internal only'));
  const lessonProjection = projectLessonsForLearnerPreview(
    saveEducationCourseDraft(
      {
        title: 'Quiz course',
        summary: 'Summary',
        lessons: [{ id: 'l1', title: 'L', content: 'C', durationMinutes: '', quizDraft: validQuizInput }],
      },
      { id: 'c', profileId: profile.id },
    ),
  )[0];
  assert.ok(lessonProjection.quiz);
  assert.ok(!('correctOptionId' in lessonProjection.quiz!.questions[0]));
});

test('save and reload round-trips quiz draft with course persist CAS', () => {
  const input = {
    title: 'Quiz course',
    summary: 'Summary text',
    lessons: [
      {
        id: 'lesson-a',
        title: 'Lesson',
        content: 'Body',
        durationMinutes: '',
        quizDraft: validQuizInput,
      },
    ],
  };
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const draft = saveEducationCourseDraft(input, { id: 'course-q', profileId: profile.id });
  const raw = persistEducationCourseDraft(fakeStorage, profile.id, null, draft);
  const restored = restoreEducationCourseDraft(raw, profile.id)!;
  assert.equal(restored.lessons[0].quizDraft?.questions[0].authorNotes, 'Internal only');
  assert.deepEqual(editEducationCourseDraft(restored).lessons[0].quizDraft?.questions[0].prompt, 'What is a habit loop?');
  const stale = saveEducationCourseDraft(
    { ...input, title: 'Renamed' },
    { id: draft.id, profileId: profile.id },
  );
  assert.throws(() => persistEducationCourseDraft(fakeStorage, profile.id, null, stale));
});

test('import replace preserves quizzes when lesson id matches', () => {
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  let record = blankCreatorWorkflow(profile, 'wf-quiz');
  record = syncInterviewToWorkflow(record, {
    ...record.interview,
    expertiseSummary: 'Lighting',
    evidenceExample: 'Sessions',
    outsideCompetence: 'Legal',
    learnerProfile: 'Hobbyists',
    learnerProblem: 'Flat light',
    observableOutcome: 'Three portraits',
    proofArtifact: 'Portfolio',
    deliveryFormat: 'Course',
    offerTitle: 'Lighting',
    offerOutcome: 'Better portraits',
    proposedPrice: '99',
    currency: 'AUD',
  });
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  const wfRaw = persistCreatorWorkflow(fakeStorage, profile.id, null, record);
  const firstImport = importOutlineToCourseStorage(fakeStorage, profile.id, null, record, 'replace', 'course-quiz');
  const courseBefore = restoreEducationCourseDraft(firstImport.courseRaw, profile.id)!;
  const edited = editEducationCourseDraft(courseBefore);
  edited.lessons[0] = { ...edited.lessons[0], quizDraft: validQuizInput };
  const withQuiz = saveEducationCourseDraft(edited, { id: 'course-quiz', profileId: profile.id });
  const courseRaw = persistEducationCourseDraft(fakeStorage, profile.id, firstImport.courseRaw, withQuiz);
  const wfRawAfterCourseLink = persistCreatorWorkflow(fakeStorage, profile.id, wfRaw, firstImport.workflow);
  const revisedOutline = firstImport.workflow.suggestedOutline!.map((lesson, index) =>
    index === 0 ? { ...lesson, objective: `${lesson.objective} (revised)` } : lesson,
  );
  const workflowForReimport = saveSuggestedOutlineToWorkflow(firstImport.workflow, revisedOutline);
  persistCreatorWorkflow(fakeStorage, profile.id, wfRawAfterCourseLink, workflowForReimport);
  const secondImport = importOutlineToCourseStorage(
    fakeStorage,
    profile.id,
    courseRaw,
    workflowForReimport,
    'replace',
    'course-quiz',
  );
  const after = restoreEducationCourseDraft(secondImport.courseRaw, profile.id)!;
  const firstLessonId = after.lessons[0].id;
  assert.equal(after.lessons[0].quizDraft?.questions[0].prompt, 'What is a habit loop?');
  assert.ok(secondImport.preservedQuizLessonIds.includes(firstLessonId));
});

test('quizBearingLessonsDroppedOnReplaceImport lists quiz lessons absent from import ids', () => {
  const existing = [
    { id: 'keep', title: 'Kept lesson', quizDraft: normalizeLessonQuizDraft(validQuizInput, 'Lesson 1') },
    { id: 'drop', title: 'Dropped lesson', quizDraft: normalizeLessonQuizDraft(validQuizInput, 'Lesson 2') },
    { id: 'plain', title: 'No quiz lesson' },
  ];
  const dropped = quizBearingLessonsDroppedOnReplaceImport([{ id: 'keep' }], existing);
  assert.deepEqual(dropped, [{ id: 'drop', title: 'Dropped lesson' }]);
});

test('mergeImportedLessonsPreservingQuizzes reports removed quizzes on dropped lesson ids', () => {
  const existing = [
    {
      id: 'keep',
      quizDraft: normalizeLessonQuizDraft(validQuizInput, 'Lesson 1'),
    },
    {
      id: 'drop',
      quizDraft: normalizeLessonQuizDraft(validQuizInput, 'Lesson 2'),
    },
  ];
  const report = mergeImportedLessonsPreservingQuizzes(
    [{ id: 'keep', title: 'T', content: 'C', durationMinutes: '' }],
    existing,
  );
  assert.deepEqual(report.preservedQuizLessonIds, ['keep']);
  assert.deepEqual(report.removedQuizLessonIds, ['drop']);
  assert.equal(report.lessons[0].quizDraft?.questions[0].prompt, 'What is a habit loop?');
});
