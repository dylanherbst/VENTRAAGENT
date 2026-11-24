import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import {
  addSuggestedLesson,
  applyOutlineImportCommandKey,
  approveOfferForCurriculumPlanning,
  blankCreatorWorkflow,
  creatorInterviewErrors,
  generateSuggestedOutline,
  importOutlineToCourseStorage,
  offerProposalRevisionHash,
  outlineGenerationCommandKey,
  persistCreatorWorkflow,
  proposedOfferFromInterview,
  reorderSuggestedLessons,
  restoreCreatorWorkflow,
  saveSuggestedOutlineToWorkflow,
  suggestedOutlineMatchesSaved,
  syncInterviewToWorkflow,
  updateProposedOfferOnWorkflow,
} from '../lib/local-education-creator-workflow.ts';
import {
  persistEducationCourseDraft,
  restoreEducationCourseDraft,
  saveEducationCourseDraft,
} from '../lib/local-education-course.ts';

const profile = {
  ...blankProfile(),
  expertise: 'Portrait photography',
  audience: 'Beginner creators',
  goal: 'Ship a consistent portfolio',
  educationOffer: 'Course',
};

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

function filledInterview(record: ReturnType<typeof blankCreatorWorkflow>) {
  return {
    ...record.interview,
    expertiseSummary: 'Lighting for portraits',
    evidenceExample: 'Shot 12 client sessions last year',
    outsideCompetence: 'Legal contracts',
    learnerProfile: 'Hobby photographers',
    learnerProblem: 'Flat indoor lighting',
    observableOutcome: 'Three portfolio-ready portraits',
    proofArtifact: 'Submit three edited portraits',
    deliveryFormat: 'Self-paced course',
    offerTitle: 'Portrait lighting basics',
    offerOutcome: 'Confident indoor portraits',
    proposedPrice: '149.00',
    currency: 'AUD' as const,
  };
}

test('approval binds exact offer revision and edits invalidate it', () => {
  let record = blankCreatorWorkflow(profile, 'wf-1');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  const hashBefore = offerProposalRevisionHash(record.proposedOffer);
  record = approveOfferForCurriculumPlanning(record);
  assert.equal(record.approvedOfferRevisionHash, hashBefore);
  const edited = updateProposedOfferOnWorkflow(record, { ...record.proposedOffer, price: '199.00' });
  assert.equal(edited.approvedOfferRevisionHash, null);
  assert.equal(edited.phase, 'awaiting_offer_approval');
  assert.equal(edited.suggestedOutline, null);
});

test('generate outline is idempotent and produces 3-5 lessons', () => {
  let record = blankCreatorWorkflow(profile, 'wf-2');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  const first = generateSuggestedOutline(record);
  const second = generateSuggestedOutline(first);
  assert.equal(second.outlineCommandKey, first.outlineCommandKey);
  assert.deepEqual(second.suggestedOutline, first.suggestedOutline);
  assert.ok(first.suggestedOutline!.length >= 3 && first.suggestedOutline!.length <= 5);
  assert.match(outlineGenerationCommandKey(first), /manual-template-v1/);
});

test('import does not duplicate course lessons on repeated command', () => {
  const storage = fakeStorage();
  let record = blankCreatorWorkflow(profile, 'wf-3');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  let raw = persistCreatorWorkflow(storage, profile.id, null, record);
  const first = importOutlineToCourseStorage(storage, profile.id, null, record, 'replace', 'course-wf-3');
  persistCreatorWorkflow(storage, profile.id, raw, first.workflow);
  const courseAfterFirst = restoreEducationCourseDraft(first.courseRaw, profile.id)!;
  const second = importOutlineToCourseStorage(storage, profile.id, first.courseRaw, first.workflow, 'replace', 'course-wf-3');
  const courseAfterSecond = restoreEducationCourseDraft(second.courseRaw, profile.id)!;
  assert.equal(courseAfterSecond.lessons.length, courseAfterFirst.lessons.length);
});

test('merge append skips lesson IDs already in course after partial workflow persist', () => {
  const storage = fakeStorage();
  let record = blankCreatorWorkflow(profile, 'wf-3b');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  const courseExpectedRaw = persistEducationCourseDraft(
    storage,
    profile.id,
    null,
    saveEducationCourseDraft(
      {
        title: 'Existing course',
        summary: 'Kept lesson should not be overwritten on merge retry.',
        lessons: [
          {
            id: `${record.workflowId}-lesson-99`,
            title: 'Unrelated existing lesson',
            content: 'Original course content stays intact.',
            durationMinutes: '',
          },
        ],
      },
      { id: 'course-wf-3b', profileId: profile.id },
    ),
  );
  const preexisting = restoreEducationCourseDraft(courseExpectedRaw, profile.id)!;
  const first = importOutlineToCourseStorage(storage, profile.id, courseExpectedRaw, record, 'merge', 'course-wf-3b');
  const afterCourseWrite = restoreEducationCourseDraft(first.courseRaw, profile.id)!;
  const lessonCountAfterCourseWrite = afterCourseWrite.lessons.length;
  assert.ok(lessonCountAfterCourseWrite > preexisting.lessons.length);
  const unrelated = afterCourseWrite.lessons.find(lesson => lesson.id === `${record.workflowId}-lesson-99`);
  assert.equal(unrelated?.content, 'Original course content stays intact.');
  const retry = importOutlineToCourseStorage(storage, profile.id, first.courseRaw, record, 'merge', 'course-wf-3b');
  const afterRetry = restoreEducationCourseDraft(retry.courseRaw, profile.id)!;
  assert.equal(afterRetry.lessons.length, lessonCountAfterCourseWrite);
  assert.equal(
    afterRetry.lessons.find(lesson => lesson.id === `${record.workflowId}-lesson-99`)?.content,
    'Original course content stays intact.',
  );
});

test('stale workflow persist is rejected', () => {
  const storage = fakeStorage();
  const record = blankCreatorWorkflow(profile, 'wf-4');
  const raw = persistCreatorWorkflow(storage, profile.id, null, record);
  assert.throws(() => persistCreatorWorkflow(storage, profile.id, null, record), /another tab/i);
  const next = syncInterviewToWorkflow(record, filledInterview(record));
  persistCreatorWorkflow(storage, profile.id, raw, next);
});

test('interview validation blocks empty expertise', () => {
  const record = blankCreatorWorkflow(profile, 'wf-5');
  const errors = creatorInterviewErrors(record.interview);
  assert.ok(errors.length > 0);
  const filled = filledInterview(record);
  assert.equal(creatorInterviewErrors(filled).length, 0);
  assert.ok(proposedOfferFromInterview(filled).name.includes('Portrait'));
});

test('saved outline edits persist across restore and reload draft state', () => {
  const storage = fakeStorage();
  let record = blankCreatorWorkflow(profile, 'wf-6');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  const edited = [...record.suggestedOutline!];
  edited[0] = { ...edited[0], title: 'Custom first lesson title' };
  record = saveSuggestedOutlineToWorkflow(record, edited);
  const raw = persistCreatorWorkflow(storage, profile.id, null, record);
  const restored = restoreCreatorWorkflow(raw, profile.id)!;
  assert.equal(restored.suggestedOutline![0].title, 'Custom first lesson title');
  assert.ok(restored.outlineContentKey);
  assert.ok(suggestedOutlineMatchesSaved(restored.suggestedOutline, edited));
  assert.equal(restored.suggestedOutline!.length, edited.length);
});

test('outline save clears stale import binding when content changes', () => {
  let record = blankCreatorWorkflow(profile, 'wf-7');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  const storage = fakeStorage();
  const imported = importOutlineToCourseStorage(storage, profile.id, null, record, 'replace', 'course-wf-7');
  assert.equal(imported.workflow.lastApplyStatus, 'completed');
  const edited = [...imported.workflow.suggestedOutline!];
  edited[0] = { ...edited[0], title: 'Changed after import' };
  const saved = saveSuggestedOutlineToWorkflow(imported.workflow, edited);
  assert.equal(saved.lastApplyCommandKey, null);
  assert.notEqual(applyOutlineImportCommandKey(saved, 'replace'), applyOutlineImportCommandKey(imported.workflow, 'replace'));
});

test('reorder and add suggested lessons stay within course lesson limit', () => {
  let record = blankCreatorWorkflow(profile, 'wf-8');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  let outline = record.suggestedOutline!;
  outline = reorderSuggestedLessons(outline, 0, 1);
  assert.notEqual(outline[0].id, record.suggestedOutline![0].id);
  outline = addSuggestedLesson(record.workflowId, outline);
  assert.equal(outline.length, record.suggestedOutline!.length + 1);
  const addedIndex = outline.length - 1;
  outline = outline.map((lesson, index) =>
    index === addedIndex
      ? { ...lesson, objective: 'State what learners should be able to do after this lesson.' }
      : lesson,
  );
  record = saveSuggestedOutlineToWorkflow(record, outline);
  assert.ok(record.suggestedOutline!.length >= 4);
});

test('edited outline re-import replace updates course without duplicate command skip', () => {
  const storage = fakeStorage();
  let record = blankCreatorWorkflow(profile, 'wf-9');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  const first = importOutlineToCourseStorage(storage, profile.id, null, record, 'replace', 'course-wf-9');
  const edited = [...first.workflow.suggestedOutline!];
  edited[0] = { ...edited[0], title: 'Re-imported title' };
  const saved = saveSuggestedOutlineToWorkflow(first.workflow, edited);
  const second = importOutlineToCourseStorage(storage, profile.id, first.courseRaw, saved, 'replace', 'course-wf-9');
  const course = restoreEducationCourseDraft(second.courseRaw, profile.id)!;
  assert.equal(course.lessons[0].title, 'Re-imported title');
  assert.equal(course.lessons.length, edited.length);
});

test('offer approval invalidation clears saved outline content key', () => {
  let record = blankCreatorWorkflow(profile, 'wf-10');
  record = syncInterviewToWorkflow(record, filledInterview(record));
  record = approveOfferForCurriculumPlanning(record);
  record = generateSuggestedOutline(record);
  assert.ok(record.outlineContentKey);
  const staleOffer = updateProposedOfferOnWorkflow(record, { ...record.proposedOffer, price: '299.00' });
  assert.equal(staleOffer.suggestedOutline, null);
  assert.equal(staleOffer.outlineContentKey, null);
});
