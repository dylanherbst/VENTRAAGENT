import type { EducationCourseDraft } from './local-education-course.ts';
import { educationCourseTitleLimit } from './local-education-course.ts';

export const educationCertificateCreatorNameLimit = 160;
export const educationCertificateCompletionStatementLimit = 500;
export const educationCertificateSignatureLabelLimit = 120;
export const educationCertificateStorageByteLimit = 64000;
export const educationCertificateRevisionCap = 9999;

export const educationCertificatePlaceholderLearnerName = 'Sample learner (placeholder)';
export const educationCertificatePlaceholderCompletionDate = 'Month DD, YYYY (sample date)';
export const educationCertificatePreviewTemplateLabel =
  'Certificate template sample — not issued, not earned, not accredited';

export const educationCertificateAccentPresets = ['default', 'gold', 'violet', 'mint'] as const;
export type EducationCertificateAccentPreset = (typeof educationCertificateAccentPresets)[number];

export const educationCertificateAccentColors: Record<EducationCertificateAccentPreset, string> = {
  default: '#c2b4ff',
  gold: '#fcd34d',
  violet: '#a855f7',
  mint: '#a9e6c6',
};

export type EducationCertificateCourseSnapshot = {
  courseId: string;
  courseUpdatedAt: string;
  courseTitle: string;
};

export type EducationCertificateTemplateDraftInput = {
  creatorDisplayName: string;
  completionStatement: string;
  signatureLabel: string;
  accentPreset: EducationCertificateAccentPreset;
};

export type EducationCertificateTemplateDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  creatorDisplayName: string;
  completionStatement: string;
  signatureLabel: string;
  accentPreset: EducationCertificateAccentPreset;
  courseSnapshot: EducationCertificateCourseSnapshot;
};

export type EducationCertificateTemplatePreviewProjection = {
  templateLabel: string;
  courseTitle: string;
  creatorDisplayName: string | null;
  completionStatement: string;
  signatureLabel: string;
  accentColor: string;
  placeholderLearnerName: string;
  placeholderCompletionDate: string;
};

export type EducationCertificateCourseDrift = {
  courseMissing: boolean;
  courseChanged: boolean;
  courseTitleChanged: boolean;
};

export const educationCertificateTemplateStorageKey = (profileId: string) =>
  `launchpad.education-certificate-template-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved certificate template draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > educationCertificateRevisionCap) {
    throw new Error('Invalid saved certificate template draft. Nothing was overwritten.');
  }
  return value as number;
}

function parseAccentPreset(value: unknown): EducationCertificateAccentPreset {
  if (typeof value !== 'string' || !(educationCertificateAccentPresets as readonly string[]).includes(value)) {
    throw new Error('Invalid saved certificate template draft. Nothing was overwritten.');
  }
  return value as EducationCertificateAccentPreset;
}

export function snapshotCertificateCourse(course: EducationCourseDraft): EducationCertificateCourseSnapshot {
  if (!course.lessons.length) {
    throw new Error('Save a course draft with at least one lesson before drafting a certificate template.');
  }
  return {
    courseId: text(course.id, 'Course ID', 160),
    courseUpdatedAt: parseUpdatedAt(course.updatedAt),
    courseTitle: text(course.title, 'Course title', educationCourseTitleLimit),
  };
}

export function blankEducationCertificateTemplateDraftInput(): EducationCertificateTemplateDraftInput {
  return {
    creatorDisplayName: '',
    completionStatement:
      'For participating in this course template preview in your browser. This is not proof of completion or certification.',
    signatureLabel: 'Course creator',
    accentPreset: 'default',
  };
}

export function editEducationCertificateTemplateDraft(
  draft: EducationCertificateTemplateDraft,
): EducationCertificateTemplateDraftInput {
  return {
    creatorDisplayName: draft.creatorDisplayName,
    completionStatement: draft.completionStatement,
    signatureLabel: draft.signatureLabel,
    accentPreset: draft.accentPreset,
  };
}

function buildDraft(
  input: EducationCertificateTemplateDraftInput,
  profileId: string,
  courseSnapshot: EducationCertificateCourseSnapshot,
  revision: number,
  updatedAt: string,
): EducationCertificateTemplateDraft {
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision: parseRevision(revision),
    updatedAt: parseUpdatedAt(updatedAt),
    creatorDisplayName: optionalText(input.creatorDisplayName, 'Creator or display name', educationCertificateCreatorNameLimit),
    completionStatement: text(input.completionStatement, 'Completion statement', educationCertificateCompletionStatementLimit),
    signatureLabel: text(input.signatureLabel, 'Signature label', educationCertificateSignatureLabelLimit),
    accentPreset: parseAccentPreset(input.accentPreset),
    courseSnapshot,
  };
}

export type SaveEducationCertificateTemplateOptions = {
  acknowledgeSourceChange?: boolean;
};

export function evaluateCertificateCourseDrift(
  saved: EducationCertificateTemplateDraft | null,
  course: EducationCourseDraft | null,
): EducationCertificateCourseDrift {
  if (!saved) {
    return { courseMissing: course === null, courseChanged: false, courseTitleChanged: false };
  }
  const courseMissing = course === null || course.id !== saved.courseSnapshot.courseId;
  const courseChanged = !courseMissing && course!.updatedAt !== saved.courseSnapshot.courseUpdatedAt;
  const courseTitleChanged =
    !courseMissing && course!.title.trim() !== saved.courseSnapshot.courseTitle;
  return { courseMissing, courseChanged, courseTitleChanged };
}

export function assertCertificateCourseFreshnessForSave(
  prior: EducationCertificateTemplateDraft | null,
  course: EducationCourseDraft,
  options?: SaveEducationCertificateTemplateOptions,
): void {
  if (!prior) return;
  const drift = evaluateCertificateCourseDrift(prior, course);
  if ((drift.courseChanged || drift.courseTitleChanged) && !options?.acknowledgeSourceChange) {
    const parts: string[] = [];
    if (drift.courseTitleChanged) parts.push('the linked course title changed');
    if (drift.courseChanged) parts.push('the saved course draft was revised');
    throw new Error(
      `${parts.join(' and ')} since this certificate template was saved. Review the course link, then save again with confirmation.`,
    );
  }
  if (drift.courseMissing) {
    throw new Error(
      'Linked course draft is missing or replaced. Restore the same course before saving this certificate template.',
    );
  }
}

export function saveEducationCertificateTemplateDraft(
  input: EducationCertificateTemplateDraftInput,
  profileId: string,
  course: EducationCourseDraft,
  prior?: EducationCertificateTemplateDraft | null,
  options?: SaveEducationCertificateTemplateOptions,
): EducationCertificateTemplateDraft {
  if (course.profileId !== profileId) {
    throw new Error('Course draft does not match this profile.');
  }
  assertCertificateCourseFreshnessForSave(prior ?? null, course, options);
  const courseSnapshot = snapshotCertificateCourse(course);
  if (prior && prior.revision >= educationCertificateRevisionCap) {
    throw new Error(
      `Certificate template revision cap (${educationCertificateRevisionCap}) reached. Export or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, courseSnapshot, revision, new Date().toISOString());
}

function parseCourseSnapshot(value: unknown): EducationCertificateCourseSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved certificate template draft. Nothing was overwritten.');
  }
  const record = value as EducationCertificateCourseSnapshot;
  return {
    courseId: text(record.courseId, 'Course ID', 160),
    courseUpdatedAt: parseUpdatedAt(record.courseUpdatedAt),
    courseTitle: text(record.courseTitle, 'Course title', educationCourseTitleLimit),
  };
}

export function restoreEducationCertificateTemplateDraft(
  raw: string | null,
  profileId: string,
): EducationCertificateTemplateDraft | null {
  if (raw === null) return null;
  if (raw.length > educationCertificateStorageByteLimit) {
    throw new Error('Saved certificate template draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved certificate template draft. Nothing was overwritten.');
  }
  const record = value as EducationCertificateTemplateDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched certificate template draft. Nothing was overwritten.');
  }
  const input = editEducationCertificateTemplateDraft(record);
  const courseSnapshot = parseCourseSnapshot(record.courseSnapshot);
  return buildDraft(
    input,
    profileId,
    courseSnapshot,
    parseRevision(record.revision),
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistEducationCertificateTemplateDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: EducationCertificateTemplateDraft,
): string {
  const key = educationCertificateTemplateStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Certificate template draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreEducationCertificateTemplateDraft(expectedRaw, profileId);
  }
  const checked = restoreEducationCertificateTemplateDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid certificate template draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > educationCertificateStorageByteLimit) {
    throw new Error('Certificate template storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function educationCertificateTemplateDraftAllowlistKeys(): readonly (keyof EducationCertificateTemplateDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'creatorDisplayName',
    'completionStatement',
    'signatureLabel',
    'accentPreset',
    'courseSnapshot',
  ];
}

export function educationCertificateTemplatePreviewAllowlistKeys(): readonly (keyof EducationCertificateTemplatePreviewProjection)[] {
  return [
    'templateLabel',
    'courseTitle',
    'creatorDisplayName',
    'completionStatement',
    'signatureLabel',
    'accentColor',
    'placeholderLearnerName',
    'placeholderCompletionDate',
  ];
}

export function resolveCertificateAccentColor(preset: EducationCertificateAccentPreset): string {
  return educationCertificateAccentColors[preset];
}

function projectFields(
  input: EducationCertificateTemplateDraftInput,
  courseTitle: string,
): EducationCertificateTemplatePreviewProjection {
  const creator = optionalText(input.creatorDisplayName, 'Creator or display name', educationCertificateCreatorNameLimit);
  return {
    templateLabel: educationCertificatePreviewTemplateLabel,
    courseTitle: text(courseTitle, 'Course title', educationCourseTitleLimit),
    creatorDisplayName: creator || null,
    completionStatement: text(input.completionStatement, 'Completion statement', educationCertificateCompletionStatementLimit),
    signatureLabel: text(input.signatureLabel, 'Signature label', educationCertificateSignatureLabelLimit),
    accentColor: resolveCertificateAccentColor(parseAccentPreset(input.accentPreset)),
    placeholderLearnerName: educationCertificatePlaceholderLearnerName,
    placeholderCompletionDate: educationCertificatePlaceholderCompletionDate,
  };
}

export function projectSavedCertificateTemplateForPreview(
  draft: EducationCertificateTemplateDraft,
): EducationCertificateTemplatePreviewProjection {
  return projectFields(editEducationCertificateTemplateDraft(draft), draft.courseSnapshot.courseTitle);
}

export function projectUnsavedCertificateTemplateForPreview(
  input: EducationCertificateTemplateDraftInput,
  course: EducationCourseDraft | null,
  saved: EducationCertificateTemplateDraft | null,
): EducationCertificateTemplatePreviewProjection {
  if (!course) throw new Error('Save a local course draft before previewing the certificate template.');
  const drift = saved ? evaluateCertificateCourseDrift(saved, course) : null;
  const title =
    drift?.courseMissing && saved
      ? saved.courseSnapshot.courseTitle
      : course.title.trim();
  return projectFields(input, title);
}

/** Display name seed from profile — only applied when the creator explicitly copies. */
export function creatorDisplayNameFromProfile(name: string): string {
  return name.trim().slice(0, educationCertificateCreatorNameLimit);
}

/** Keys that must never appear on template drafts or preview (issuance / credentials). */
export const educationCertificateForbiddenIssuanceKeys = [
  'issuedAt',
  'issuedTo',
  'learnerId',
  'certificateId',
  'credentialId',
  'accreditation',
  'accredited',
  'earned',
  'verificationUrl',
  'serialNumber',
] as const;
