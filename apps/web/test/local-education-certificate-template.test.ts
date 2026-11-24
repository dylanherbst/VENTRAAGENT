import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import {
  restoreEducationCourseDraft,
  saveEducationCourseDraft,
} from '../lib/local-education-course.ts';
import {
  assertCertificateCourseFreshnessForSave,
  blankEducationCertificateTemplateDraftInput,
  editEducationCertificateTemplateDraft,
  educationCertificateForbiddenIssuanceKeys,
  educationCertificatePlaceholderCompletionDate,
  educationCertificatePlaceholderLearnerName,
  educationCertificateTemplateDraftAllowlistKeys,
  educationCertificateTemplatePreviewAllowlistKeys,
  educationCertificateTemplateStorageKey,
  evaluateCertificateCourseDrift,
  persistEducationCertificateTemplateDraft,
  projectSavedCertificateTemplateForPreview,
  projectUnsavedCertificateTemplateForPreview,
  restoreEducationCertificateTemplateDraft,
  saveEducationCertificateTemplateDraft,
  snapshotCertificateCourse,
} from '../lib/local-education-certificate-template.ts';

const profile = {
  ...blankProfile(),
  pathways: ['education' as const],
  name: 'Field Notes',
};

const courseInput = {
  title: 'Small experiments',
  summary: 'Private summary not on certificate',
  lessons: [{ id: 'l1', title: 'Frame a question', content: 'Secret lesson body', durationMinutes: '10' }],
};
const course = saveEducationCourseDraft(courseInput, { id: 'course-1', profileId: profile.id });

const templateInput = {
  creatorDisplayName: 'Field Notes',
  completionStatement: 'For completing the course template preview in this browser.',
  signatureLabel: 'Instructor',
  accentPreset: 'violet' as const,
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

test('preview projection allowlist excludes lesson content and issuance fields', () => {
  assert.deepEqual(educationCertificateTemplatePreviewAllowlistKeys(), [
    'templateLabel',
    'courseTitle',
    'creatorDisplayName',
    'completionStatement',
    'signatureLabel',
    'accentColor',
    'placeholderLearnerName',
    'placeholderCompletionDate',
  ]);
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  const projection = projectSavedCertificateTemplateForPreview(saved);
  assert.equal(Object.keys(projection).length, 8);
  assert.equal(projection.courseTitle, 'Small experiments');
  assert.equal(projection.placeholderLearnerName, educationCertificatePlaceholderLearnerName);
  assert.equal(projection.placeholderCompletionDate, educationCertificatePlaceholderCompletionDate);
  assert.match(projection.templateLabel, /template sample/i);
  assert.match(projection.templateLabel, /not issued/i);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes('Secret'), false);
  assert.equal(serialized.includes('Private summary'), false);
  for (const key of educationCertificateForbiddenIssuanceKeys) {
    assert.equal(key in projection, false);
    assert.equal(serialized.includes(`"${key}"`), false);
  }
});

test('draft allowlist has no issuance or credential fields', () => {
  const keys = educationCertificateTemplateDraftAllowlistKeys();
  for (const forbidden of educationCertificateForbiddenIssuanceKeys) {
    assert.equal(keys.includes(forbidden as never), false);
  }
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  for (const forbidden of educationCertificateForbiddenIssuanceKeys) {
    assert.equal(forbidden in saved, false);
  }
});

test('explicit save snapshots course link and title; revision increments', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  assert.equal(saved.revision, 1);
  assert.equal(saved.courseSnapshot.courseId, course.id);
  assert.equal(saved.courseSnapshot.courseTitle, course.title);
  assert.equal(saved.courseSnapshot.courseUpdatedAt, course.updatedAt);
  const updatedCourse = saveEducationCourseDraft(
    { ...courseInput, title: 'Renamed experiments' },
    { id: course.id, profileId: profile.id },
  );
  assert.throws(() =>
    saveEducationCertificateTemplateDraft(templateInput, profile.id, updatedCourse, saved),
  );
  const next = saveEducationCertificateTemplateDraft(templateInput, profile.id, updatedCourse, saved, {
    acknowledgeSourceChange: true,
  });
  assert.equal(next.revision, 2);
  assert.equal(next.courseSnapshot.courseTitle, 'Renamed experiments');
});

test('course drift detection and missing course', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  const missing = evaluateCertificateCourseDrift(saved, null);
  assert.equal(missing.courseMissing, true);
  const restored = restoreEducationCourseDraft(
    JSON.stringify(saveEducationCourseDraft(courseInput, { id: course.id, profileId: profile.id })),
    profile.id,
  )!;
  const drift = evaluateCertificateCourseDrift(saved, restored);
  assert.equal(drift.courseChanged, true);
  assert.throws(() => assertCertificateCourseFreshnessForSave(saved, restored));
});

test('restore validates profile, corrupt payloads and strips unknown fields', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  assert.equal(restoreEducationCertificateTemplateDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...saved, profileId: 'other' }), ' '.repeat(65000)]) {
    assert.throws(() => restoreEducationCertificateTemplateDraft(raw, profile.id));
  }
  const sanitized = restoreEducationCertificateTemplateDraft(
    JSON.stringify({ ...saved, issuedTo: 'Alex', credentialId: 'x', courseSnapshot: { ...saved.courseSnapshot, extra: true } }),
    profile.id,
  )!;
  assert.equal(sanitized.completionStatement, saved.completionStatement);
  assert.equal('issuedTo' in sanitized, false);
});

test('persist fails closed when expected raw is corrupt or oversize before write', () => {
  const storage = fakeStorage();
  const key = educationCertificateTemplateStorageKey(profile.id);
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  for (const corrupt of ['{', ' '.repeat(65000)]) {
    storage.setItem(key, corrupt);
    assert.throws(() => persistEducationCertificateTemplateDraft(storage, profile.id, corrupt, saved));
    assert.equal(storage.getItem(key), corrupt);
  }
});

test('persist uses optimistic concurrency and quota failures preserve prior raw', () => {
  const storage = fakeStorage();
  const key = educationCertificateTemplateStorageKey(profile.id);
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  const raw = persistEducationCertificateTemplateDraft(storage, profile.id, null, saved);
  assert.equal(storage.getItem(key), raw);
  const updated = saveEducationCertificateTemplateDraft(templateInput, profile.id, course, saved, {
    acknowledgeSourceChange: true,
  });
  const next = persistEducationCertificateTemplateDraft(storage, profile.id, raw, updated);
  assert.throws(() => persistEducationCertificateTemplateDraft(storage, profile.id, raw, saved), /another tab/);
  assert.equal(storage.getItem(key), next);
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistEducationCertificateTemplateDraft(quota, profile.id, null, saved), /Quota/);
});

test('profile isolation on restore', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  const raw = JSON.stringify(saved);
  assert.throws(() => restoreEducationCertificateTemplateDraft(raw, 'other-profile'));
});

test('unsaved preview uses live course title; saved preview uses snapshot', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  const liveRenamed = saveEducationCourseDraft(
    { ...courseInput, title: 'Live title only' },
    { id: course.id, profileId: profile.id },
  );
  const unsaved = projectUnsavedCertificateTemplateForPreview(templateInput, liveRenamed, saved);
  assert.equal(unsaved.courseTitle, 'Live title only');
  const savedPreview = projectSavedCertificateTemplateForPreview(saved);
  assert.equal(savedPreview.courseTitle, 'Small experiments');
});

test('edit round-trip and snapshot helper', () => {
  const saved = saveEducationCertificateTemplateDraft(templateInput, profile.id, course);
  assert.deepEqual(editEducationCertificateTemplateDraft(saved), templateInput);
  const snap = snapshotCertificateCourse(course);
  assert.equal(snap.courseTitle, course.title);
  assert.deepEqual(blankEducationCertificateTemplateDraftInput().accentPreset, 'default');
});
