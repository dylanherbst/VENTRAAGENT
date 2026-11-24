import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  restoreEducationCourseDraft,
  saveEducationCourseDraft,
} from '../lib/local-education-course.ts';
import {
  assertSourceFreshnessForSave,
  blankEducationCourseSalesPageDraftInput,
  editEducationCourseSalesPageDraft,
  educationCourseSalesPageDraftAllowlistKeys,
  educationCourseSalesPagePreviewAllowlistKeys,
  educationCourseSalesPageStorageKey,
  evaluateSalesPageSourceDrift,
  lessonTitlesFromCourse,
  persistEducationCourseSalesPageDraft,
  projectSavedSalesPageForPreview,
  projectUnsavedSalesPageForPreview,
  restoreEducationCourseSalesPageDraft,
  saveEducationCourseSalesPageDraft,
  snapshotCourseSource,
} from '../lib/local-education-course-sales-page.ts';

const profile = {
  ...blankProfile(),
  pathways: ['education' as const],
  name: 'Field Notes',
  expertise: 'Small experiments',
  audience: 'Solo founders',
};

const courseInput = {
  title: 'Small experiments',
  summary: 'Private summary not for sales page',
  lessons: [
    { id: 'l1', title: 'Frame a question', content: 'Secret lesson body', durationMinutes: '10' },
    { id: 'l2', title: 'Run one test', content: 'More secret content', durationMinutes: '' },
  ],
};
const course = saveEducationCourseDraft(courseInput, { id: 'course-1', profileId: profile.id });
const educationOffer = saveLocalOffer(
  [],
  {
    ...blankOffer(profile),
    kind: 'education',
    name: 'Course access',
    outcome: 'Offer outcome not shown on sales page',
    delivery: 'Private delivery details',
    audience: 'Private audience field',
    price: '149.00',
  },
  profile,
  'offer-edu',
)[0];
const educationOfferB = saveLocalOffer(
  [educationOffer],
  {
    ...blankOffer(profile),
    kind: 'education',
    name: 'Workshop add-on',
    outcome: 'Extra',
    delivery: 'Live',
    audience: 'Alumni',
    price: '99.00',
  },
  profile,
  'offer-edu-b',
)[1];

const pageInput = {
  headline: 'Learn small experiments',
  description: 'A practical course for testing ideas.',
  intendedLearner: 'Creators with a day job',
  outcomes: 'Ship one validated experiment',
  instructorBio: 'I teach from my own practice.',
  offerId: educationOffer.id,
};

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('preview projection allowlist excludes course content, offer copy and workflow fields', () => {
  assert.deepEqual(educationCourseSalesPagePreviewAllowlistKeys(), [
    'headline',
    'description',
    'intendedLearner',
    'outcomes',
    'instructorBio',
    'lessonTitles',
    'priceLabel',
  ]);
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  const projection = projectSavedSalesPageForPreview(saved);
  assert.equal(Object.keys(projection).length, 7);
  assert.deepEqual(projection.lessonTitles, ['Frame a question', 'Run one test']);
  assert.match(projection.priceLabel, /AUD 149\.00/);
  assert.equal(JSON.stringify(projection).includes('Secret'), false);
  assert.equal(JSON.stringify(projection).includes('Offer outcome'), false);
  const learnerTitles = lessonTitlesFromCourse(course);
  assert.deepEqual(learnerTitles, projection.lessonTitles);
});

test('explicit save snapshots course revision and offer price; unsaved preview follows library', () => {
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  assert.equal(saved.revision, 1);
  assert.equal(saved.courseSnapshot.courseUpdatedAt, course.updatedAt);
  assert.equal(saved.offerPriceSnapshot.amountMinor, 14900);
  const editedOffer = saveLocalOffer(
    [educationOffer, educationOfferB],
    { ...blankOffer(profile), kind: 'education', name: 'Course access', outcome: 'x', delivery: 'y', audience: 'z', price: '199.00' },
    profile,
    educationOffer.id,
  )[0];
  const unsaved = projectUnsavedSalesPageForPreview(pageInput, course, [editedOffer], saved);
  assert.match(unsaved.priceLabel, /199\.00/);
  const savedPreview = projectSavedSalesPageForPreview(saved);
  assert.match(savedPreview.priceLabel, /149\.00/);
});

test('source drift blocks save until acknowledged; revision increments', () => {
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  const updatedCourse = saveEducationCourseDraft(
    { ...courseInput, lessons: [...courseInput.lessons, { id: 'l3', title: 'Reflect', content: 'x', durationMinutes: '' }] },
    { id: course.id, profileId: profile.id },
  );
  assert.throws(() =>
    saveEducationCourseSalesPageDraft(pageInput, profile.id, updatedCourse, [educationOffer], saved),
  );
  assert.throws(() => assertSourceFreshnessForSave(saved, updatedCourse, [educationOffer]));
  const next = saveEducationCourseSalesPageDraft(pageInput, profile.id, updatedCourse, [educationOffer], saved, {
    acknowledgeSourceChange: true,
  });
  assert.equal(next.revision, 2);
  assert.equal(next.courseSnapshot.lessonTitles.length, 3);
});

test('missing or deleted offer uses snapshot on unsaved preview and blocks save without library', () => {
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  const unsaved = projectUnsavedSalesPageForPreview(pageInput, course, [], saved);
  assert.match(unsaved.priceLabel, /149\.00/);
  assert.throws(() => saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [], saved));
});

test('restore validates profile, corrupt payloads and strips unknown fields without mutating storage', () => {
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  assert.equal(restoreEducationCourseSalesPageDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...saved, profileId: 'other' }), ' '.repeat(129000)]) {
    assert.throws(() => restoreEducationCourseSalesPageDraft(raw, profile.id));
  }
  const sanitized = restoreEducationCourseSalesPageDraft(
    JSON.stringify({ ...saved, admin: true, courseSnapshot: { ...saved.courseSnapshot, secret: 'x' } }),
    profile.id,
  )!;
  assert.equal(sanitized.headline, saved.headline);
  assert.equal(sanitized.courseSnapshot.lessonTitles[0].title, 'Frame a question');
  assert.deepEqual(educationCourseSalesPageDraftAllowlistKeys().includes('admin' as never), false);
});

test('persist uses optimistic concurrency and quota failures preserve prior raw', () => {
  const storage = fakeStorage();
  const key = educationCourseSalesPageStorageKey(profile.id);
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  const raw = persistEducationCourseSalesPageDraft(storage, profile.id, null, saved);
  assert.equal(storage.getItem(key), raw);
  const updated = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer], saved, {
    acknowledgeSourceChange: true,
  });
  const next = persistEducationCourseSalesPageDraft(storage, profile.id, raw, updated);
  assert.throws(() => persistEducationCourseSalesPageDraft(storage, profile.id, raw, saved), /another tab/);
  assert.equal(storage.getItem(key), next);
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistEducationCourseSalesPageDraft(quota, profile.id, null, saved), /Quota/);
});

test('non-education offer rejected for price snapshot', () => {
  const businessProfile = { ...profile, pathways: ['education' as const, 'business' as const] };
  const serviceOffer = saveLocalOffer(
    [],
    {
      ...blankOffer(businessProfile),
      kind: 'service',
      name: 'Consulting',
      outcome: 'Help',
      delivery: 'Calls',
      price: '99.00',
    },
    businessProfile,
    'offer-svc',
  )[0];
  assert.throws(() =>
    saveEducationCourseSalesPageDraft(
      { ...pageInput, offerId: serviceOffer.id },
      businessProfile.id,
      course,
      [serviceOffer],
    ),
  );
});

test('course snapshot hash tracks updatedAt for drift detection', () => {
  const snap = snapshotCourseSource(course);
  assert.equal(snap.courseId, course.id);
  const drift = evaluateSalesPageSourceDrift(
    saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]),
    null,
    [educationOffer],
  );
  assert.equal(drift.courseMissing, true);
  const savedPage = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  const restored = restoreEducationCourseDraft(
    JSON.stringify(saveEducationCourseDraft(courseInput, { id: course.id, profileId: profile.id })),
    profile.id,
  )!;
  assert.notEqual(restored.updatedAt, savedPage.courseSnapshot.courseUpdatedAt);
  const driftAfterRestore = evaluateSalesPageSourceDrift(savedPage, restored, [educationOffer]);
  assert.equal(driftAfterRestore.courseChanged, true);
  assert.deepEqual(snapshotCourseSource(restored).lessonTitles, savedPage.courseSnapshot.lessonTitles);
});

test('edit round-trip matches saved draft input', () => {
  const saved = saveEducationCourseSalesPageDraft(pageInput, profile.id, course, [educationOffer]);
  assert.deepEqual(editEducationCourseSalesPageDraft(saved), pageInput);
  assert.deepEqual(blankEducationCourseSalesPageDraftInput().offerId, '');
});
